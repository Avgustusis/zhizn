/**
 * Особые правила карт (шаг `rule`): то, что делает код, а не общий эффект.
 * Написанные правила — в таблице ниже. Остальные движок не пропускает молча: считает в `state.todo`.
 */
import { clamp, countryOf, pick, say, todo, type Flow, type G } from './core.ts'
import type { Ctx } from './cond.ts'
import { kindOf } from './cond.ts'
import { addParam, removeHeld, wed } from './change.ts'
import { newCtx } from './cond.ts'
import type { Player } from './types.ts'

/** Правило — обычная функция или, если нужен вопрос игроку, генератор. */
type Rule = (g: G, p: Player, arg: string | undefined, ctx: Ctx) => Flow | void

/** Правила-отметки: действуют до конца отрезка, их читают другие части движка (рынок, работа, катастрофы). */
const UNTIL_SEG = ['только подработка', 'казённое место', 'катастрофа мягче', 'катастрофа мимо', 'выручка', 'только работа']

const RULES: Record<string, Rule> = {
  *'свадьба'(g, p) { if (!(yield* wed(g, p))) say(g, p, 'свадьбы нет: нет Партнёра') },
  'сбросить козыри'(g, p) { for (const h of p.items.filter((x) => kindOf(g, x) === 'козырь')) removeHeld(g, p, h) },
  'изъять козырь'(g, p) {
    const list = p.items.filter((x) => kindOf(g, x) === 'козырь')
    if (list.length) removeHeld(g, p, pick(g, list))
  },
  'потерять вещь'(g, p) {
    const list = p.items.filter((x) => kindOf(g, x) === 'вещь')
    if (list.length) removeHeld(g, p, pick(g, list))
  },
  'дело в сброс'(g, p) { for (const h of p.items.filter((x) => kindOf(g, x) === 'дело')) removeHeld(g, p, h) },
  'стабильность'(g, p, arg, ctx) {
    const c = ctx.target !== undefined ? g.s.world.countries[ctx.target] : countryOf(g, p)
    const n = Number((arg ?? '').replace('−', '-').match(/[+-]?\d+/)?.[0] ?? 0)
    const w = g.c.tables.world.stability
    c.stability = clamp(c.stability + n, w.min, w.max)
  },
  'раздать вещи'(g, p) {
    const list = p.items.filter((x) => kindOf(g, x) === 'вещь')
    if (!list.length) return
    for (const h of list) removeHeld(g, p, h)
    const c = newCtx('правило')
    addParam(g, p, 'псих', Math.min(3, list.length), c)
    addParam(g, p, 'Пожертвования', 1, c)
  },
  'студент'(_g, p) { p.student = true },
}

export function* runRule(g: G, p: Player, rule: string, arg: string | undefined, ctx: Ctx): Flow {
  if (UNTIL_SEG.includes(rule)) { p.rules[rule] = { ...(arg ? { arg } : {}), seg: p.seg }; return }
  const fn = RULES[rule]
  if (!fn) return todo(g, p, rule)
  const flow = fn(g, p, arg, ctx)
  if (flow) yield* flow
}

/** Какие правила уже написаны (для теста-описи). */
export const implementedRules = (): string[] => [...Object.keys(RULES), ...UNTIL_SEG]
