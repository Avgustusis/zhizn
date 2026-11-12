/**
 * Собирает src/data/heirs.json из документа наследников (reference/docs/heirs.md).
 *
 *   npx tsx tools/build-heirs.ts
 *
 * Все поля карты берутся из документа; условия приписанного смысла переводятся по словарю ниже.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CHAR_POLES, CLASSES, type Cond, HeirsFile, STATS } from '../src/data/schema.ts'
import { compactJson } from './json-compact.ts'

const num = (s: string) => Number(s.trim().replace('−', '-').replace('+', ''))
const p = (name: (typeof STATS)[number] | 'возм' | 'псих' | 'Положение' | 'Сплочённость' | 'Пожертвования', gte: number): Cond => ({ p: name, gte })

/** Условия приписанных смыслов. Типовые «Сила 6+» и «Возможности +5» разбираются по образцу. */
const CONDS: Record<string, Cond> = {
  'Диплом': { has: 'Диплом' },
  'Пожертвование': p('Пожертвования', 1),
  'Пожертвование не меньше трёх раз': p('Пожертвования', 3),
  'Положение семьи +1 и выше': p('Положение', 1),
  'Положение семьи +2 и выше': p('Положение', 2),
  'Положение семьи выше, чем при вступлении': { vsStart: 'Положение', is: 'выше' },
  'Положение семьи не ниже, чем при вступлении': { vsStart: 'Положение', is: 'не ниже' },
  'Ребёнок': { has: 'Ребёнок' },
  'Свадьба': { log: 'свадьба', gte: 1 },
  'Связи 2+': { val: 'связи', gte: 2 },
  'Связи 3+': { val: 'связи', gte: 3 },
  'Сплочённость семьи +1 и выше': p('Сплочённость', 1),
  'в Смуте выбрать сторону': { log: 'сторона в Смуте', gte: 1 },
  'в Смуте оказаться на победившей стороне': { log: 'победа в Смуте', gte: 1 },
  'дожить до Зрелости': { reached: 'Зрелость' },
  'дожить до Старости': { reached: 'Старость' },
  'дожить до Древности': { reached: 'Древность' },
  'есть Партнёр или Супруг(а)': { any: [{ has: 'Партнёр' }, { has: 'Супруг(а)' }] },
  'избавиться от стигмы «Долг»': { log: 'снят «Долг»', gte: 1 },
  'ни разу не в кабале': { log: 'кабала', lte: 0 },
  'ни разу не в тюрьме': { log: 'тюрьма', lte: 0 },
  'побывать на войне': { flag: 'Побывать на войне' },
  'психическое здоровье +3 и выше': p('псих', 3),
  'статус «Имя в искусстве»': { has: 'Имя в искусстве' },
  'умереть не в психбольнице': { not: { inInst: 'психбольница' } },
}
function translate(t: string): Cond {
  if (CONDS[t]) return CONDS[t]
  let m = t.match(new RegExp(`^(${STATS.join('|')}) (\\d+)\\+$`))
  if (m) return p(m[1] as (typeof STATS)[number], Number(m[2]))
  m = t.match(/^Возможности ([+−]?\d+)$/)
  if (m) return p('возм', num(m[1]))
  throw new Error(`нет перевода условия: «${t}»`)
}

const ABBR: Record<string, (typeof STATS)[number]> = { 'С': 'Сила', 'В': 'Выносливость', 'Л': 'Ловкость', 'И': 'Интеллект', 'М': 'Мудрость', 'Х': 'Харизма', 'См': 'Смекалка', 'Кр': 'Красота' }
const lines = readFileSync(resolve('reference/docs/heirs.md'), 'utf8').split('\n')
const heirs: unknown[] = []
let cls: string | undefined
const perCls = new Map<string, number>()

for (let i = 0; i < lines.length; i++) {
  const h2 = lines[i].match(/^## (.+)$/)
  if (h2) { cls = (CLASSES as readonly string[]).includes(h2[1]) ? h2[1] : undefined; continue }
  const h3 = lines[i].match(/^### (.+)$/)
  if (!h3 || !cls) continue
  const block: string[] = []
  for (let j = i + 1; j < lines.length && !lines[j].startsWith('#'); j++) block.push(lines[j])
  const field = (name: string) => {
    const l = block.find((x) => x.includes(`**${name}`))
    if (!l) throw new Error(`«${h3[1]}»: нет поля «${name}»`)
    return l
  }
  const entryLine = field('Вход:')
  const [, entry, phys, psy, vozmRaw] = entryLine.match(/\*\*Вход:\*\* (\S+) · \*\*Здоровье:\*\* физ\. ([+−]?\d+), псих\. ([+−]?\d+) · \*\*Возможности:\*\* (.+)$/)!
  const [vozm, ...extras] = vozmRaw.split(',').map((x) => x.trim())
  const startItems = extras.map((x) => x.match(/«([^»]+)»/)![1])
  const stats = Object.fromEntries(field('Характеристики:').replace(/^.*\*\* /, '').split(' · ').map((x) => {
    const [a, v] = x.trim().split(' ')
    return [ABBR[a], Number(v)]
  }))
  const character = field('Характер:').replace(/^.*\*\* /, '').split(', ').map((x) => {
    const m = x.match(/^(\S+) \((край|умеренно)\)$/)!
    if (!(CHAR_POLES as readonly string[]).includes(m[1])) throw new Error(`неизвестный полюс характера «${m[1]}»`)
    return { pole: m[1], level: m[2] === 'край' ? 2 : 1 }
  })
  const [, mTitle, mConds] = field('Приписанный смысл').match(/\*\*Приписанный смысл «([^»]+)»:\*\* (.+)$/)!
  const conds = mConds.split(' · ').map((x) => {
    const m = x.trim().match(/^(.+?) \(\*(сост\.|соб\.|итог)\*\)$/)!
    return { text: m[1], kind: m[2], points: 1, cond: translate(m[1]) }
  })
  const n = (perCls.get(cls) ?? 0) + 1
  perCls.set(cls, n)
  heirs.push({
    id: `наследник.${cls.toLowerCase()}.${n}`, cls, n, title: h3[1],
    text: (block.find((x) => /^\*[^*].*\*$/.test(x.trim())) ?? '').trim().replace(/^\*|\*$/g, ''),
    entry, phys: num(phys), psy: num(psy), vozm: num(vozm), ...(startItems.length ? { startItems } : {}),
    stats, character,
    meaning: { title: mTitle, tags: field('Теги:').replace(/^.*\*\* /, '').trim().split(/\s+/), conds },
  })
}

const file = HeirsFile.parse({ heirs })
writeFileSync(resolve('src/data/heirs.json'), compactJson(file) + '\n')
console.log(`наследники: ${file.heirs.length} карт, по классам: ${[...perCls].map(([c, k]) => `${c} ${k}`).join(', ')}`)
