import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { CLASSES, type Card, type Meaning, type Node } from '../src/data/schema.ts'
import { enterInst } from '../src/engine/change.ts'
import { runCheck } from '../src/engine/checks.ts'
import { newCtx } from '../src/engine/cond.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { run } from '../src/engine/exec.ts'
import { meaningAtBirth, meaningAtEntry, meaningPiles } from '../src/engine/meaning.ts'
import { playerTurn } from '../src/engine/turn.ts'
import type { Content, GameConfig, LogEvent, Player } from '../src/engine/types.ts'

const real = loadContent()
const blank = (id: string, extra: Partial<Card> = {}): Card => ({ id, n: 1, title: id, text: '', src: '', kind: 'Б', tags: [], effect: [], ...extra })

/** «Тихое» содержание: поле и таблицы настоящие, а все карты пустые — чтобы проверять сам ход, без случайных событий. */
function quiet(over: Partial<Content> = {}): Content {
  const decks: Record<string, Card[]> = {}
  for (const deck of Object.keys(real.decks)) decks[deck] = [blank(`тест.${deck}`)]
  decks['класс'] = CLASSES.map((cls) => blank(`тест.класс.${cls}`, { cls }))
  decks['развилка'] = [
    blank('тест.развилка'),
    ...['Образование', 'Эмиграция', 'Партнёрство', 'Ребёнок'].map((title) => blank(`тест.развилка.${title}`, { title, cell: 'на поле', effect: [{ flag: `развилка ${title}` }] })),
  ]
  return { ...real, decks, polar: [], subCodes: {}, ...over }
}

