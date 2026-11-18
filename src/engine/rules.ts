/**
 * Особые правила карт (шаг `rule`): то, что делает код, а не общий эффект.
 * Написанные правила — в таблице ниже. Остальные движок не пропускает молча: считает в `state.todo`.
 */
import { clamp, countryOf, pick, say, todo, type Flow, type G } from './core.ts'
import type { Ctx } from './cond.ts'
import { kindOf } from './cond.ts'
import { addParam, charStep, gainItem, removeHeld, wed } from './change.ts'
import { acquaintance, burn, kontora, lawTrap, partnerClass, rite, work } from './market.ts'
import { foundNow, searchNow } from './meaning.ts'
import { crisisCheck, flight, turmoilRule } from './world.ts'
import { emigrationRule } from './emigration.ts'
import { draftCheck, frontNow, warRule } from './war.ts'
import { traceRule } from './social.ts'
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
    // «Становится 5, а не 4» (Смута): значение, а не сдвиг.
    const set = (arg ?? '').match(/становится (\d+)/)
    if (set) { c.stability = Number(set[1]); return }
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
  'студент'(_g, p) { p.rules['студент'] = {} },
  // ── Рынок ──
  *'работа'(g, p, arg) { yield* work(g, p, arg ?? 'работа') },
  'закон ловушки'(g, p) { lawTrap(g, p) },
  *'привычка'(g, p, arg) {
    // Третье посещение места за отрезок — «Привычка».
    if ((p.counters[`действие:${arg}:${p.seg}`] ?? 0) === 3) yield* gainItem(g, p, 'Привычка')
  },
  'обжорство'(g, p) {
    // Три хода подряд в ресторане — Аппетит +1.
    const last = p.counters['обжорство: ход'] ?? -9
    p.counters['обжорство: подряд'] = last === p.turns - 1 ? (p.counters['обжорство: подряд'] ?? 1) + 1 : 1
    p.counters['обжорство: ход'] = p.turns
    if (p.counters['обжорство: подряд'] === 3) charStep(g, p, 'Аппетит')
  },
  *'знакомство'(g, p) { yield* acquaintance(g, p) },
  *'контора'(g, p) { yield* kontora(g, p) },
  *'обряд'(g, p) { yield* rite(g, p) },
  'без рынка'(_g, p) { p.rules['без рынка'] = { arg: String(p.turns + 1) } },
  'поиск смысла'(g, p, arg) { searchNow(g, p, arg === 'преимущество') },
  'смысл найден'(g, p) { foundNow(g, p) },
  *'переход в класс партнёра'(g, p) { yield* partnerClass(g, p) },
  *'дело прогорело'(g, p) { yield* burn(g, p) },
  // ── Мир, Смута, эмиграция (этап 3б) ──
  'смута'(_g, p, arg) { p.rules['смута'] = { ...(arg ? { arg } : {}) } },
  *'бегство'(g, p) { yield* flight(g, p) },
  *'эмиграция'(g, p, arg) { yield* emigrationRule(g, p, arg) },
  'гражданство'(g, p) {
    const others = g.s.world.countries.filter((c) => !p.citizenship.includes(c.id))
    if (!others.length) return
    const c = pick(g, others)
    p.citizenship.push(c.id)
    say(g, p, `гражданство: ${c.name}`)
  },
  'до мирового хода'(_g, p, arg) { p.rules[`мир: ${arg ?? ''}`] = {} },
  'карантин'(_g, p) { p.rules['карантин'] = { arg: String(p.turns + 1) } },
  'срок стигмы'(_g, p, arg) { p.rules['срок стигмы'] = { ...(arg ? { arg } : {}) } },
  'отношения'(g, p, arg) { say(g, p, `отношения: ${arg ?? ''}`) },
  *'правило тюрьмы'(g, p, arg) { yield* turmoilRule(g, p, 'правило тюрьмы', arg) },
  *'выбрать сторону'(g, p, arg) { yield* turmoilRule(g, p, 'выбрать сторону', arg) },
  *'стать нейтралом'(g, p, arg) { yield* turmoilRule(g, p, 'стать нейтралом', arg) },
  *'стать проигравшим'(g, p, arg) { yield* turmoilRule(g, p, 'стать проигравшим', arg) },
  *'донос на нейтрала'(g, p, arg) { yield* turmoilRule(g, p, 'донос на нейтрала', arg) },
  *'люстрация'(g, p, arg) { yield* turmoilRule(g, p, 'люстрация', arg) },
  // ── Общественный след (18.11) ──
  'след'(g, p, arg) { traceRule(g, p, arg) },
  // ── Война (этап 3в) ──
  *'призыв'(g, p) { yield* draftCheck(g, p) },
  'фронт'(g, p) { frontNow(g, p) },
  *'награда'(g, p, arg) { yield* warRule(g, p, 'награда', arg) },
  *'метка фронта'(g, p, arg) { yield* warRule(g, p, 'метка фронта', arg) },
  *'плен'(g, p, arg) { yield* warRule(g, p, 'плен', arg) },
  *'отпуск'(g, p, arg) { yield* warRule(g, p, 'отпуск', arg) },
  *'проверка кризиса'(g, p, _arg, ctx) { yield* crisisCheck(g, g.s.world.countries[ctx.target ?? p.country], true) },
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
