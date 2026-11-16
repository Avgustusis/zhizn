/** Почему условие не выполнено — обычными словами, для закрытых вариантов («закрыто: идеология Теократия»). */
import type { Cond } from '../data/schema.ts'
import { renderCond } from '../data/render.ts'
import { cond, type Ctx } from './cond.ts'
import type { G } from './core.ts'
import type { Player } from './types.ts'

export function whyNot(g: G, p: Player, c: Cond | undefined, ctx?: Ctx): string | undefined {
  if (!c || cond(g, p, c, ctx)) return undefined
  if ('all' in c) for (const x of c.all) { const r = whyNot(g, p, x, ctx); if (r) return r }
  if ('not' in c) return `нельзя, если ${renderCond(c.not)}`
  return `нужно: ${renderCond(c)}`
}
