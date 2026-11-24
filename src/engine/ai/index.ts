/**
 * ИИ-соперники (этап 4): выбор ИИ по месту за столом. Простой ИИ — проверка правил и «Ход за ИИ»;
 * уровни сложности и характеры — smart.ts.
 */
import type { G } from '../core.ts'
import type { Request } from '../types.ts'
import { answer as simple } from './simple.ts'
import { smartAnswer, type Level } from './smart.ts'

export type AiKind = 'simple' | Level

export function aiAnswer(g: G, req: Request, kind?: AiKind): string {
  const k = kind ?? g.s.config.seats[req.player]?.ai ?? 'normal'
  return k === 'simple' ? simple(g, req) : smartAnswer(g, req, k)
}
