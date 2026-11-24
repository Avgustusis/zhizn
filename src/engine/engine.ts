/**
 * Движок партии: `state`, `pending`, `answer()`.
 * Партия режется на шаги (подготовка, ход игрока, мировой ход). Между шагами всё состояние лежит в `state`;
 * сохранение — снимок на начало шага и ответы внутри шага.
 */
import { emit, makeG, type Flow, type G } from './core.ts'
import { settle } from './meaning.ts'
import { newState, setup } from './setup.ts'
import { playerTurn } from './turn.ts'
import { foresight, worldTurn } from './world.ts'
import { frontRound } from './war.ts'
import type { Content, GameConfig, GameState, Player, Request, SaveFile } from './types.ts'

export interface EngineOptions {
  /** Снимки на начало каждого шага: нужны для сохранения. В симуляциях выключают ради скорости. */
  checkpoints?: boolean
}

/** Режим партии: старое поле mode (до 20.11) → span; «Быль» по умолчанию. */
export function normalizeConfig(c: GameConfig): void {
  if (!c.span) c.span = c.mode === 'род' ? 'lineage' : 'one'
  c.start ??= 'dice'
  delete c.mode
}

/** Название режима для экрана: «Биография», «Родословная», «Легенда», «Сага». */
export const modeName = (c: GameConfig): string => (c.start === 'tale' ? (c.span === 'lineage' ? 'Сага' : 'Легенда') : c.span === 'lineage' ? 'Родословная' : 'Биография')

const active = (p: Player | undefined): p is Player => !!p && p.alive && !p.finished

export class Engine {
  readonly g: G
  pending: Request | null = null
  private flow: Flow | null = null
  /** Снимок на начало шага — без журнала (журнал растёт всю партию; к сохранению его приставляет save()). */
  private base = ''
  private logAt = 0
  private answers: string[] = []
  private readonly checkpoints: boolean

  constructor(content: Content, from: GameConfig | GameState, options: EngineOptions = {}) {
    this.checkpoints = options.checkpoints ?? true
    const state = 'version' in from ? from : newState(from)
    normalizeConfig(state.config)
    this.g = makeG(state, content)
    this.advance()
  }

  get state(): GameState { return this.g.s }
  get over(): boolean { return this.g.s.phase === 'конец' }

  /** Ответ на текущий вопрос: id одного из открытых вариантов. */
  answer(id: string): void {
    const req = this.pending
    if (!req) throw new Error('вопроса нет')
    const option = req.options.find((o) => o.id === id)
    if (!option) throw new Error(`нет варианта «${id}» в вопросе «${req.text}»`)
    if (option.off) throw new Error(`вариант «${id}» закрыт: ${option.off}`)
    this.answers.push(id)
    this.pending = null
    this.advance(id)
  }

  save(): SaveFile {
    if (!this.checkpoints) throw new Error('сохранение выключено (checkpoints: false)')
    const st = JSON.parse(this.base) as GameState
    st.log = this.g.s.log.slice(0, this.logAt)
    return { version: 1, base: JSON.stringify(st), answers: [...this.answers] }
  }


  static load(content: Content, save: SaveFile, options: EngineOptions = {}): Engine {
    const e = new Engine(content, JSON.parse(save.base) as GameState, options)
    for (const a of save.answers) e.answer(a)
    return e
  }

  /** Идти вперёд до следующего вопроса или конца партии. */
  private advance(answer?: string): void {
    for (;;) {
      let r: IteratorResult<Request, void>
      if (this.flow) r = this.flow.next(answer as string)
      else {
        if (this.g.s.phase === 'конец') return
        if (this.checkpoints) {
          const log = this.g.s.log
          this.g.s.log = []
          this.base = JSON.stringify(this.g.s)
          this.g.s.log = log
          this.logAt = log.length
          this.answers = []
        }
        this.flow = this.unit()
        r = this.flow.next()
      }
      answer = undefined
      if (!r.done) { this.pending = r.value; return }
      this.flow = null
    }
  }

  /** Следующий шаг партии — по состоянию. */
  private *unit(): Flow {
    const { g } = this
    const s = g.s
    if (s.phase === 'подготовка') { yield* setup(g); this.firstSeat(); return }
    // Конец круга: сначала хранитель часов на «Фронте», потом мировой ход.
    if (s.frontDue) { delete s.frontDue; yield* frontRound(g); return }
    if (s.worldDue) { delete s.worldDue; yield* worldTurn(g); this.endCheck(); return }
    const p = s.players[s.current]
    if (active(p)) yield* playerTurn(g, p)
    this.nextSeat()
  }

  private firstSeat(): void {
    const s = this.g.s
    s.current = s.players.findIndex(active)
    if (s.current < 0) this.finish()
  }

  /** Следующий игрок; круг замкнулся — часы идут, каждые пять кругов — мировой ход. */
  private nextSeat(): void {
    const s = this.g.s
    const n = s.players.length
    let seat = s.current
    for (let i = 0; i < n; i++) {
      seat += 1
      if (seat >= n) {
        seat = 0
        s.round += 1
        if (s.war) s.frontDue = true
        const per = this.g.c.tables.world.roundsPerWorldTurn
        if (s.round % per === 0) s.worldDue = true
        // Предчувствие — за круг до мирового хода.
        if ((s.round + 1) % per === 0) foresight(this.g)
      }
      if (active(s.players[seat])) break
    }
    s.current = seat
    // Мировой ход на последнем круге ещё состоится: конец партии проверяем после него.
    if (!s.worldDue) this.endCheck()
  }

  /** Партия кончается, когда дошли мировые часы или не осталось живых. */
  private endCheck(): void {
    const s = this.g.s
    const w = this.g.c.tables.world
    const rounds = s.config.rounds ?? w.worldTurns[s.config.span] * w.roundsPerWorldTurn
    if (s.round >= rounds || !s.players.some(active)) return this.finish()
    if (!active(s.players[s.current])) {
      const next = s.players.findIndex((p, i) => i > s.current && active(p))
      s.current = next >= 0 ? next : s.players.findIndex(active)
    }
  }

  private finish(): void {
    const s = this.g.s
    s.phase = 'конец'
    for (const p of s.players) settle(this.g, p)
    emit(this.g, { t: 'мир', text: 'партия окончена' })
  }
}