const config = (seed: number): GameConfig => ({ mode: 'поколение', seed, seats: [{ name: 'Опыт' }] })
function drive<T>(flow: Flow<T>, answers: string[] = []): T {
  let r = flow.next()
  while (!r.done) r = flow.next(answers.shift() ?? r.value.options.find((o) => !o.off)!.id)
  return r.value
}
/** Один игрок на «тихом» содержании: обычная семья, здоров, без предметов и без смысла. */
function lab(seed: number, over: Partial<Player> = {}, content: Content = quiet()): { e: Engine; p: Player; log: () => LogEvent[] } {
  const e = new Engine(content, config(seed), { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  const p = e.state.players[0]
  Object.assign(p, { seg: 3, cell: 5, phys: 0, psy: 0, vozm: 0, items: [], character: [0, 0, 0, 0, 0, 0, 0], fin: 0, pos: 0, coh: 0, mods: [], achieved: {}, approved: [], flags: {} }, over)
  delete p.meaning
  const mark = e.state.log.length
  return { e, p, log: () => e.state.log.slice(mark) }
}
const turn = (e: Engine, p: Player, answers: string[] = []) => drive(playerTurn(e.g, p), answers)
const steps = (log: LogEvent[]) => { const r = log.find((x) => x.t === 'бросок' && x.why === 'ход'); return r && r.t === 'бросок' ? r.value : 0 }
const indexOf = (seg: number, pred: (c: Content['board']['segments'][number]['cells'][number]) => boolean) => real.board.segments[seg].cells.findIndex(pred)

describe('движение', () => {
  it('фишка проходит столько клеток, сколько выпало', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { e, p, log } = lab(seed, { seg: 0, cell: 0 })
      turn(e, p)
      expect(p.cell).toBe(steps(log()))
      expect(p.seg).toBe(0)
    }
  })

  it('напечатанная развилка — шлагбаум: встаёшь, разыгрываешь и проходишь остаток хода', () => {
    const fork = indexOf(2, (c) => c.fork === 'Эмиграция')
    for (let seed = 1; seed <= 12; seed++) {
      const { e, p, log } = lab(seed, { seg: 2, cell: fork - 1 })
      turn(e, p)
      expect(p.flags['развилка Эмиграция'], `зерно ${seed}`).toBe(true)
      expect(p.cell).toBe(fork - 1 + steps(log()))
    }
  })

  it('«Образование» стоит в конце Юности: после развилки фишка входит в Молодость', () => {
    const last = real.board.segments[1].cells.length - 1
    expect(real.board.segments[1].cells[last].fork).toBe('Образование')
    for (let seed = 1; seed <= 12; seed++) {
      const { e, p, log } = lab(seed, { seg: 1, cell: last - 1 })
      turn(e, p)
      const n = steps(log())
      expect(p.flags['развилка Образование']).toBe(true)
      if (n === 1) { expect(p.seg).toBe(1); expect(p.cell).toBe(last) } else {
        expect(p.seg).toBe(2)
        expect(p.cell).toBe(n - 2)
        expect(log().some((x) => x.t === 'отрезок' && x.seg === 'Молодость')).toBe(true)
        expect(log().some((x) => x.t === 'проверка' && x.what === 'поиск смысла')).toBe(true)
      }
    }
  })

  it('в институте развилки проходят мимо, а вместо клетки — карта института', () => {
    const fork = indexOf(2, (c) => c.fork === 'Партнёрство')
    const { e, p, log } = lab(3, { seg: 2, cell: fork - 1 })
    enterInst(e.g, p, 'тюрьма', 3)
    turn(e, p)
    expect(p.flags['развилка Партнёрство']).toBeUndefined()
    expect(log().some((x) => x.t === 'карта' && x.id === 'тест.тюрьма')).toBe(true)
    expect(p.inst?.left).toBe(2)
  })

  it('«Итог воспитания»: очки по финансам семьи в характеристики её класса; на проходе, а не только на остановке', () => {
    const cell = indexOf(0, (c) => c.type === 'итог воспитания')
    for (let seed = 1; seed <= 8; seed++) {
      const { e, p } = lab(seed, { seg: 0, cell: cell - 1, fin: 1, coh: 0, familyCls: 'Народ', cls: 'Народ' })
      p.stats = { ...p.stats, 'Выносливость': 3, 'Смекалка': 3, 'Красота': 3 }
      turn(e, p)
      expect([p.stats['Выносливость'], p.stats['Смекалка'], p.stats['Красота']]).toEqual([4, 4, 3]) // 2 очка, красота не страдает
    }
    // Холодная бедная семья: очков нет, зато +1 Смекалка; недоедание — −1 Красота.
    const poor = lab(2, { seg: 0, cell: cell - 1, fin: -2, coh: -2, familyCls: 'Народ', cls: 'Народ' })
    poor.p.stats = { ...poor.p.stats, 'Выносливость': 3, 'Смекалка': 3, 'Красота': 3 }
    turn(poor.e, poor.p)
    expect([poor.p.stats['Выносливость'], poor.p.stats['Смекалка'], poor.p.stats['Красота']]).toEqual([3, 4, 2])
    // Юность: «гормональная лотерея» +1d4 к Красоте.
    const teenCell = indexOf(1, (c) => c.type === 'итог воспитания')
    const teen = lab(3, { seg: 1, cell: teenCell - 1, fin: -3, coh: 0 })
    teen.p.stats = { ...teen.p.stats, 'Красота': 2 }
    turn(teen.e, teen.p)
    expect(teen.p.stats['Красота']).toBeGreaterThanOrEqual(3)
    expect(teen.p.stats['Красота']).toBeLessThanOrEqual(6)
  })

  it('вход в Древность: 3d6 + физ. ≥ 12; провал — смерть в конце Старости', () => {
    const last = real.board.segments[4].cells.length - 1
    const weak = lab(4, { seg: 4, cell: last, phys: -9 })
    weak.e.g.s.world.countries[weak.p.country].pos = 'периферия'
    turn(weak.e, weak.p)
    expect(weak.p.alive).toBe(false)
    expect(weak.p.death).toMatchObject({ seg: 'Старость', cause: 'возраст' })
    const strong = lab(4, { seg: 4, cell: last, phys: 10 })
    strong.e.g.s.world.countries[strong.p.country].pos = 'ядро'
    strong.p.stats = { ...strong.p.stats, 'Красота': 5 }
    turn(strong.e, strong.p)
    expect([strong.p.alive, strong.p.seg]).toEqual([true, 5])
    expect(strong.p.stats['Красота']).toBe(4)   // −1 на входе
    expect(strong.p.phys).toBe(9)                // Древность: −1 физ. каждый ход
  })

  it('конец Древности — «Финал»: жизнь окончена, счастье считается', () => {
    const last = real.board.segments[5].cells.length - 1
    const { e, p, log } = lab(5, { seg: 5, cell: last - 1, phys: 5 })
    turn(e, p)
    expect([p.finished, p.alive]).toEqual([true, true])
    expect(log().some((x) => x.t === 'финал')).toBe(true)
    expect(p.phys).toBe(5) // после финала старение не идёт
  })
})

