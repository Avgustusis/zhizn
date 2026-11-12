/**
 * Собирает src/data/items.json из документа предметов (reference/docs/items.md) и разбора tools/item-defs.ts.
 *
 *   npx tsx tools/build-items.ts
 *
 * Тексты, число копий и цена скупки — дословно из документа. Карта без разбора — ошибка сборки.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Item, ItemsFile } from '../src/data/schema.ts'
import { DEFS, DOUBTS, EXTRA } from './item-defs.ts'
import { readTable } from './events-md.ts'
import { compactJson } from './json-compact.ts'

const md = readFileSync(resolve('reference/docs/items.md'), 'utf8')

type Section = { header: string; kind: Item['kind']; deck: Item['deck']; group?: Item['group']; nameCol?: string; copies?: number }
const SECTIONS: Section[] = [
  { header: '### Партнёр / Супруг(а)', kind: 'связь', deck: 'каталог', group: 'Партнёр', copies: 1 },
  { header: '### Ребёнок / воспитанник', kind: 'связь', deck: 'каталог', group: 'Ребёнок', copies: 1 },
  { header: '### Друг —', kind: 'связь', deck: 'каталог', group: 'Друг', copies: 1 },
  { header: '### Наставник', kind: 'связь', deck: 'каталог', group: 'Наставник', copies: 1 },
  { header: '### Покровитель', kind: 'связь', deck: 'каталог', group: 'Покровитель', copies: 1 },
  { header: '## Каталог: статусы', kind: 'статус', deck: 'каталог' },
  { header: '## Каталог: обычные козыри', kind: 'козырь', deck: 'каталог' },
  { header: '## Каталог: стигмы', kind: 'стигма', deck: 'каталог' },
  { header: '## Каталог: вещи', kind: 'вещь', deck: 'каталог', nameCol: 'Вещь' },
  { header: '## Каталог: своё дело', kind: 'дело', deck: 'каталог' },
  { header: '## Колода «Верхи»', kind: 'козырь', deck: 'Верхи', copies: 1 },
  { header: '## Колода «Дно»', kind: 'антикозырь', deck: 'Дно', copies: 1 },
]

const items: Item[] = []
const missing: string[] = []
for (const sec of SECTIONS) {
  for (const row of readTable(md, sec.header)) {
    const nameCol = sec.nameCol ?? 'Карта'
    let name = row[nameCol]
    let copies = sec.copies ?? Number(row['Копий'])
    const times = name.match(/^(.+?) ×(\d+)$/)
    if (times) { name = times[1]; copies = Number(times[2]) }
    const def = DEFS[name]
    if (!def) { missing.push(name); continue }
    const src = Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== nameCol && k !== 'Копий' && v !== '—' && v !== ''))
    const sell = row['Скупка'] && row['Скупка'] !== '—' ? Number(row['Скупка']) : undefined
    items.push(Item.parse({
      name, kind: sec.kind, deck: sec.deck, ...(sec.group ? { group: sec.group } : {}), copies, src,
      ...(sell ? { sell } : {}),
      ...def,
      ...(DOUBTS[name]?.length ? { doubts: DOUBTS[name] } : {}),
    }))
  }
}
if (missing.length) {
  console.error(`нет разбора (${missing.length}): ${missing.join(', ')}`)
  process.exit(1)
}
const unused = Object.keys(DEFS).filter((k) => !items.some((i) => i.name === k))
if (unused.length) { console.error('в разборе лишнее:', unused); process.exit(1) }
items.push(...EXTRA.map((x) => Item.parse(x)))

writeFileSync(resolve('src/data/items.json'), compactJson(ItemsFile.parse({ items })) + '\n')
const by = (f: (i: Item) => boolean) => items.filter(f).reduce((s, i) => s + i.copies, 0)
console.log(`предметы: ${items.length} видов; каталог ${by((i) => i.deck === 'каталог' && i.kind !== 'дело')} карт, дело ${by((i) => i.kind === 'дело')}, Верхи ${by((i) => i.deck === 'Верхи')}, Дно ${by((i) => i.deck === 'Дно')}; спорных ${items.filter((i) => i.doubts).length}`)
