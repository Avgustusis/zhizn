/** Основа движка: генератор случайных чисел с зерном, кубики, журнал, справочники содержания. */
import type { Card, Item, Meaning } from '../data/schema.ts'
import type { Content, Country, GameState, LogEvent, Option, Player, Request, Seg } from './types.ts'
import { SEGMENTS } from '../data/schema.ts'

/** Партия в работе: состояние, содержание и справочники, собранные из содержания один раз. */
export interface G {
  s: GameState
  c: Content
  cards: Map<string, { card: Card; deck: string }>
  items: Map<string, Item>
  /** Стопка людей → имена карт. */
  groups: Map<string, string[]>
  meanings: Map<string, Meaning>
  /** Все условия «соб.» всех карт смысла: ключ JSON → условие. Движок следит за ними с рождения. */
  watch: Map<string, import('../data/schema.ts').Cond>
}

export function makeG(s: GameState, c: Content): G {
  const cards = new Map<string, { card: Card; deck: string }>()
  for (const [deck, list] of Object.entries(c.decks)) for (const card of list) cards.set(card.id, { card, deck })
  const items = new Map(c.items.map((i) => [i.name, i]))
  const groups = new Map<string, string[]>()
  for (const i of c.items) if (i.group) groups.set(i.group, [...(groups.get(i.group) ?? []), i.name])
  const watch: G['watch'] = new Map()
  for (const m of c.meanings) for (const k of m.conds) if (k.kind === 'соб.') watch.set(JSON.stringify(k.cond), k.cond)
  for (const h of c.heirs) for (const k of h.meaning.conds) if (k.kind === 'соб.') watch.set(JSON.stringify(k.cond), k.cond)
  return { s, c, cards, items, groups, meanings: new Map(c.meanings.map((m) => [m.id, m])), watch }
}

// ── Случайность: sfc32, состояние лежит в state.rng ─────────────────────

export function seedRng(seed: number): [number, number, number, number] {
  // splitmix32 разворачивает одно число в четыре слова состояния
  let h = seed >>> 0
  const next = () => {
    h = (h + 0x9e3779b9) >>> 0
    let z = h
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
    return (z ^ (z >>> 16)) >>> 0
  }
  const st: [number, number, number, number] = [next(), next(), next(), next()]
  for (let i = 0; i < 12; i++) u32(st)
  return st
}

function u32(st: [number, number, number, number]): number {
  const t = (((st[0] + st[1]) >>> 0) + st[3]) >>> 0
  st[3] = (st[3] + 1) >>> 0
  st[0] = st[1] ^ (st[1] >>> 9)
  st[1] = (st[2] + (st[2] << 3)) >>> 0
  st[2] = ((st[2] << 21) | (st[2] >>> 11)) >>> 0
  st[2] = (st[2] + t) >>> 0
  return t
}

/** Целое от 0 до n − 1, без перекоса. */
export function rnd(g: G, n: number): number {
  if (n <= 1) return 0
  const lim = Math.floor(0x100000000 / n) * n
  let x = u32(g.s.rng)
  while (x >= lim) x = u32(g.s.rng)
  return x % n
}

/** Кубик dN. */
export const die = (g: G, n: number): number => rnd(g, n) + 1
export const pick = <T>(g: G, list: readonly T[]): T => list[rnd(g, list.length)]
export function shuffle<T>(g: G, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rnd(g, i + 1)
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/** 3d6; adv > 0 — преимущество (4d6, низший прочь), adv < 0 — помеха (высший прочь). */
export function roll3(g: G, adv = 0): { dice: number[]; sum: number } {
  const dice = Array.from({ length: adv === 0 ? 3 : 4 }, () => die(g, 6))
  let sum = dice.reduce((a, b) => a + b, 0)
  if (adv > 0) sum -= Math.min(...dice)
  if (adv < 0) sum -= Math.max(...dice)
  return { dice, sum }
}

// ── Журнал и вопросы ────────────────────────────────────────────────────

export function emit(g: G, ev: LogEvent): void {
  if (g.s.config.keepLog !== false) g.s.log.push(ev)
}
export const say = (g: G, p: Player, text: string): void => emit(g, { t: 'текст', p: p.seat, text })

/** Правило этапа 3, которое ещё не написано: не молчим, а считаем. */
export function todo(g: G, p: Player, rule: string): void {
  g.s.todo[rule] = (g.s.todo[rule] ?? 0) + 1
  emit(g, { t: 'этап3', p: p.seat, rule })
}

/** Шаг правил: генератор, который задаёт вопросы и получает id выбранного варианта. */
export type Flow<T = void> = Generator<Request, T, string>

/** Задать вопрос. Если открытый вариант один, вопрос всё равно задаётся только при force. */
export function* ask(g: G, p: Player, type: Request['type'], text: string, options: Option[], extra: { card?: string; force?: boolean } = {}): Flow<string> {
  const open = options.filter((o) => !o.off)
  if (open.length === 0) throw new Error(`вопрос без вариантов: ${text}`)
  if (open.length === 1 && !extra.force) return open[0].id
  const req: Request = { n: ++g.s.asked, player: p.seat, type, text, options }
  if (extra.card) req.card = extra.card
  return yield req
}

// ── Мелкие справки ──────────────────────────────────────────────────────

export const segName = (p: Player): Seg => SEGMENTS[p.seg]
export const countryOf = (g: G, p: Player): Country => g.s.world.countries[p.country]
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
/** Ступенчатая таблица: [[верхняя граница, значение], …]. */
export const step = (table: [number, number][], x: number): number => (table.find(([hi]) => x <= hi) ?? table[table.length - 1])[1]
