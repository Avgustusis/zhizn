/**
 * Город: здания и колоды знакомств — src/data/city.json.
 *   npx tsx tools/build-city.ts
 * Здания и кольца — из таблицы «Здания» концепции (раздел «Город и знакомства»),
 * встречи — из reference/docs/acquaintances.md. Полюса характера пишутся в документе в дательном падеже
 * («к Усердию»), в данных — именем полюса («Усердие»).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { CityFile, CHAR_POLES } from '../src/data/schema.ts'
import { readTable } from './events-md.ts'
import { compactJson } from './json-compact.ts'

const concept = readFileSync('reference/docs/concept.md', 'utf8')
const acq = readFileSync('reference/docs/acquaintances.md', 'utf8')

/** Дательный падеж полюса → полюс. */
const DATIVE: Record<string, (typeof CHAR_POLES)[number]> = {
  'Самолюбию': 'Самолюбие', 'Скромности': 'Скромность', 'Хватке': 'Хватка', 'Щедрости': 'Щедрость',
  'Влюбчивости': 'Влюбчивость', 'Верности': 'Верность', 'Соперничеству': 'Соперничество', 'Участию': 'Участие',
  'Аппетиту': 'Аппетит', 'Мере': 'Мера', 'Вспыльчивости': 'Вспыльчивость', 'Выдержке': 'Выдержка',
  'Беспечности': 'Беспечность', 'Усердию': 'Усердие',
}
/** Большой обмен есть только здесь (ответы автора 13.11; концепция, таблица «Места»). */
const BIG = ['Больница', 'Психолог', 'Храм', 'Фонд', 'Заповедник']

// ── Здания из концепции: «Завод (Работа)» — здание и точка рынка; без скобок — имя здания и есть точка ──
const RINGS = { 'Окраина': 'окраина', 'Середина': 'середина', 'Центр': 'центр', 'За городом': 'за городом' } as const
const buildings: { name: string; ring: (typeof RINGS)[keyof typeof RINGS]; market?: string; deck: boolean }[] = []
for (const row of readTable(concept, '### Здания')) {
  const ring = RINGS[row['Кольцо'] as keyof typeof RINGS]
  if (!ring) throw new Error(`неизвестное кольцо: ${row['Кольцо']}`)
  for (const [col, deck] of [['Здания с колодой знакомств', true], ['Точки рынка без колоды', false]] as const) {
    if (row[col] === '—') continue
    for (const part of row[col].split(/,\s*(?![^(]*\))/)) {
      const m = part.trim().match(/^(.+?)(?: \((.+)\))?$/)!
      buildings.push({ name: m[1], ring, deck, ...(m[2] ? { market: m[2].split(';')[0] } : {}) })
    }
  }
}

// ── Встречи ──
const lines = acq.split('\n')
const decks: Record<string, unknown[]> = {}
const points: Record<string, string> = {}
const about: Record<string, string> = {}
for (let i = 0; i < lines.length; i++) {
  const h = lines[i].match(/^### (.+?)(?: · точка рынка «(.+)»)?$/)
  if (!h) continue
  const name = h[1]
  if (h[2]) points[name] = h[2]
  about[name] = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('|'))!.trim()
  decks[name] = readTable(lines.slice(i).join('\n'), lines[i]).map((r) => {
    const poles = r['Характер: шаг к…'].split(' или ').map((x) => DATIVE[x.trim()])
    if (poles.length !== 2 || poles.some((x) => !x)) throw new Error(`${name} № ${r['№']}: полюса «${r['Характер: шаг к…']}»`)
    return { n: Number(r['№']), title: r['Встреча'], text: r['Текст'], poles, ...(r['📇'] ? { acquaintance: true } : {}) }
  })
}

const out = CityFile.parse({
  buildings: buildings.map((b) => {
    const cards = decks[b.name]
    if (b.deck && !cards) throw new Error(`у здания «${b.name}» нет колоды в acquaintances.md`)
    // Точка рынка: в скобках у концепции; иначе — из заголовка колоды; иначе здание без колоды само и есть точка.
    const market = b.market ?? points[b.name] ?? (b.deck ? undefined : b.name)
    return {
      id: b.name, name: b.name, ring: b.ring,
      ...(market ? { market } : {}),
      ...(BIG.includes(market ?? '') || BIG.includes(b.name) ? { big: true } : {}),
      ...(cards ? { about: about[b.name], deck: cards } : {}),
    }
  }),
})
const extra = Object.keys(decks).filter((d) => !buildings.some((b) => b.name === d))
if (extra.length) throw new Error(`колоды без здания в концепции: ${extra.join(', ')}`)
writeFileSync('src/data/city.json', compactJson(out) + '\n')
const withDeck = out.buildings.filter((b) => b.deck)
console.log(`город: ${out.buildings.length} зданий, с колодой ${withDeck.length}, встреч ${withDeck.reduce((s, b) => s + b.deck!.length, 0)}, с 📇 ${withDeck.reduce((s, b) => s + b.deck!.filter((c) => c.acquaintance).length, 0)}`)
for (const b of out.buildings) console.log(`  ${b.ring.padEnd(10)} ${b.name}${b.market ? ` → ${b.market}` : ''}${b.big ? ' ■▲' : ''}${b.deck ? ` [${b.deck.length}]` : ''}`)
