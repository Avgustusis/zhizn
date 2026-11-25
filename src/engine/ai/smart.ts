/**
 * ИИ-соперники этапа 4: играют на свой смысл жизни. Уровни (решено 23–24.11): «Легко», «Нормально», «Сложно»;
 * все знают только то, что видит игрок. Характер ИИ — его черты (persona.ts).
 *
 * Решения: варианты карты — проигрывание на копиях партии (look.ts) и оценка (goal.ts); рынок, характеристики,
 * класс, эмиграция, сторона в кризисе — по целям карты смысла (wants.ts), как ИИ симуляции автора; остальное — простой ИИ.
 */
import type { G } from '../core.ts'
import type { Player, Request, Stat } from '../types.ts'
import { priceOf } from '../turn.ts'
import { outlook } from './goal.ts'
import { aiRng, fork, play } from './look.ts'
import { answer as simple } from './simple.ts'
import { statGaps, wantsOf, type Wants } from './wants.ts'
import { archetypeOf, leanings, tasteOf, type Taste } from './persona.ts'

export type Level = 'easy' | 'normal' | 'hard'

/**
 * Сила уровня. samples — сколько раз проигрывать вариант карты; noise — шум оценки;
 * blunder — доля случайных решений; aims — играет ли на смысл (рынок, класс, эмиграция, кризис).
 */
export const LEVELS: Record<Level, { samples: number; noise: number; blunder: number; aims: boolean }> = {
  easy: { samples: 1, noise: 3, blunder: 0.2, aims: false },
  normal: { samples: 2, noise: 1, blunder: 0, aims: true },
  hard: { samples: 6, noise: 0, blunder: 0, aims: true },
}

export function smartAnswer(g: G, req: Request, level: Level): string {
  const L = LEVELS[level]
  const open = req.options.filter((o) => !o.off)
  if (open.length < 2) return open[0]?.id ?? req.options[0].id
  const ids = open.map((o) => o.id)
  const p = g.s.players[req.player]
  const rand = aiRng(g, req, 0)
  // «Ход» (сыграть козырь, сиделка, скупка) и обязательные вопросы без выбора — не ошибаемся нарочно.
  if (L.blunder && req.type === 'карта' && rand() < L.blunder) return ids[Math.floor(rand() * ids.length)]
  if (req.type === 'карта' && open.every((o) => o.effect) && !simpleFirst(g, req)) return byLookahead(g, req, level)
  if (!L.aims) return simple(g, req)
  const w = wantsOf(g, p)
  const pick = aimed(g, p, req, ids, w, rand)
  if (pick && ids.includes(pick)) return pick
  const base = simple(g, req)
  // Курсы и спортзал «для класса» — реже, чем у простого ИИ (симуляция: курсы 1,6 за жизнь, спортзал 0,6): деньги
  // нужнее на здоровье. Характеристики смысла рынок уже купил выше.
  if (req.type === 'действие' && ['курсы', 'спортзал'].includes(base) && rand() < 0.75) {
    const rest = { ...req, options: req.options.filter((o) => o.id !== base) }
    return simple(g, rest)
  }
  return base
}

/** Вопросы карты, где простой ИИ уже следует правилу симуляции (сватовство, своё дело). */
function simpleFirst(_g: G, req: Request): boolean {
  return req.options.some((o) => JSON.stringify(o.effect ?? []).includes('"rule":"сватовство"'))
}

/** Вкус ИИ: черты игрока и архетип места. */
const taste = (g: G, seat: number): Taste => tasteOf(g.s.players[seat], archetypeOf(g.s.config.seats[seat]?.archetype))

// ── Варианты карты: проигрывание ────────────────────────────────────────

function byLookahead(g: G, req: Request, level: Level): string {
  const L = LEVELS[level]
  const open = req.options.filter((o) => !o.off)
  let best = open[0].id
  let top = -Infinity
  open.forEach((o, i) => {
    let sum = 0
    // Все варианты одной пробы играют одни и те же кубики и колоды: сравнение честнее (общие случайные числа).
    for (let k = 0; k < L.samples; k++) {
      const g2 = fork(g, aiRng(g, req, 7000 + k))
      sum += outlook(g2, play(g2, req.player, o.effect ?? [], req.card), taste(g, req.player))
    }
    const v = sum / L.samples + (L.noise ? (aiRng(g, req, 9000 + i)() - 0.5) * 2 * L.noise : 0)
    if (v > top) { top = v; best = o.id }
  })
  return best
}

// ── Игра на смысл ───────────────────────────────────────────────────────

const PLACE_OF: Partial<Record<Stat, string>> = {
  'Сила': 'спортзал', 'Выносливость': 'спортзал', 'Ловкость': 'спортзал',
  'Интеллект': 'курсы', 'Мудрость': 'курсы', 'Харизма': 'курсы', 'Смекалка': 'курсы', 'Красота': 'салон',
}

