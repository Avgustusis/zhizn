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
import { existsSync } from 'node:fs'
import { CLASSES, Card, DECK_FILES, DeckFile, SEGMENTS, type DeckId } from '../src/data/schema.ts'
import { readTable, sectionRows } from './events-md.ts'
import { compactJson } from './json-compact.ts'

const [deck, header, effectsPath] = process.argv.slice(2) as [DeckId, string, string | undefined]
if (!deck || !header) {
  console.error('usage: build-deck.ts <deck-id> "<header>" [effects.json]')
  process.exit(1)
}
const md = readFileSync(resolve('reference/docs/events.md'), 'utf8')
/** Колода «Класс»: шесть стопок под заголовками «#### Народ (21)» и т. д., нумерация в каждой своя. */
const CLASS_DECK = deck === 'класс'
const rows: Record<string, string>[] = CLASS_DECK
  ? CLASSES.flatMap((cl) => {
      try {
        return sectionRows(md, `#### ${cl}`).map((r) => ({ ...r, _cls: cl }))
      } catch {
        return []
      }
    })
  : sectionRows(md, header)
const miracles = new Map(readTable(md, '## Чудеса').map((r) => [r['Карта'], r['Текст']]))
const outPath = resolve(`src/data/decks/${DECK_FILES[deck]}.json`)
type Effects = Record<string, { effect: unknown; doubts?: string[]; requires?: unknown; cancelBy?: string[] }>
/** Ключ карты по id: «возраст.детство.04» → «4», «класс.народ.01» → «Народ.1». */
function keyOf(c: Card): string {
  const parts = c.id.split('.')
  const num = parts.pop()!.replace(/^0+(?=\d)/, '')
  return c.cls ? `${c.cls}.${num}` : num
}
// Разбор берётся из уже собранного файла колоды, поверх — из effects.json (если дан).
const existing: Effects = existsSync(outPath)
  ? Object.fromEntries(DeckFile.parse(JSON.parse(readFileSync(outPath, 'utf8'))).cards.map((c) => [keyOf(c), { effect: c.effect, doubts: c.doubts, requires: c.requires, cancelBy: c.cancelBy }]))
  : {}
const effects: Effects = { ...existing, ...(effectsPath ? JSON.parse(readFileSync(effectsPath, 'utf8')) : {}) }

/** Тип карты, если в документе его нет: развилка — решение; иначе по разбору (выбор → Р, проверка → П, иначе Б). */
function kindOf(effect: unknown, fork: boolean): 'Б' | 'П' | 'Р' {
  if (fork) return 'Р'
  const s = JSON.stringify(effect)
  return s.includes('"choose"') ? 'Р' : s.includes('"check"') ? 'П' : 'Б'
}

const SUB_LEGENDS: Partial<Record<DeckId, Record<string, string>>> = {
  'возраст.детство': { 'М': 'Младенчество (клетки 1–10)', 'Ш': 'Ранняя школа (клетки 11–30)' },
  'возраст.юность': { 'С': 'Средняя школа (клетки 1–15)', 'В': 'Выпуск (клетки 16–30)' },
  'возраст.молодость': { 'У': 'Учёба или первая работа (клетки 1–15)', 'С': 'Самостоятельность (клетки 16–30)' },
  'возраст.зрелость': { 'Д': 'Дом и должность (клетки 1–15)', 'Н': 'На полпути (клетки 16–30)' },
  'возраст.старость': { 'О': 'Отставка (клетки 1–15)', 'Т': 'Тихий час (клетки 16–30)' },
  'возраст.древность': { 'С': 'Свидетель (клетки 1–15)', 'Э': 'Эпилог (клетки 16–30)' },
}

const SEG_CODES: Record<string, (typeof SEGMENTS)[number]> = { 'Д': 'Детство', 'Ю': 'Юность', 'М': 'Молодость', 'З': 'Зрелость', 'С': 'Старость', 'Др': 'Древность' }
function parseSegs(s: string): (typeof SEGMENTS)[number][] {
  if (s.trim() === 'все') return CLASS_DECK ? ['Юность', 'Молодость', 'Зрелость', 'Старость'] : [...SEGMENTS]
  return s.trim().split(/\s+/).map((c) => {
    const seg = SEG_CODES[c]
    if (!seg) throw new Error(`неизвестный отрезок «${c}» в «${s}»`)
    return seg
  })
}

