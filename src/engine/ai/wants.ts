/**
 * Цели ИИ из его карты смысла (как `wants` в meanings.py симуляции, но по разобранным условиям, а не по тексту):
 * какие характеристики поднять, какие предметы и класс получить, какие записи журнала набрать, чего избегать.
 */
import { STATS, type Cond } from '../../data/schema.ts'
import type { G } from '../core.ts'
import { cond } from '../cond.ts'
import { meaningOf } from '../meaning.ts'
import type { Cls, Player, Stat } from '../types.ts'

export interface Wants {
  stats: Map<Stat, number>
  items: Set<string>
  avoidItems: Set<string>
  cls: Set<Cls>
  logs: Map<string, number>
  avoidLogs: Set<string>
  emigrate: boolean
  stay: boolean
  vozm?: number
  psy?: number
  phys?: number
  /** Очки за невыполненные условия по видам: куда смотреть в первую очередь. */
  weight: number
}

export function wantsOf(g: G, p: Player): Wants {
  const w: Wants = { stats: new Map(), items: new Set(), avoidItems: new Set(), cls: new Set(), logs: new Map(), avoidLogs: new Set(), emigrate: false, stay: false, weight: 0 }
  const m = meaningOf(g, p)
  if (!m || p.meaning?.id === 'серость') return w
  for (const k of m.conds) {
    if (k.kind === 'соб.' && p.achieved[JSON.stringify(k.cond)]) continue
    if (k.kind !== 'итог' && cond(g, p, k.cond) && !hasNegative(k.cond)) continue
    w.weight += k.points
    walk(k.cond, false)
  }
  return w

  function walk(c: Cond, neg: boolean): void {
    if ('all' in c) { c.all.forEach((x) => walk(x, neg)); return }
    if ('any' in c) { c.any.forEach((x) => walk(x, neg)); return }
    if ('not' in c) { walk(c.not, !neg); return }
    if ('atEntry' in c) { walk(c.cond, neg); return }
    if ('p' in c) {
      if (neg) return
      if ((STATS as readonly string[]).includes(c.p) && c.gte !== undefined) w.stats.set(c.p as Stat, Math.max(w.stats.get(c.p as Stat) ?? 0, c.gte))
      if (c.p === 'возм' && c.gte !== undefined) w.vozm = Math.max(w.vozm ?? -99, c.gte)
      if (c.p === 'псих' && c.gte !== undefined) w.psy = Math.max(w.psy ?? -99, c.gte)
      if (c.p === 'физ' && c.gte !== undefined) w.phys = Math.max(w.phys ?? -99, c.gte)
      return
    }
    if ('has' in c) { (neg ? w.avoidItems : w.items).add(c.has); return }
    if ('countOf' in c) { if (!neg) c.countOf.forEach((n) => w.items.add(n)); return }
    if ('count' in c) { if (!neg) w.items.add(c.count); return }
    if ('cls' in c) { if (!neg) c.cls.forEach((x) => w.cls.add(x)); return }
    if ('log' in c) {
      const avoid = neg ? c.gte !== undefined : c.lte === 0
      if (avoid) w.avoidLogs.add(c.log)
      else if (c.gte !== undefined) w.logs.set(c.log, Math.max(w.logs.get(c.log) ?? 0, c.gte))
      if (!neg && ['эмиграция', 'бегство', 'вход в отрезок без документов', 'обряд в новой стране'].includes(c.log) && c.gte) w.emigrate = true
      if (c.log === 'эмиграция' && c.lte === 0 && !neg) w.stay = true
      return
    }
    if ('emigrant' in c) { if (c.emigrant !== neg) w.emigrate = true; else w.stay = true }
  }
}

/** Условие содержит «не» или «никогда» — его держат, даже если сейчас выполнено. */
function hasNegative(c: Cond): boolean {
  if ('not' in c) return true
  if ('log' in c) return c.lte === 0
  if ('all' in c) return c.all.some(hasNegative)
  if ('any' in c) return c.any.some(hasNegative)
  return false
}

/** Сколько недостаёт до нужного: характеристики смысла по возрастанию разрыва. */
export function statGaps(p: Player, w: Wants): [Stat, number][] {
  return [...w.stats].map(([s, n]) => [s, n - p.stats[s]] as [Stat, number]).filter(([, gap]) => gap > 0).sort((a, b) => a[1] - b[1])
}