function aimed(g: G, p: Player, req: Request, ids: string[], w: Wants, rand: () => number): string | undefined {
  switch (req.type) {
    case 'действие': return ids.includes('конец') ? market(g, p, ids, w, rand) : undefined
    case 'характеристика': {
      if (req.text.startsWith('Чем бросаешь')) return [...req.options].filter((o) => !o.off).sort((a, b) => Number(b.note?.match(/\d+/)?.[0] ?? 0) - Number(a.note?.match(/\d+/)?.[0] ?? 0))[0]?.id
      return statGaps(p, w).map(([s]) => s).find((s) => ids.includes(s))
    }
    case 'класс': {
      if (!ids.includes('да')) return ids.find((id) => w.cls.has(id as never))
      const to = req.options.find((o) => o.id === 'да')?.label ?? ''
      const target = [...w.cls].find((c) => to.includes(c))
      if (target) return 'да'
      if (w.cls.has(p.cls) && ids.includes('нет')) return 'нет'
      return undefined
    }
    case 'эмиграция': {
      if (!ids.includes('нет')) return undefined
      if (w.stay) return 'нет'
      if (!w.emigrate) return undefined
      // Куда: позиция повыше, без пометки «только нелегально», если есть выбор.
      const rank = (id: string) => ({ 'ядро': 2, 'полупериферия': 1, 'периферия': 0 } as Record<string, number>)[g.s.world.countries[Number(id)]?.pos ?? ''] ?? -1
      const legal = req.options.filter((o) => !o.off && /^\d+$/.test(o.id) && !/только нелегально/.test(o.note ?? ''))
      const any = req.options.filter((o) => !o.off && /^\d+$/.test(o.id))
      const list = legal.length ? legal : any
      return list.sort((a, b) => rank(b.id) - rank(a.id))[0]?.id
    }
    case 'кризис': {
      const winWant = w.logs.has('победа в Смуте') || w.logs.has('смена власти') || w.logs.has('сторона в Смуте')
      if (ids.includes('за') && winWant) return 'за'
      if (ids.includes('победители')) return 'победители'
      if (req.text.startsWith('Вложить') && winWant && p.vozm >= 8) return 'да'
      return undefined
    }
    case 'предмет':
      // «Присяга» нужна смыслу — принимает всегда; иначе — как простой ИИ (70%).
      if (req.text.startsWith('Присяга') && (w.items.has('Присяга') || w.items.has('Офицерское звание'))) return 'да'
      return undefined
    default: return undefined
  }
}

/**
 * Рынок, как small() в sim3.py: беды и работа — как у простого ИИ; дальше — точечные шаги, которых требует карта
 * смысла (места из журнала: бар, хобби, храм, заповедник, обряд…; характеристики — курсы, спортзал, салон).
 */
function market(g: G, p: Player, ids: string[], w: Wants, rand: () => number): string | undefined {
  if (p.psy <= -5 || p.phys <= -5) return undefined
  // Работа и беды — у простого ИИ: срочное лечение и заработок, пока денег меньше 10; здоровье в минусе — сперва лечиться
  // (в Старости и Древности — уже ниже +2: дожить — тоже цель).
  if (p.vozm < 4 && p.seg < 5) return undefined
  if (p.phys <= 0 || p.psy <= 0 || (p.seg >= 4 && p.phys < 2)) return undefined
  const act = (id: string) => g.c.actions.find((a) => a.id === id)
  const price = (id: string) => { const a = act(id); return a ? priceOf(g, p, a) : 0 }
  const afford = (id: string, spare: number) => p.vozm >= price(id) + spare
  // 1) Места из журнала смысла, ещё не набранные.
  for (const [log, n] of w.logs) {
    if ((p.counters[log] ?? 0) >= n && !/^отрезков с/.test(log)) continue
    const id = ids.find((x) => act(x)?.log?.includes(log as never)) ?? ({ 'отрезков с Хобби': 'хобби', 'отрезков с Храмом': 'храм', 'отрезков с Курсами': 'курсы' } as Record<string, string>)[log]
    if (id && ids.includes(id) && afford(id, 1) && rand() < 0.7) return id
  }
  // 2) Характеристики смысла: ближайший разрыв, 70% хода, деньги на цену и ещё 2.
  for (const [s] of statGaps(p, w)) {
    const id = PLACE_OF[s]
    if (id && ids.includes(id) && afford(id, 2) && rand() < 0.7) return id
  }
  // Салон — как в симуляции: при Красоте ниже 7 изредка и без цели смысла (Красота нужна в проверках).
  if (p.stats['Красота'] < 7 && ids.includes('салон') && afford('салон', 2) && rand() < 0.07) return 'салон'
  // 3) Характер: Аппетит тянет в бар и ресторан, Щедрость и Участие — в фонд, Усердие — к работе.
  const lean = leanings(p, archetypeOf(g.s.config.seats[p.seat]?.archetype))
  const first = (...list: string[]) => list.find((id) => ids.includes(id) && afford(id, 1))
  // Аппетит — ресторан («Обжорство») и бар.
  if (lean.vice && p.psy < 4 && rand() < 0.12 * lean.vice) { const id = first('обжорство', 'бар'); if (id) return id }
  // Беспечность — бордель, а в крайнем случае (сильная Беспечность и психика −3 и ниже) — притон.
  if (lean.care <= -2 && p.psy <= -3 && rand() < 0.1) { const id = first('притон', 'бордель'); if (id) return id }
  if (lean.care < 0 && p.psy < 3 && rand() < 0.06 * -lean.care) { const id = first('бордель'); if (id) return id }
  if (lean.help && p.vozm >= 8 && rand() < 0.1 * lean.help) { const id = first('благотворительность'); if (id) return id }
  if (lean.care > 0 && p.vozm < 12 && p.seg < 5 && rand() < 0.2 * lean.care) { const id = first('работа', 'дело', 'подработка'); if (id) return id }
  return undefined
}
