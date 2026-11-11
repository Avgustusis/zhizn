/**
 * Собирает файл колоды из документа колод и разбора эффектов.
 *
 *   npx tsx tools/build-deck.ts <deck-id> "<заголовок раздела>" [effects.json]
 *
 * Название, текст, тип, отметки, теги и оригинальный эффект берутся дословно из
 * reference/docs/events.md, разбор эффектов — из effects.json ({ "<№>": { effect, doubts } }).
 * Без effects.json разбор берётся из уже собранного файла колоды: так колода обновляется
 * после правки документа, а разбор остаётся.
 * Результат — src/data/decks/<имя файла из DECK_FILES>.json. Повторный запуск перезаписывает файл.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Card, DECK_FILES, DeckFile, type DeckId } from '../src/data/schema.ts'
import { readTable, sectionRows } from './events-md.ts'
import { compactJson } from './json-compact.ts'

const [deck, header, effectsPath] = process.argv.slice(2) as [DeckId, string, string | undefined]
if (!deck || !header) {
  console.error('usage: build-deck.ts <deck-id> "<header>" [effects.json]')
  process.exit(1)
}
const md = readFileSync(resolve('reference/docs/events.md'), 'utf8')
const rows = sectionRows(md, header)
const miracles = new Map(readTable(md, '## Чудеса').map((r) => [r['Карта'], r['Текст']]))
const outPath = resolve(`src/data/decks/${DECK_FILES[deck]}.json`)
const effects: Record<string, { effect: unknown; doubts?: string[]; requires?: unknown; cancelBy?: string[] }> = effectsPath
  ? JSON.parse(readFileSync(effectsPath, 'utf8'))
  : Object.fromEntries(DeckFile.parse(JSON.parse(readFileSync(outPath, 'utf8'))).cards.map((c) => [String(c.n), { effect: c.effect, doubts: c.doubts, requires: c.requires, cancelBy: c.cancelBy }]))

const SUB_LEGENDS: Partial<Record<DeckId, Record<string, string>>> = {
  'возраст.детство': { 'М': 'Младенчество (клетки 1–10)', 'Ш': 'Ранняя школа (клетки 11–30)' },
  'возраст.юность': { 'С': 'Средняя школа (клетки 1–15)', 'В': 'Выпуск (клетки 16–30)' },
  'возраст.молодость': { 'У': 'Учёба или первая работа (клетки 1–15)', 'С': 'Самостоятельность (клетки 16–30)' },
  'возраст.зрелость': { 'Д': 'Дом и должность (клетки 1–15)', 'Н': 'На полпути (клетки 16–30)' },
  'возраст.старость': { 'О': 'Отставка (клетки 1–15)', 'Т': 'Тихий час (клетки 16–30)' },
  'возраст.древность': { 'С': 'Свидетель (клетки 1–15)', 'Э': 'Эпилог (клетки 16–30)' },
}

const cards = rows.map((r) => {
  const n = Number(r['№'])
  const e = effects[String(n)]
  if (!e) throw new Error(`нет разбора для карты ${n} «${r['Карта']}»`)
  const miracle = r['Карта'].includes('✨')
  const title = r['Карта'].replace('✨', '').trim()
  const card = {
    id: `${deck}.${String(n).padStart(2, '0')}`,
    n,
    title,
    text: miracle ? (miracles.get(title) ?? r['Текст']) : r['Текст'],
    src: r['Эффект'],
    kind: r['Тип'],
    sub: r['Когда'] ? [...r['Когда']] : undefined,
    tags: r['Теги'] === '—' ? [] : r['Теги'].split(/\s+/).filter(Boolean),
    ...(e.requires ? { requires: e.requires } : {}),
    ...(e.cancelBy ? { cancelBy: e.cancelBy } : {}),
    ...(miracle ? { miracle: true } : {}),
    effect: e.effect,
    ...(e.doubts?.length ? { doubts: e.doubts } : {}),
  }
  const parsed = Card.safeParse(card)
  if (!parsed.success) throw new Error(`карта ${n} «${title}»:\n${JSON.stringify(parsed.error.issues, null, 2)}`)
  return parsed.data
})

const extra = Object.keys(effects).filter((k) => !rows.some((r) => r['№'] === k))
if (extra.length) throw new Error(`в разборе лишние номера: ${extra.join(', ')}`)

const file = DeckFile.parse({ deck, sub: SUB_LEGENDS[deck], cards })
mkdirSync(resolve('src/data/decks'), { recursive: true })
writeFileSync(outPath, compactJson(file) + '\n')
console.log(`${deck}: ${cards.length} карт, спорных ${cards.filter((c) => c.doubts).length}`)
