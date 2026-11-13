/**
 * Таблицы поправок к проверкам по тегам — в читаемом виде для автора правил.
 *   npx tsx tools/print-modifiers.ts
 * Источник — `src/data/tables.ts`; этот файл только печатает `docs/MODIFIERS.md`.
 */
import { writeFileSync } from 'node:fs'
import { CHAR_AXES, CULTURE_AXES } from '../src/data/schema.ts'
import { tables, type PoleTag } from '../src/data/tables.ts'

const who = (e: PoleTag): string => [
  e.who === 'чужак' ? 'чужаку' : e.who === 'пол+' ? 'полу в преимуществе' : e.who === 'пол−' ? 'полу в помехе' : '',
  e.pair === true ? 'есть пара' : e.pair === false ? 'нет пары' : '',
  e.stat ? `проверка ${e.stat}` : '',
].filter(Boolean).join(', ')
const cell = (list: PoleTag[] | undefined): string => (list?.length ? list.map((e) => `${e.sign > 0 ? '+' : '−'} ${e.tag}${who(e) ? ` (${who(e)})` : ''}`).join('<br>') : '—')
const axes = (pairs: readonly (readonly [string, string])[], t: Partial<Record<string, PoleTag[]>>): string =>
  ['| Ось | Первый полюс | Второй полюс |', '|---|---|---|', ...pairs.map(([a, b]) => `| ${a} ↔ ${b} | ${cell(t[a])} | ${cell(t[b])} |`)].join('\n')

const md = `# Поправки к проверкам по тегам

Этот файл печатается из \`src/data/tables.ts\` командой \`npx tsx tools/print-modifiers.ts\`. Править нужно таблицы, а не его.

**Черновик: ждёт утверждения Августа.** В концепции эти таблицы написаны прозой («+ к карьере и статусу; − к обращению за помощью»).
Движку нужны знаки по тегам, поэтому проза переведена в таблицу. Где концепция говорит о механике, а не о броске
(«катастрофы мягче на 1», «банк дешевле»), строки нет: это отдельные правила этапа 3.

Как читать: «+ #карьера» — к проверке на карте с тегом #карьера прибавляется сила положения: 1 при «умеренно», 2 при «сильно».
«−» — вычитается. Все ситуативные поправки вместе — не больше ±3.

## Культура игрока

Берётся профиль культуры игрока (у бикультурного — личная культура) с поправкой идеологии страны.
На картах колоды «Культура» эти поправки не действуют: там полюса расписаны на самой карте.

${axes(CULTURE_AXES, tables.cultureTags)}

## Культура страны (среда)

Положение основной культуры страны проживания, которое бьёт по чужаку.

${axes(CULTURE_AXES.filter(([a, b]) => tables.countryCultureTags[a] || tables.countryCultureTags[b]), tables.countryCultureTags)}

## Характер

${axes(CHAR_AXES, tables.characterTags)}

Полюса без строк (Соперничество, Аппетит) работают особыми правилами, а не поправкой к броску.

## Идеология страны проживания

Поправка ±1 всем, кто живёт в стране (или только названным).

| Идеология | Поправки |
|---|---|
${Object.entries(tables.ideologyTags).map(([ideo, list]) => `| ${ideo} | ${list.map((e) => `${e.add > 0 ? '+' : '−'}${Math.abs(e.add)} ${e.tag}${e.who ? ` (${e.who === 'большинство' ? 'большинству' : e.who === 'чужак' ? 'чужаку' : `классу ${e.who}`})` : ''}`).join('<br>')} |`).join('\n')}

Сдвиг положения культуры на 1: ${Object.entries(tables.world.ideologyShift).map(([i, p]) => `${i} — к полюсу «${p}»`).join('; ')}.

## Класс

Теги класса: членам доминирующего класса в них преимущество, членам отчуждённого — помеха.

| Класс | Теги |
|---|---|
${Object.entries(tables.classTags).map(([c, tags]) => `| ${c} | ${tags.join(' ')} |`).join('\n')}

## Мода

Раса в моде: +1 в проверках с тегами ${tables.beauty.fashionTags.join(' ')}; не в моде — −1.
`
writeFileSync('docs/MODIFIERS.md', md)
console.log('docs/MODIFIERS.md')
