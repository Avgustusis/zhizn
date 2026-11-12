/**
 * Собирает src/data/meanings.json из документа смыслов (reference/docs/meanings.md).
 *
 *   npx tsx tools/build-meanings.ts
 *
 * Название, девиз, сложность, требование, теги и тексты условий берутся дословно из документа.
 * Условие переводится в формат: типовые («Стаж 10+», «Харизма 6+») — по образцам,
 * остальные — по словарю tools/meaning-conds.ts. Условие без перевода — ошибка сборки.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLASSES, type Cond, Meaning, MeaningsFile, STATS } from '../src/data/schema.ts'
import { CONDS, DOUBTS, REQUIREMENTS } from './meaning-conds.ts'
import { compactJson } from './json-compact.ts'

const num = (s: string) => Number(s.replace('−', '-').replace('+', ''))
const STAT = STATS.join('|')
const CLS = CLASSES.join('|')
const OLD: Cond = { seg: ['Старость', 'Древность'] }
const HEALTH = { 'Психическое': 'псих', 'Физическое': 'физ' } as const

/** Типовые условия по образцу. */
function auto(t: string): Cond | undefined {
  let m: RegExpMatchArray | null
  if ((m = t.match(new RegExp(`^(${STAT}) (\\d+)\\+$`)))) return { p: m[1] as (typeof STATS)[number], gte: Number(m[2]) }
  if ((m = t.match(new RegExp(`^(${STAT}) (\\d+)\\+ в Старости$`)))) return { all: [OLD, { p: m[1] as (typeof STATS)[number], gte: Number(m[2]) }] }
  if ((m = t.match(/^(Психическое|Физическое) здоровье ([+−]?\d+)( и выше)?$/))) return { p: HEALTH[m[1] as 'Психическое'], gte: num(m[2]) }
  if ((m = t.match(/^(Психическое|Физическое) здоровье ([+−]?\d+)( и выше)? в Старости$/))) return { all: [OLD, { p: HEALTH[m[1] as 'Психическое'], gte: num(m[2]) }] }
  if ((m = t.match(/^(Психическое|Физическое) здоровье ([+−]?\d+)( и выше)? при входе в (Молодость|Зрелость|Старость)$/)))
    return { atEntry: m[4] as 'Старость', cond: { p: HEALTH[m[1] as 'Психическое'], gte: num(m[2]) } }
  if ((m = t.match(/^Возможности ([+−]?\d+)( и выше)?$/))) return { p: 'возм', gte: num(m[1]) }
  if ((m = t.match(/^Возможности ([+−]?\d+) и ниже$/))) return { p: 'возм', lte: num(m[1]) }
  if ((m = t.match(/^Возможности ([+−]?\d+) в Старости$/))) return { all: [OLD, { p: 'возм', gte: num(m[1]) }] }
  if ((m = t.match(/^Возможности ([+−]?\d+) при входе в Старость$/))) return { atEntry: 'Старость', cond: { p: 'возм', gte: num(m[1]) } }
  if ((m = t.match(/^Умереть с Возможностями ([+−]?\d+)( и выше)?$/))) return { p: 'возм', gte: num(m[1]) }
  if ((m = t.match(/^Стаж (\d+)\+$/))) return { p: 'Стаж', gte: Number(m[1]) }
  if ((m = t.match(/^Пенсия \+(\d) и выше$/))) return { val: 'пенсия', gte: Number(m[1]) }
  if ((m = t.match(/^Дожить до (Старости|Древности)$/))) return { reached: m[1] === 'Старости' ? 'Старость' : 'Древность' }
  if ((m = t.match(new RegExp(`^Класс ((?:${CLS})(?:(?:, | или )(?:${CLS}))*)( в момент смерти)?$`))))
    return { cls: m[1].split(/, | или /) as (typeof CLASSES)[number][] }
  if ((m = t.match(/^Войти в (Зрелость|Старость|Древность) в браке$/))) return { atEntry: m[1] as 'Старость', cond: { has: 'Супруг(а)' } }
  if ((m = t.match(/^Нет стигмы «([^»]+)»( в момент смерти)?$/))) return { not: { has: m[1] } }
  if ((m = t.match(/^Связь «([^»]+)»$/))) return { has: m[1] }
  if ((m = t.match(/^(Семейная поддержка|Сплочённость семьи) \+(\d)( и выше)?( в момент смерти)?$/))) return { p: 'Сплочённость', gte: Number(m[2]) }
  return undefined
}

