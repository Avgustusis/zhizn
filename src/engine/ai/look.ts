/**
 * Проиграть вариант на копии партии и оценить итог. Честный ИИ играет копию со своими кубиками и перетасованными
 * колодами — он знает только то, что видит игрок. «Нечестно» берёт настоящие кубики и порядок колод.
 */
import type { Node } from '../../data/schema.ts'
import { seedRng, type G } from '../core.ts'
import { newCtx } from '../cond.ts'
import { run } from '../exec.ts'
import { settle } from '../meaning.ts'
import type { GameState, Player, Request } from '../types.ts'
import { answer as simple } from './simple.ts'

/** Детерминированный генератор ИИ: от зерна партии, номера вопроса и номера пробы (генератор движка не трогаем). */
export function aiRng(g: G, req: Request, salt: number): () => number {
  let h = (Math.imul(g.s.config.seed ^ 0x5bd1e995, 0x27d4eb2d) + Math.imul(req.n + 1, 0x165667b1) + Math.imul(salt + 7, 0x9e3779b9)) >>> 0
  return () => {
    h = (h + 0x6d2b79f5) >>> 0
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drain(flow: ReturnType<typeof run>, g2: G): void {
  let guard = 0
  for (let r = flow.next(); !r.done; r = flow.next(simple(g2, r.value))) if (++guard > 200) break
}

/** Копия партии без журнала. honest — свои кубики и перетасованные колоды; иначе («Нечестно») колоды в настоящем порядке, кубики свои. */
export function fork(g: G, rand: () => number, honest: boolean): G {
  const { log, ...rest } = g.s
  const s = structuredClone(rest) as GameState
  s.log = []
  void log
  s.rng = seedRng(Math.floor(rand() * 4294967296))
  if (honest) {
    for (const pile of Object.values(s.piles)) {
      for (let i = pile.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]] }
    }
  }
  return { ...g, s }
}

/** Выполнить шаги на копии; вложенные вопросы решает простой ИИ. Возвращает игрока копии. */
export function play(g2: G, seat: number, nodes: Node[], card?: string): Player {
  const p = g2.s.players[seat]
  const tags = card ? g2.cards.get(card)?.card.tags ?? [] : []
  const before = p.laters.length
  drain(run(g2, p, nodes, newCtx('карта', { card, tags })), g2)
  // Отложенное («на 16-й клетке — Диплом») засчитываем сразу: иначе учёба выглядит как одни потери.
  for (const l of p.laters.splice(before)) if (p.alive) drain(run(g2, p, l.then, newCtx('карта', { card: l.card, tags })), g2)
  settle(g2, p)
  return p
}