// У карт институтов нет номеров: нумеруем по порядку в документе.
rows.forEach((r, i) => { if (r['№'] === undefined) r['№'] = String(i + 1) })
// Повтор номера в документе (ошибка нумерации) получает букву: «17», «17б».
const seenN = new Map<string, number>()
const keys = rows.map((r) => {
  const k = seenN.get(r['№']) ?? 0
  seenN.set(r['№'], k + 1)
  return k === 0 ? r['№'] : r['№'] + 'бвгд'[k - 1]
})
if (CLASS_DECK) rows.forEach((r, i) => (keys[i] = `${r._cls}.${r['№']}`))
const POLAR: DeckId[] = ['культура']
/** Номера, которые автор назначил иначе, чем стоит в снимке документа (до обновления документа). */
const RENUMBER: Partial<Record<DeckId, Record<string, string>>> = { 'культура': { '17б': '61' } }
for (let i = 0; i < keys.length; i++) keys[i] = RENUMBER[deck]?.[keys[i]] ?? keys[i]

// В «Классе» стопки переводятся по очереди: стопка без разбора пока пропускается.
const cards = rows.flatMap((r, i) => {
  const key = keys[i]
  const n = Number(key.replace(/^.*\./, '').replace(/[^0-9]/g, ''))
  const e = effects[key]
  if (!e && CLASS_DECK && !Object.keys(effects).some((k) => k.startsWith(r._cls + '.'))) return []
  if (!e) throw new Error(`нет разбора для карты ${key} «${r['Карта'] ?? r['Развилка']}»`)
  // У развилок название — в колонке «Развилка», пути — в «Пути», место на поле — в «Клетка».
  const name = r['Карта'] ?? r['Развилка']
  const miracle = name.includes('✨')
  const title = name.replace('✨', '').trim()
  const card = {
    id: CLASS_DECK
      ? `${deck}.${r._cls.toLowerCase()}.${String(n).padStart(2, '0')}`
      : `${deck}.${key.padStart(key.length + 2 - String(n).length, '0')}`,
    ...(CLASS_DECK ? { cls: r._cls } : {}),
    n,
    title,
    text: miracle ? (miracles.get(title) ?? r['Текст'] ?? '') : (r['Текст'] ?? ''),
    src: r['Эффект'] ?? r['Пути'],
    kind: r['Тип'] ?? kindOf(e.effect, r['Развилка'] !== undefined),
    ...(r['Фильтр'] ? { filter: r['Фильтр'] } : {}),
    ...(r['Клетка'] && r['Клетка'] !== 'колода' ? { cell: r['Клетка'] } : {}),
    sub: r['Когда'] ? [...r['Когда']] : undefined,
    segs: r['Отрезки'] ? parseSegs(r['Отрезки']) : undefined,
    tags: r['Теги'] === '—' ? [] : r['Теги'].split(/\s+/).filter(Boolean),
    ...(e.requires ? { requires: e.requires } : {}),
    ...(e.cancelBy ? { cancelBy: e.cancelBy } : {}),
    ...(miracle ? { miracle: true } : {}),
    effect: e.effect,
    ...(e.doubts?.length ? { doubts: e.doubts } : {}),
  }
  const parsed = Card.safeParse(card)
  if (!parsed.success) throw new Error(`карта ${n} «${title}»:\n${JSON.stringify(parsed.error.issues, null, 2)}`)
  return [parsed.data]
})

const extra = Object.keys(effects).filter((k) => !keys.includes(k))
if (extra.length) throw new Error(`в разборе лишние номера: ${extra.join(', ')}`)

const file = DeckFile.parse({ deck, ...(POLAR.includes(deck) ? { polar: true } : {}), sub: SUB_LEGENDS[deck], cards })
mkdirSync(resolve('src/data/decks'), { recursive: true })
writeFileSync(outPath, compactJson(file) + '\n')
console.log(`${deck}: ${cards.length} карт, спорных ${cards.filter((c) => c.doubts).length}`)
