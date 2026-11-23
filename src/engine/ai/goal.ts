/**
 * Чего хочет ИИ: близость к условиям своей карты смысла и «запас жизни» (здоровье, деньги, класс, предметы).
 * Оценка — одно число: чем больше, тем лучше положение игрока. ИИ сравнивает её до и после варианта.
 */
import { SEGMENTS, STATS, type Cond } from '../../data/schema.ts'
import type { G } from '../core.ts'
import { cond, derived, has, held, kindOf, paramValue } from '../cond.ts'
import { meaningOf } from '../meaning.ts'
import type { Player } from '../types.ts'

/** Насколько условие близко к выполнению: 1 — выполнено, 0 — далеко. Для чисел — доля пути до порога. */
export function near(g: G, p: Player, c: Cond): number {
  if (cond(g, p, c)) return 1
  if ('all' in c) return c.all.reduce((s, x) => s + near(g, p, x), 0) / c.all.length
  if ('any' in c) return Math.max(...c.any.map((x) => near(g, p, x)))
  const span = (v: number, lo: number | undefined, hi: number | undefined, width: number): number => {
    if (lo !== undefined && v < lo) return Math.max(0, 1 - (lo - v) / width) * 0.85
    if (hi !== undefined && v > hi) return Math.max(0, 1 - (v - hi) / width) * 0.85
    return 1
  }
  if ('p' in c) return span(paramValue(g, p, c.p), c.gte, c.lte, (STATS as readonly string[]).includes(c.p) ? 4 : ['Финансы', 'Положение', 'Сплочённость'].includes(c.p) ? 3 : 8)
  if ('val' in c) return span(derived(g, p, c.val), c.gte, c.lte, 3)
  if ('log' in c) return span(p.counters[c.log] ?? 0, c.gte, c.lte, 2)
  if ('count' in c) return Math.min(1, held(g, p, c.count).length / c.gte) * 0.85
  if ('countOf' in c) return (c.countOf.filter((n) => has(g, p, n)).length / c.gte) * 0.85
  if ('reached' in c) return Math.min(1, (p.seg + 1) / (SEGMENTS.indexOf(c.reached) + 1)) * 0.85
  return 0
}

/** Очки карты смысла с близостью: выполненное — полностью, остальное — по близости (итоги — как если бы жизнь кончилась сейчас). */
export function meaningOutlook(g: G, p: Player): number {
  const m = meaningOf(g, p)
  if (!m) return 0
  let v = 0
  for (const k of m.conds) {
    if (k.kind === 'соб.' && p.achieved[JSON.stringify(k.cond)]) { v += k.points; continue }
    // «Никогда не…» (не, нет): нарушенное «соб.» не вернуть, но и выполнять его не нужно — считаем по текущему состоянию.
    v += k.points * near(g, p, k.cond)
  }
  return v
}

/** Вес шкал для оценки (подобран сверкой: см. docs/SIM-COMPARE.md). */
export const W = { meaning: 2, death: 30, inst: 4, stigma: 2.5, link: 1.2, status: 1.5, stat: 0.8, cls: 1.5, family: 1, spouse: 5, child: 3.5, partner: 2 }

const STIGMAS = ['Судимость', 'Дурная слава', 'Враг', 'Долг', 'Учёт', 'Без документов', 'Привычка']

const health = (x: number): number => (x >= 3 ? 3 + 0.3 * (x - 3) : x <= -3 ? -3 + 1.8 * (x + 3) : x)
const money = (v: number): number => (v < 0 ? 1.3 * v : v < 10 ? 0.6 * v : 6 + 0.2 * (v - 10))

/** Оценка положения игрока. `taste` — поправки характера к весам (src/engine/ai/persona.ts). */
export function outlook(g: G, p: Player, taste: Partial<typeof W> & { phys?: number; psy?: number; vozm?: number } = {}): number {
  const w = { ...W, ...taste }
  let v = w.meaning * meaningOutlook(g, p)
  if (!p.alive) return v - w.death * (1 - p.seg / 6)
  v += (taste.phys ?? 1) * health(p.phys) + (taste.psy ?? 1) * health(p.psy) + (taste.vozm ?? 1) * money(p.vozm)
  if (p.inst && p.inst.kind !== 'фронт') v -= w.inst * Math.min(3, p.inst.left)
  for (const h of p.items) {
    const kind = kindOf(g, h)
    if (STIGMAS.includes(h.name)) v -= w.stigma
    else if (kind === 'связь') {
      // Семья дороже прочих связей — как в симуляции (V_SPOUSE, V_CHILD): брак и дети ценны и без цели смысла.
      const group = g.items.get(h.name)?.group
      v += w.link + (h.spouse ? w.spouse : group === 'Ребёнок' ? w.child : group === 'Партнёр' ? w.partner : 0)
    }
    else if (kind === 'статус' || kind === 'козырь' || kind === 'дело') v += w.status
  }
  for (const s of STATS) v += w.stat * Math.min(p.stats[s], 10) / 3
  v += w.cls * g.c.tables.work.ladder[p.cls] + w.family * (p.fin + p.pos + p.coh) / 2
  return v
}