describe('институты', () => {
  it('тюрьма: срок идёт по ходу, на выходе — «Судимость»', () => {
    const { e, p } = lab(6)
    enterInst(e.g, p, 'тюрьма', 2, '#закон')
    turn(e, p)
    expect(p.inst?.left).toBe(1)
    turn(e, p)
    expect(p.inst).toBeUndefined()
    expect(p.items.map((h) => h.name)).toEqual(['Судимость'])
    expect([p.counters['тюрьма'], p.counters['срок отбыт'], p.counters['выход из института']]).toEqual([1, 1, 1])
  })

  it('кабала: с −15 Возможностей; +2 за ход и по очереди −1 физ. и −1 псих.; выход на −8 с «Долгом»', () => {
    const { e, p } = lab(7, { vozm: -15 })
    turn(e, p)
    expect(p.inst?.kind).toBe('кабала')
    for (let i = 0; i < 4; i++) { expect(p.inst?.kind, `ход ${i}`).toBe('кабала'); turn(e, p) }
    expect(p.inst).toBeUndefined()
    expect([p.vozm, p.phys, p.psy]).toEqual([-7, -2, -2])
    expect(p.items.map((h) => h.name)).toEqual(['Долг'])
  })

  it('кабала не убивает: здоровье останавливается на −9', () => {
    const { e, p } = lab(8, { vozm: -15, phys: -9, psy: -9 })
    turn(e, p)
    for (let i = 0; i < 3; i++) turn(e, p)
    expect([p.alive, p.phys, p.psy]).toEqual([true, -9, -9])
  })

  it('психбольница: выход при психике 0 или через шесть ходов, на выходе — «Учёт»', () => {
    const a = lab(9, { psy: -8 })
    enterInst(a.e.g, a.p, 'психбольница', 6)
    for (let i = 0; i < 5; i++) turn(a.e, a.p)
    expect(a.p.inst?.left).toBe(1)
    turn(a.e, a.p)
    expect(a.p.inst).toBeUndefined()
    expect(a.p.items.map((h) => h.name)).toEqual(['Учёт'])
    const b = lab(9, { psy: 0 })
    enterInst(b.e.g, b.p, 'психбольница', 6)
    turn(b.e, b.p)
    expect(b.p.inst).toBeUndefined()
  })
})

