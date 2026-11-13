/** Поле жизни: шесть отрезков, в каждом — клетки по порядку хода. */
import { z } from 'zod'
import { SEGMENTS } from './schema.ts'

export const CELL_TYPES = [
  'старт', 'возраст', 'отношения', 'культура', 'страна', 'класс', 'развилка', 'судьба', 'тихая',
  'итог воспитания', 'завещание', 'финал',
] as const

export const BoardCell = z.strictObject({
  type: z.enum(CELL_TYPES),
  /** Номер на поле. У клеток «Класс» номера нет: они добавлены сверх тридцати. */
  n: z.number().int().positive().optional(),
  /** Напечатанная развилка: название карты развилки («Образование»). Без названия — тянут из колоды. */
  fork: z.string().optional(),
  /** Подсектор отрезка: 0 — первый, 1 — второй. */
  sub: z.union([z.literal(0), z.literal(1)]),
})
export type BoardCell = z.infer<typeof BoardCell>

export const Board = z.strictObject({
  segments: z.array(z.strictObject({ seg: z.enum(SEGMENTS), cells: z.array(BoardCell).min(1) })).length(SEGMENTS.length),
})
export type Board = z.infer<typeof Board>
