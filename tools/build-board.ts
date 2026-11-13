/**
 * Поле жизни: порядок клеток из макета `reference/components/BoardLife.dc.html`.
 *   npx tsx tools/build-board.ts
 * В макете каждая клетка — группа <g> с подписью типа и номером; порядок групп — порядок хода.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Board, CELL_TYPES, type BoardCell } from '../src/data/board-schema.ts'
import { SEGMENTS } from '../src/data/schema.ts'

const html = readFileSync('reference/components/BoardLife.dc.html', 'utf8')
const groups = [...html.matchAll(/<g transform="translate\([\d.]+ [\d.]+\)(?: rotate\(-?\d+\))?">(.*?)<\/g>/gs)]

const TYPE: Record<string, BoardCell['type']> = {
  'СТАРТ': 'старт', 'ВОЗРАСТ': 'возраст', 'ОТНОШЕНИЯ': 'отношения', 'КУЛЬТУРА': 'культура', 'СТРАНА': 'страна',
  'КЛАСС': 'класс', 'РАЗВИЛКА': 'развилка', 'СУДЬБА': 'судьба', 'тихая': 'тихая', 'ИТОГ': 'итог воспитания',
  'ЗАВЕЩАНИЕ': 'завещание', 'ФИНАЛ': 'финал',
}
/** Сколько нумерованных клеток в первом подсекторе отрезка (концепция, «Подсекторы отрезков»). */
const FIRST_SUB = [10, 15, 15, 15, 15, 15]

const cells: { type: BoardCell['type']; n?: number; fork?: string }[] = []
for (const [, body] of groups) {
  if (!body.includes('height="4.6"')) continue
  const texts = [...body.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)]
  const num = texts.filter(([, a]) => a.includes('text-anchor="end"')).map(([, , t]) => t).at(-1)
  const labels = texts.filter(([, a]) => !a.includes('text-anchor="end"')).map(([, , t]) => t)
  const type = TYPE[labels[0]]
  if (!type) throw new Error(`неизвестная клетка: ${labels.join(' / ')}`)
  const cell: (typeof cells)[number] = { type }
  if (num) cell.n = Number(num)
  if (type === 'развилка' && labels[1]) cell.fork = labels[1]
  cells.push(cell)
}

// Режем на отрезки: новый отрезок начинается с клетки № 1.
const segments: { seg: (typeof SEGMENTS)[number]; cells: BoardCell[] }[] = []
for (const c of cells) {
  if (c.n === 1) segments.push({ seg: SEGMENTS[segments.length], cells: [] })
  const s = segments.at(-1)!
  const si = segments.length - 1
  // Клетка «Класс» без номера стоит внутри подсектора: берём подсектор предыдущей нумерованной клетки.
  const lastN = c.n ?? [...s.cells].reverse().find((x) => x.n !== undefined)?.n ?? 1
  s.cells.push({ ...c, sub: lastN <= FIRST_SUB[si] ? 0 : 1 })
}

const board = Board.parse({ segments })
const count = (t: string) => cells.filter((c) => c.type === t).length
writeFileSync('src/data/board.json', JSON.stringify(board, null, 1).replace(/\{\n\s+"type": ([^}]*?)\n\s+\}/gs, (_, b: string) => `{ "type": ${b.replace(/\n\s+/g, ' ')} }`) + '\n')
console.log(`поле: ${cells.length} клеток; ` + segments.map((s) => `${s.seg} ${s.cells.length}`).join(', '))
console.log(CELL_TYPES.map((t) => `${t} ${count(t)}`).join(', '))