describe('отложенное и временное', () => {
  it('отложенный эффект срабатывает на входе в отрезок, поправка «до конца отрезка» гаснет', () => {
    const last = real.board.segments[3].cells.length - 1
    const { e, p } = lab(10, { seg: 3, cell: last })
    const effect: Node[] = [
      { later: { when: 'вход в следующий отрезок', then: [{ flag: 'сработало' }] } },
      { mod: { tag: '#работа', add: 1, until: 'отрезок' } },
      { income: 1, until: 'отрезок' },
      { rule: 'только подработка' },
    ]
    drive(run(e.g, p, effect, newCtx('карта')))
    expect([p.laters.length, p.mods.length, p.income.length, !!p.rules['только подработка']]).toEqual([1, 1, 1, true])
    turn(e, p)
    expect(p.seg).toBe(4)
    expect(p.flags['сработало']).toBe(true)
    expect([p.laters.length, p.mods.length, p.income.length, !!p.rules['только подработка']]).toEqual([0, 0, 0, false])
  })

  it('рассрочка: по платежу на входе в каждый следующий подсектор', () => {
    const { e, p } = lab(11, { seg: 3, cell: 2, vozm: 5 })
    drive(run(e.g, p, [{ installments: 3, each: [{ add: { 'возм': -1 } }] }], newCtx('карта')))
    let guard = 0
    while (p.installments.length && guard++ < 40) turn(e, p)
    expect(p.vozm).toBe(2)
    // Три платежа — это три границы подсекторов: середина Зрелости, вход в Старость, середина Старости.
    expect(p.seg).toBe(4)
    expect(real.board.segments[4].cells[p.cell].sub).toBe(1)
  })

  it('поправка «до следующей проверки» сгорает после проверки с её тегом', () => {
    const { e, p } = lab(12)
    drive(run(e.g, p, [{ mod: { tag: '#образование', dis: true, until: 'проверка' } }], newCtx('карта')))
    drive(runCheck(e.g, p, { stat: 'Сила', dc: 15 }, newCtx('карта', { tags: ['#работа'] })))
    expect(p.mods.length).toBe(1) // чужой тег поправку не трогает
    drive(runCheck(e.g, p, { stat: 'Сила', dc: 15 }, newCtx('карта', { tags: ['#образование'] })))
    expect(p.mods.length).toBe(0)
  })

  it('колода «по полюсам»: поправка сложности записана для «сильно», при «умеренно» — на 1 от обычной', () => {
    const check = { stat: 'Харизма' as const, dc: 15, mods: [{ if: { culture: 'Иерархия' as const }, dc: 18 }, { if: { culture: 'Равенство' as const }, dc: 12 }, { if: { culture: 'Равенство' as const }, add: 2, fixed: true as const }] }
    const dc = (lean: number, polar: boolean) => {
      const { e, p, log } = lab(13)
      p.ownProfile = [0, lean, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      e.g.s.world.countries[p.country].ideology = 'Либеральная демократия'
      drive(runCheck(e.g, p, check, newCtx('карта', { polar })))
      const ev = log().find((x) => x.t === 'проверка')!
      return ev.t === 'проверка' ? [ev.dc, ev.mod] : []
    }
    expect(dc(-2, true)).toEqual([18, 0])
    expect(dc(-1, true)).toEqual([16, 0])
    expect(dc(0, true)).toEqual([15, 0])
    expect(dc(1, true)).toEqual([14, 2])  // `fixed`: +2 при любой силе
    expect(dc(2, true)).toEqual([12, 2])
    expect(dc(-1, false)).toEqual([18, 0]) // в обычной колоде поправка действует как написано
  })
})

describe('смысл: Династия, отказ, кризис', () => {
  const meaning = (id: string, deck: Meaning['deck'], title: string): Meaning => ({
    id, deck, n: Number(id.slice(-2)) || 0, title, motto: '', difficulty: deck === 'Серость' ? 'Серость' : 'Простой', tags: [],
    conds: [1, 2, 3, 4].map((i) => ({ text: `условие ${i}`, kind: 'сост.' as const, points: 1, cond: { p: 'Сила' as const, gte: 20 + i } })),
  })
  const meanings = [meaning('серость', 'Серость', 'Серость'), meaning('династия.01', 'Династии', 'Род'), ...[1, 2, 3, 4, 5].map((i) => meaning(`смысл.0${i}`, 'Случайные', `Свой ${i}`))]
  const fresh = (seed: number, over: Partial<Player>) => {
    const x = lab(seed, over, quiet({ meanings }))
    meaningPiles(x.e.g)
    return x
  }

  it('семья с положением +2 получает предназначение; принять — значит навсегда', () => {
    const { e, p } = fresh(14, { seg: 0, pos: 2 })
    drive(meaningAtBirth(e.g, p), ['принять'])
    expect(p.meaning).toMatchObject({ id: 'династия.01', from: 'династия', locked: true })
    p.seg = 3
    drive(meaningAtEntry(e.g, p), ['отказ', 'сменить'])
    expect(p.meaning?.id).toBe('династия.01') // ни отказа, ни кризиса
  })

  it('отказ от предназначения: удался — три карты на выбор; не удался к Зрелости — «Серость»', () => {
    let won = 0, grey = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { e, p } = fresh(seed, { seg: 0, pos: 2 })
      drive(meaningAtBirth(e.g, p), ['отказ', 'смысл.03'])
      for (const seg of [1, 2, 3]) {
        if (p.meaning?.from !== 'династия') break
        expect(p.refusing).toBe(true)
        p.seg = seg
        drive(meaningAtEntry(e.g, p), ['отказ'])
      }
      expect(p.meaning?.locked).toBe(true)
      if (p.meaning?.id === 'серость') grey++
      else { won++; expect(p.meaning?.from).toBe('отказ'); expect(p.meaning?.id.startsWith('смысл.')).toBe(true) }
      // Все карты на месте: в стопке или у игрока.
      expect(e.state.piles['смыслы'].length + (p.meaning?.id.startsWith('смысл.') ? 1 : 0)).toBe(5)
    }
    expect(won).toBeGreaterThan(30) // четыре броска: 16+, 13+, 10+, 10+
    expect(grey).toBeGreaterThan(0)
  })

  it('прекратить попытки можно в любой момент: предназначение остаётся', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { e, p } = fresh(seed, { seg: 0, pos: 3 })
      drive(meaningAtBirth(e.g, p), ['отказ', 'смысл.01'])
      if (p.meaning?.from !== 'династия') continue
      p.seg = 1
      drive(meaningAtEntry(e.g, p), ['принять'])
      expect(p.meaning).toMatchObject({ id: 'династия.01', locked: true })
      expect(p.refusing).toBeUndefined()
      return
    }
    throw new Error('ни в одной из партий отказ не дожил до Юности')
  })

  it('поиск смысла: не нашёл до Зрелости — «Серость»; кризис среднего возраста меняет карту', () => {
    let found = 0, grey = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { e, p } = fresh(seed, { seg: 0 })
      drive(meaningAtBirth(e.g, p))
      for (const seg of [1, 2, 3]) { p.seg = seg; drive(meaningAtEntry(e.g, p), ['оставить']) }
      expect(p.meaning).toBeTruthy()
      if (p.meaning!.id === 'серость') grey++; else found++
    }
    expect(found).toBeGreaterThan(grey)
    expect(grey).toBeGreaterThan(0)
    const { e, p } = fresh(15, { seg: 3 })
    p.meaning = { id: 'смысл.02', from: 'поиск', verdict: 0 }
    e.state.piles['смыслы'] = e.state.piles['смыслы'].filter((id) => id !== 'смысл.02')
    drive(meaningAtEntry(e.g, p), ['сменить'])
    expect(p.meaning).toMatchObject({ from: 'кризис', locked: true })
    expect(p.meaning!.id).not.toBe('смысл.02')
    expect(e.state.piles['смыслы'].at(-1)).toBe('смысл.02') // старая карта ушла под низ
    expect(p.crisisDone).toBe(true)
  })
})

describe('сохранение', () => {
  it('вопрос при рождении тоже переживает сохранение', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const e = new Engine(real, { mode: 'поколение', seed, seats: [{ name: 'А' }, { name: 'Б' }, { name: 'В' }, { name: 'Г' }] })
      if (!e.pending || e.pending.type === 'ход') continue
      const copy = Engine.load(real, JSON.parse(JSON.stringify(e.save())))
      expect(copy.pending).toEqual(e.pending)
      const id = e.pending.options.find((o) => !o.off)!.id
      e.answer(id); copy.answer(id)
      expect(JSON.stringify(copy.state)).toBe(JSON.stringify(e.state))
      return
    }
    throw new Error('ни в одной из партий не было вопроса при рождении')
  })
})
