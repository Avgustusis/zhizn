/**
 * ИИ-соперники (этап 4): выбор ИИ по месту за столом. Простой ИИ — проверка правил и «Ход за ИИ»;
 * уровни сложности и характеры — smart.ts.
 */
import type { G } from '../core.ts'
import { charLean } from '../cond.ts'
import type { CharPole, Cls, Player, Request } from '../types.ts'
import { aiRng } from './look.ts'
import { answer as simple } from './simple.ts'
import { smartAnswer, type Level } from './smart.ts'

export type AiKind = 'simple' | Level

export function aiAnswer(g: G, req: Request, kind?: AiKind): string {
  const oligarch = oligarchOffer(g, req)
  if (oligarch) return oligarch
  const k = kind ?? g.s.config.seats[req.player]?.ai ?? 'normal'
  return k === 'simple' ? simple(g, req) : smartAnswer(g, req, k)
}

/** Какая черта (сильная) толкает Олигарха в класс (концепция, 24.11). */
const PUSH: Partial<Record<Cls, CharPole>> = { 'Мафия': 'Вспыльчивость', 'Интеллигенция': 'Скромность', 'Армия': 'Выдержка', 'Полиция': 'Выдержка' }

/**
 * ИИ-Олигарх и предложение перейти в другой класс («разрешено перейти», исход Рынка молодости): остаётся, если характер
 * не толкает; толкает — сильная черта (Мафия — Вспыльчивость, Интеллигенция — Скромность, Армия и Полиция — Выдержка),
 * и тогда уходит на d6 1–3. Не такой вопрос — undefined.
 */
export function oligarchOffer(g: G, req: Request): string | undefined {
  const p: Player | undefined = g.s.players[req.player]
  if (!p || p.cls !== 'Олигархи') return undefined
  const go = req.options.find((o) => !o.off && /^перейти в класс /.test(o.label))
  const stay = req.options.find((o) => !o.off && (o.id === 'нет' || /^остаться/.test(o.label)))
  if (!go || !stay || req.options.filter((o) => !o.off).length !== 2) return undefined
  const to = go.label.replace(/^перейти в класс /, '').trim() as Cls
  const pole = PUSH[to]
  const leave = !!pole && charLean(p, pole) === 2 && Math.floor(aiRng(g, req, 31)() * 6) + 1 <= 3
  return leave ? go.id : stay.id
}