function translate(text: string): Cond {
  const c = CONDS[text] ?? auto(text)
  if (!c) throw new Error(`нет перевода условия: «${text}»`)
  return c
}

const md = readFileSync(resolve('reference/docs/meanings.md'), 'utf8')
const lines = md.split('\n')
const meanings: unknown[] = []
const missing = new Set<string>()

// Серость: таблица условий.
{
  const start = lines.findIndex((l) => l.startsWith('## Серость'))
  const rows = lines.slice(start).filter((l) => /^\| \d+ \|/.test(l)).slice(0, 10)
  const conds = rows.map((r) => {
    const [, text, kind] = r.split('|').map((x) => x.trim()).slice(1)
    const clean = text.replace(/ — 1 очко$/, '')
    return { text, kind, points: text.endsWith('— 1 очко') ? 1 : 0.5, cond: tryTranslate(clean) }
  })
  meanings.push({ id: 'серость', deck: 'Серость', n: 0, title: 'Серость', motto: 'Жизнь как у людей', difficulty: 'Серость', tags: [], conds })
}

function tryTranslate(text: string): Cond {
  try {
    return translate(text)
  } catch {
    missing.add(text)
    return { flag: '?' }
  }
}

// Случайные и Династии: «### 12. Название» / «### Д3. Название», строка-шапка, список условий.
for (let i = 0; i < lines.length; i++) {
  const h = lines[i].match(/^### (Д?)(\d+)\. (.+)$/)
  if (!h) continue
  const dynasty = h[1] === 'Д'
  const n = Number(h[2])
  const head = lines.slice(i + 1).find((l) => l.trim() !== '')!
  const hm = head.match(/^(Простой|Средний|Сложный) \([^)]*\) · (.*?) — \*«(.+)»\.?\*\s*$/)
  if (!hm) throw new Error(`не разобрана шапка «${h[3]}»: ${head}`)
  const parts = hm[2].split(' · ').map((x) => x.trim())
  const reqText = parts.find((x) => x.startsWith('требование: '))?.slice('требование: '.length)
  const unusual = parts.includes('необычный')
  const tags = parts.find((x) => x.startsWith('#'))?.split(/\s+/) ?? []
  const conds: unknown[] = []
  for (let j = i + 1; j < lines.length && !lines[j].startsWith('#'); j++) {
    const cm = lines[j].match(/^- (?:(\d): )?(.+?) \((сост\.|соб\.|итог)\)\s*$/)
    if (!cm) continue
    const points = cm[1] ? Number(cm[1]) : hm[1] === 'Простой' ? 1 : hm[1] === 'Средний' ? 2 : NaN
    conds.push({ text: cm[2], kind: cm[3], points, cond: tryTranslate(cm[2]) })
  }
  const id = `${dynasty ? 'династия' : 'смысл'}.${String(n).padStart(2, '0')}`
  let requires: Cond | undefined
  if (reqText) {
    requires = REQUIREMENTS[reqText]
    if (!requires) missing.add(`требование: ${reqText}`)
  }
  meanings.push({
    id, deck: dynasty ? 'Династии' : 'Случайные', n, title: h[3], motto: hm[3].replace(/\.$/, ''), difficulty: hm[1],
    ...(unusual ? { unusual: true } : {}), tags,
    ...(requires ? { requires, requiresText: reqText } : {}),
    conds,
    ...(DOUBTS[id] ? { doubts: DOUBTS[id] } : {}),
  })
}

if (missing.size) {
  console.error(`нет перевода (${missing.size}):`)
  for (const t of missing) console.error('  ' + t)
  process.exit(1)
}
const unused = Object.keys(CONDS).filter((k) => !md.includes(k))
if (unused.length) console.warn('в словаре лишнее:', unused)

const file = MeaningsFile.parse({ meanings: meanings.map((m) => Meaning.parse(m)) })
writeFileSync(resolve('src/data/meanings.json'), compactJson(file) + '\n')
const total = file.meanings.reduce((s, m) => s + m.conds.length, 0)
console.log(`смыслы: ${file.meanings.length} карт, ${total} условий, спорных карт ${file.meanings.filter((m) => m.doubts).length}`)
