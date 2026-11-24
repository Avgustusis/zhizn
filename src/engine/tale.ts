/**
 * «Сказка» — старт режимов «Легенда» и «Сага» (концепция, «Сказка: собрать мир» и «Сказка: собрать героя»; решения 23.11).
 * «В жизни мы не выбираем, где и кем родиться, но в сказке мы создаём своих героев».
 *
 * Мир собирают люди за столом: каждый вопрос — следующему по кругу, начиная с младшего (год рождения в настройке места).
 * В каждом вопросе есть «случайно», на первом вопросе шага — «весь шаг случайно». За столом одни ИИ — мир собирается
 * случайно, но по правилам «Сказки» (все культуры и расы представлены). Героя человек собирает сам, в пределах «Доли»;
 * герой ИИ собирается по его архетипу.
 */
import { CHAR_AXES, CULTURE_AXES, CULTURES, IDEOLOGIES, RACES, STATS } from '../data/schema.ts'
import { ask, emit, pick, rnd, roll3, shuffle, type Flow, type G } from './core.ts'
import { birthClass, born, classesFor, cultureProfile, randomPopulation, rollFashion, startStability, type BirthData } from './setup.ts'
import { choosableMeanings, chooseMeaning, happinessOf } from './meaning.ts'
import pilot from '../data/meaning-pilot.json' with { type: 'json' }
import { ARCHETYPES, archetypeOf, type Archetype } from './ai/persona.ts'
import type { Cls, Country, Culture, Ideo, Option, Player, Pos, Race, Relation, Stat } from './types.ts'

const RND = 'случайно'
const STEP = 'шаг случайно'

/** Кто отвечает на вопросы сборки мира и какие шаги уже отданы случаю. */
interface Table { seats: number[]; i: number; auto: Set<string> }

/** Люди за столом от младшего к старшему (год рождения; без года — по порядку мест). Одни ИИ — пусто. */
export function builders(g: G): number[] {
  const seats = g.s.config.seats.map((s, i) => ({ s, i })).filter(({ s }) => !s.ai)
  return seats.sort((a, b) => (b.s.born ?? -Infinity) - (a.s.born ?? -Infinity) || a.i - b.i).map(({ i }) => i)
}

/**
 * Вопрос сборки: следующему по кругу. «случайно» — движок выбирает из открытых вариантов; на первом вопросе шага
 * (first) ещё «весь шаг случайно». Шаг, отданный случаю, дальше не спрашивается.
 */
function* choose(g: G, t: Table, step: string, text: string, options: Option[], first = false): Flow<string> {
  const open = options.filter((o) => !o.off)
  if (!t.seats.length || t.auto.has(step) || t.auto.has('всё')) return pick(g, open).id
  const seat = t.seats[t.i++ % t.seats.length]
  const extra: Option[] = [{ id: RND, label: 'случайно' }, ...(first ? [{ id: STEP, label: 'весь этот шаг — случайно' }] : [])]
  const a = yield* ask(g, { seat } as Player, 'сборка', text, [...options, ...extra], { force: true })
  if (a === STEP) { t.auto.add(step); return pick(g, open).id }
  return a === RND ? pick(g, open).id : a
}

// ── Мир ─────────────────────────────────────────────────────────────────

type Draft = Pick<Country, 'id' | 'name' | 'pos' | 'multicultural' | 'mainRaces' | 'mainCultures' | 'minorityRaces' | 'minorityCultures'> & { ideology?: Ideo; dominant?: Cls; alienated?: Cls }

export function* taleWorld(g: G): Flow {
  const W = g.c.tables.world
  const t: Table = { seats: builders(g), i: 0, auto: new Set() }
  if (t.seats.length) {
    const a = yield* ask(g, { seat: t.seats[0] } as Player, 'сборка', 'Сказка: мир собираем вместе — по очереди, начиная с младшего. Шесть шагов: позиции, население, все представлены, идеологии, культуры, отношения.', [
      { id: 'сами', label: 'собирать по шагам' }, { id: 'всё', label: 'весь мир — случайно (по правилам «Сказки»)' },
    ], { force: true })
    if (a === 'всё') t.auto.add('всё')
  }
  const name = (id: number) => W.countries[id].name

  // 1. Позиции: 1 ядро, 2 полупериферии, 2 периферии — какая страна чем станет.
  const ids = [0, 1, 2, 3, 4]
  const posOf: Pos[] = []
  const place = function* (label: string, pos: Pos, first: boolean): Flow {
    const free = ids.filter((i) => posOf[i] === undefined)
    const id = Number(yield* choose(g, t, 'позиции', `Позиции: какая страна станет ${label}?`, free.map((i) => ({ id: String(i), label: name(i) })), first))
    posOf[id] = pos
  }
  yield* place('ядром', 'ядро', true)
  yield* place('полупериферией (первая из двух)', 'полупериферия', false)
  yield* place('полупериферией (вторая)', 'полупериферия', false)
  for (const i of ids) posOf[i] ??= 'периферия'
  const draft: Draft[] = ids.map((id) => ({ id, name: name(id), pos: posOf[id], multicultural: false, mainRaces: [], mainCultures: [], minorityRaces: [], minorityCultures: [] }))
  g.s.world.draft = draft

  // 2. Население: тип, основные расы и культуры, 0–3 меньшинства.
  for (const c of draft) yield* population(g, t, c, draft, c.id === 0)

  // 3. Все 7 культур и 7 рас представлены.
  yield* everyone(g, t, draft)

  // 4. Идеологии: строй, потом доминирующий класс из возможных при нём, потом отчуждённый (решено 23.11).
  for (const c of draft) {
    const ideo = (yield* choose(g, t, 'идеологии', `${c.name} (${c.pos}): какой строй?`, IDEOLOGIES.map((i) => ({ id: i, label: i })), c.id === 0)) as Ideo
    const row = W.ideologyClasses[ideo]
    const uniq = (list: [number, Cls][]) => [...new Set(list.map(([, cls]) => cls))]
    if (t.auto.has('идеологии') || t.auto.has('всё') || !t.seats.length) { Object.assign(c, { ideology: ideo, ...classesFor(g, ideo) }); continue }
    const dominant = (yield* choose(g, t, 'идеологии', `${c.name}, ${ideo}: кто правит?`, uniq(row.dom).map((x) => ({ id: x, label: x })))) as Cls
    const alienated = (yield* choose(g, t, 'идеологии', `${c.name}, ${ideo}, правит ${dominant}: кто отчуждён?`, uniq(row.ali).filter((x) => x !== dominant).map((x) => ({ id: x, label: x })))) as Cls
    Object.assign(c, { ideology: ideo, dominant, alienated })
  }

  // 5. Культуры: 3 оси «сильно», 3 «умеренно», 5 нейтральных; оси и направления выбирают игроки.
  for (const [k, cul] of CULTURES.entries()) g.s.world.cultures[cul] = yield* profile(g, t, cul, k === 0)

  // 6. Отношения: каждая из 10 пар — союз, нейтралитет или вражда.
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
    const auto = t.auto.has('отношения') || t.auto.has('всё') || !t.seats.length
    let rel: Relation
    if (auto) { const r = rnd(g, 6) + 1; rel = r <= W.relations['вражда'] ? 'вражда' : r <= W.relations['нейтралитет'] ? 'нейтралитет' : 'союз' }
    else rel = (yield* choose(g, t, 'отношения', `Отношения: ${name(a)} и ${name(b)}`, (['союз', 'нейтралитет', 'вражда'] as Relation[]).map((r) => ({ id: r, label: r })), a === 0 && b === 1)) as Relation
    g.s.world.relations[`${a}-${b}`] = rel
  }

  // Мир готов: стабильность на старте и мода — по обычным правилам.
  delete g.s.world.draft
  g.s.world.countries = draft.map((d) => {
    const c: Country = {
      ...d, ideology: d.ideology!, dominant: d.dominant!, alienated: d.alienated!, stability: 0,
      fashionIn: d.mainRaces[0], fashionOut: d.mainRaces[0], war: false, powerChanges: 0,
    }
    c.stability = startStability(g, c)
    rollFashion(g, c)
    return c
  })
  for (const c of g.s.world.countries) emit(g, { t: 'мир', text: `${c.name}: ${c.pos}, ${c.ideology}; правит ${c.dominant}, отчуждён ${c.alienated}; стабильность ${c.stability}` })
}

/** Население одной страны («Типы стран»): тип, основные расы и культуры (1 или 2–3), меньшинства (0–3; расы — только в гомогенной). */
function* population(g: G, t: Table, c: Draft, all: Draft[], first: boolean): Flow {
  const kind = yield* choose(g, t, 'население', `${c.name} (${c.pos}): какой будет страна?`, [
    { id: 'гомогенная', label: 'гомогенная: 1 раса и 1 культура' }, { id: 'мультикультурная', label: 'мультикультурная: 2–3 расы и 2–3 культуры' },
    { id: 'по кубикам', label: 'эта страна — по кубикам' },
  ], first)
  if (kind === 'по кубикам' || t.auto.has('население') || t.auto.has('всё') || !t.seats.length) { Object.assign(c, randomPopulation(g, c)); return }
  c.multicultural = kind === 'мультикультурная'
  const inWorld = (x: string) => all.some((d) => [...d.mainRaces, ...d.mainCultures, ...d.minorityRaces, ...d.minorityCultures].includes(x as never))
  const note = (x: string) => (inWorld(x) ? {} : { note: 'в мире ещё нет' })
  const mains = function* <T extends string>(list: readonly T[], into: T[], what: string): Flow {
    for (let k = 0; k < (c.multicultural ? 3 : 1); k++) {
      const opts: Option[] = list.filter((x) => !into.includes(x)).map((x) => ({ id: x, label: x, ...note(x) }))
      if (k === 2) opts.push({ id: 'хватит', label: 'хватит двух' })
      const a = yield* choose(g, t, 'население', `${c.name}: ${what} №${k + 1}`, opts)
      if (a === 'хватит') break
      into.push(a as T)
    }
  }
  yield* mains(RACES, c.mainRaces, 'основная раса')
  yield* mains(CULTURES, c.mainCultures, 'основная культура')
  for (let k = 0; k < 3; k++) {
    const used = [...c.mainRaces, ...c.mainCultures, ...c.minorityRaces, ...c.minorityCultures] as string[]
    const opts: Option[] = [
      ...(c.multicultural ? [] : RACES.filter((r) => !used.includes(r)).map((r) => ({ id: `раса:${r}`, label: `раса-меньшинство: ${r}`, ...note(r) }))),
      ...CULTURES.filter((x) => !used.includes(x)).map((x) => ({ id: `культура:${x}`, label: `культура-меньшинство: ${x}`, ...note(x) })),
      { id: 'хватит', label: k ? 'больше меньшинств нет' : 'без меньшинств' },
    ]
    const a = yield* choose(g, t, 'население', `${c.name}: меньшинство №${k + 1} (их 0–3)`, opts)
    if (a === 'хватит') break
    const [what, x] = a.split(':')
    if (what === 'раса') c.minorityRaces.push(x as Race)
    else c.minorityCultures.push(x as Culture)
  }
}

/** Куда можно поместить непредставленную расу или культуру: меньшинством, основной в мультикультурной или вместо повторяющегося меньшинства. */
function placements(all: Draft[], kind: 'раса' | 'культура'): Option[] {
  const out: Option[] = []
  const count = (v: string) => all.reduce((n, d) => n + [...d.mainRaces, ...d.mainCultures, ...d.minorityRaces, ...d.minorityCultures].filter((y) => y === v).length, 0)
  for (const c of all) {
    const minorities = c.minorityRaces.length + c.minorityCultures.length
    const canMinor = minorities < 3 && (kind === 'культура' || !c.multicultural)
    if (canMinor) out.push({ id: `${c.id}:меньшинство`, label: `${c.name}: меньшинство` })
    const mains = kind === 'раса' ? c.mainRaces : c.mainCultures
    if (c.multicultural && mains.length < 3) out.push({ id: `${c.id}:основная`, label: `${c.name}: ещё одна основная` })
  }
  if (out.length) return out
  // Места нет: занять место того, кто живёт в мире не один раз, — меньшинства (раса — только в гомогенной стране)
  // или основной расы (культуры) того же рода.
  for (const c of all) {
    const minors = kind === 'культура' || !c.multicultural ? [...c.minorityRaces, ...c.minorityCultures] : []
    for (const v of minors) if (count(v) > 1) out.push({ id: `${c.id}:вместо:${v}`, label: `${c.name}: вместо меньшинства «${v}» (оно есть и в другой стране)` })
    for (const v of kind === 'раса' ? c.mainRaces : c.mainCultures) if (count(v) > 1) out.push({ id: `${c.id}:основную:${v}`, label: `${c.name}: основной вместо «${v}» (она есть и в другой стране)` })
  }
  return out
}

/** Шаг 3: мир, где кого-то нет, не собран — каждую недостающую расу и культуру кладут в какую-то страну. */
function* everyone(g: G, t: Table, all: Draft[]): Flow {
  const missing = (): { kind: 'раса' | 'культура'; x: string }[] => [
    ...RACES.filter((r) => !all.some((d) => d.mainRaces.includes(r) || d.minorityRaces.includes(r))).map((x) => ({ kind: 'раса' as const, x })),
    ...CULTURES.filter((k) => !all.some((d) => d.mainCultures.includes(k) || d.minorityCultures.includes(k))).map((x) => ({ kind: 'культура' as const, x })),
  ]
  for (let guard = 0; guard < 40; guard++) {
    const m = missing()[0]
    if (!m) return
    const opts = placements(all, m.kind)
    if (!opts.length) throw new Error(`«Сказка»: некуда поместить «${m.x}»`)
    const a = yield* choose(g, t, 'представлены', `Все представлены: ${m.kind === 'раса' ? 'раса' : 'культура'} «${m.x}» нигде не живёт. Куда её?`, opts, guard === 0)
    const [cid, how, old] = a.split(':')
    const c = all[Number(cid)]
    const minors = (m.kind === 'раса' ? c.minorityRaces : c.minorityCultures) as string[]
    const mains = (m.kind === 'раса' ? c.mainRaces : c.mainCultures) as string[]
    if (how === 'основная') mains.push(m.x)
    else if (how === 'меньшинство') minors.push(m.x)
    else if (how === 'основную') mains.splice(mains.indexOf(old), 1, m.x)
    else {
      // Освободить место меньшинства (оно могло быть другого рода) и занять его.
      for (const list of [c.minorityRaces, c.minorityCultures] as string[][]) { const i = list.indexOf(old); if (i >= 0) list.splice(i, 1) }
      minors.push(m.x)
    }
  }
}

/** Шаг 5: профиль культуры — 3 оси «сильно», 3 «умеренно», остальные нейтральны. */
function* profile(g: G, t: Table, cul: Culture, first: boolean): Flow<number[]> {
  const mode = yield* choose(g, t, 'культуры', `Культура «${cul}»: профиль из 11 осей (3 сильно, 3 умеренно, 5 нейтральных)`, [
    { id: 'собрать', label: 'собрать' }, { id: 'по кубикам', label: 'эта культура — по кубикам' },
  ], first)
  if (mode === 'по кубикам' || t.auto.has('культуры') || t.auto.has('всё') || !t.seats.length) return cultureProfile(g)
  const tc = g.c.tables.culture
  const prof = Array<number>(CULTURE_AXES.length).fill(0)
  for (let k = 0; k < tc.strong + tc.moderate; k++) {
    const power = k < tc.strong ? 2 : 1
    const opts: Option[] = CULTURE_AXES.flatMap(([a, b], i) => (prof[i] ? [] : [
      { id: `${i}:-`, label: `${a} (${power === 2 ? 'сильно' : 'умеренно'})` }, { id: `${i}:+`, label: `${b} (${power === 2 ? 'сильно' : 'умеренно'})` },
    ]))
    const a = yield* choose(g, t, 'культуры', `«${cul}»: ${power === 2 ? 'сильное' : 'умеренное'} положение ${power === 2 ? k + 1 : k - tc.strong + 1} из 3`, opts)
    const [axis, sign] = a.split(':')
    prof[Number(axis)] = power * (sign === '-' ? -1 : 1)
  }
  return prof
}

// ── Герой ───────────────────────────────────────────────────────────────

/** Характеристики, которые собирают (Смекалка — среднее Харизмы, Мудрости и Интеллекта). */
const OWN: Stat[] = STATS.filter((s) => s !== 'Смекалка')
/** Позиция страны рождения в «Доле»: ядро +1, полупериферия 0, периферия −1. */
const POS_SHARE: Record<Pos, number> = { 'ядро': 1, 'полупериферия': 0, 'периферия': -1 }
const posBonus = (pos: Pos) => POS_SHARE[pos]

/** Бюджет «Доля» (концепция): характеристики в сумме ≤ 18; Финансы + Положение + Сплочённость + позиция страны ≤ 0. */
/** «Доля характера» (24.11): сумма модулей семи личных осей не больше character. */
export const SHARE = { stats: 18, family: 0, statMin: 1, statMax: 4, character: 4 }

/**
 * Характер в пределах «Доли характера». base — с чего начать (архетип ИИ): лишние очки снимаются со случайных осей.
 * Без base — случайная сборка: очко за очком на случайную ось в случайную сторону, пока доля не кончится
 * или кубик не скажет «хватит».
 */
export function shareCharacter(g: G, base?: number[]): number[] {
  const c = base ? [...base] : Array<number>(CHAR_AXES.length).fill(0)
  const sum = () => c.reduce((a, v) => a + Math.abs(v), 0)
  if (base) {
    while (sum() > SHARE.character) { const i = pick(g, c.map((v, k) => (v ? k : -1)).filter((k) => k >= 0)); c[i] -= Math.sign(c[i]) }
    return c
  }
  while (sum() < SHARE.character && rnd(g, 6) > 0) {
    const i = rnd(g, c.length)
    const dir = c[i] ? Math.sign(c[i]) : rnd(g, 2) ? 1 : -1
    if (Math.abs(c[i]) < 2) c[i] += dir
  }
  return c
}

/** Классы, доступные при этих Финансах: строка таблицы «Класс семьи при рождении»; при госсоциализме вместо Олигархов — Полиция. */
const rowClasses = (g: G, fin: number, c: Country): Cls[] => [...new Set(g.c.tables.birth.familyClass[String(fin)].map((x) => birthClass(x, c)))]

/** Герой: человек собирает сам (или «случайно по «Доле»»), ИИ — по архетипу. */
export function* taleHero(g: G, seat: number): Flow<Player> {
  const sc = g.s.config.seats[seat]
  if (sc.ai) return yield* aiHero(g, seat, archetypeOf(sc.archetype))
  const me = { seat } as Player
  const q = (text: string, options: Option[]) => ask(g, me, 'сборка', text, options, { force: true })
  const mode = yield* q(`${sc.name}: собираешь героя. Бюджет «Доля»: характеристики в сумме не больше ${SHARE.stats}; Финансы + Положение + Сплочённость + позиция страны не больше 0.`, [
    { id: 'собрать', label: 'собрать самому' }, { id: RND, label: 'случайно в пределах «Доли»' },
  ])
  if (mode === RND) return yield* aiHero(g, seat, pick(g, ARCHETYPES), false)
  const W = g.s.world.countries
  const country = W[Number(yield* q('Страна рождения', W.map((c) => ({ id: String(c.id), label: `${c.name} — ${c.pos}, ${c.ideology}`, note: `позиция в «Доле»: ${posBonus(c.pos) > 0 ? '+' : ''}${posBonus(c.pos)}` }))))]
  const race = (yield* q('Раса — из тех, что есть в стране', [...country.mainRaces.map((r) => ({ id: r, label: r, note: 'основная' })), ...country.minorityRaces.map((r) => ({ id: r, label: r, note: 'меньшинство' }))])) as Race
  const culture = (yield* q('Культура — из тех, что есть в стране', [...country.mainCultures.map((r) => ({ id: r, label: r, note: 'основная' })), ...country.minorityCultures.map((r) => ({ id: r, label: r, note: 'меньшинство' }))])) as Culture
  const sex = (yield* q('Пол', [{ id: 'ж', label: 'женский' }, { id: 'м', label: 'мужской' }])) as Player['sex']
  // Характеристики: каждая 1–4, в сумме не больше 18; остальным нужно хотя бы по 1.
  const stats = { 'Смекалка': 0 } as Record<Stat, number>
  let left = SHARE.stats
  for (const [i, s] of OWN.entries()) {
    const rest = OWN.length - i - 1
    const v = Number(yield* q(`${s}: от 1 до 4 (в «Доле» осталось ${left})`, [1, 2, 3, 4].map((n) => ({ id: String(n), label: String(n), ...(n + rest * SHARE.statMin > left ? { off: 'не хватит «Доли» на остальные: каждой нужно хотя бы 1' } : {}) }))))
    stats[s] = v
    left -= v
  }
  stats['Смекалка'] = Math.floor((stats['Харизма'] + stats['Мудрость'] + stats['Интеллект']) / 3)
  const predisps = [...new Set(g.c.tables.birth.predisp)]
  const predisp = (yield* q('Предрасположенность', predisps.map((s) => ({ id: s, label: s })))) as Stat
  // Семья: каждая шкала −3…+3, сумма с позицией страны — не больше 0.
  const B = SHARE.family - posBonus(country.pos)
  const scaleQ = function* (what: string, before: number, rest: number): Flow<number> {
    const opts = [-3, -2, -1, 0, 1, 2, 3].map((n) => ({ id: String(n), label: `${n > 0 ? '+' : ''}${n}`, ...(before + n - 3 * rest > B ? { off: 'не укладывается в «Долю»' } : {}) }))
    return Number(yield* q(`${what} (семья: сумма шкал не больше ${B > 0 ? '+' : ''}${B} при позиции «${country.pos}»)`, opts))
  }
  const fin = yield* scaleQ('Финансы семьи', 0, 2)
  const pos = yield* scaleQ('Положение семьи', fin, 1)
  const coh = yield* scaleQ('Сплочённость семьи', fin + pos, 0)
  const cls = (yield* q(`Класс семьи — из строки Финансов ${fin > 0 ? '+' : ''}${fin}`, rowClasses(g, fin, country).map((c) => ({ id: c, label: c })))) as Cls
  // Характер собирается целиком: каждая ось −2…+2, сумма модулей не больше «Доли характера» (24.11).
  const character = Array<number>(CHAR_AXES.length).fill(0)
  let share = SHARE.character
  for (const [i, [a, b]] of CHAR_AXES.entries()) {
    const opts = [-2, -1, 0, 1, 2].map((v) => ({
      id: String(v), label: v === 0 ? 'нейтрально' : `${v < 0 ? a : b}${Math.abs(v) === 2 ? ' (сильно)' : ''}`,
      ...(Math.abs(v) > share ? { off: '«Доля характера» кончилась' } : {}),
    }))
    const v = Number(yield* q(`Характер: ${a} ↔ ${b} (в «Доле характера» осталось ${share})`, opts))
    character[i] = v
    share -= Math.abs(v)
  }
  const t = g.c.tables.birth
  // Здоровье при рождении бросают как обычно: тело не выбирают даже в сказке.
  const data: BirthData = { sex, country, race, culture, fin, pos, coh, cls, phys: t.genetics[roll3(g).sum], stats, predisp, character }
  return yield* born(g, seat, 1, data, function* (p) {
    const ids = choosableMeanings(g, p)
    const id = yield* ask(g, p, 'смысл', 'Смысл жизни выбираешь открыто — бросок поиска не нужен', ids.map((x) => { const m = g.meanings.get(x)!; return { id: x, label: `${m.title}${m.deck === 'Династии' ? ' (Династия)' : ''}`, note: m.motto } }), { force: true })
    chooseMeaning(g, p, id)
  })
}

// ── Герой ИИ по архетипу ────────────────────────────────────────────────

/** Сборки соавтора в пределах «Доли»: «богатые, но холодные» и «скромные, но дружные». Архетип выбирает сборку. */
const RICH = ['хуцпа', 'гешефт', 'мачо', 'бонвиван', 'фланёр']
/** Сильные стороны архетипа: в них по 4, в остальных по 2 (сумма 18). */
const FOCUS: Record<string, [Stat, Stat]> = {
  'савант': ['Интеллект', 'Мудрость'], 'бонвиван': ['Красота', 'Харизма'], 'хуцпа': ['Харизма', 'Сила'], 'менш': ['Харизма', 'Мудрость'],
  'сису': ['Выносливость', 'Сила'], 'убунту': ['Харизма', 'Мудрость'], 'мачо': ['Сила', 'Красота'], 'хюгге': ['Мудрость', 'Выносливость'],
  'гешефт': ['Интеллект', 'Харизма'], 'стоик': ['Мудрость', 'Выносливость'], 'фланёр': ['Красота', 'Ловкость'], 'ронин': ['Ловкость', 'Сила'],
}

/**
 * Пилотная цена карты смысла: средний итог в «Биографии» (tools/meaning-pilot.ts), со сжатием к общему среднему
 * для редких карт (как будто ещё PRIOR жизней прожили со средним итогом).
 */
const PRIOR = 10
function pilotOf(id: string): number {
  const c = (pilot.cards as Record<string, { mean: number; n: number }>)[id]
  return c ? (c.mean * c.n + pilot.all * PRIOR) / (c.n + PRIOR) : pilot.all
}

/**
 * Герой ИИ: сборка соавтора по архетипу со случайным разбросом (одно очко между шкалами семьи и одно между
 * характеристиками), характер — архетипа, ужатый до «Доли характера». Смысл — как card_value в sim3.py: пилотный итог карты плюс половина
 * того, что уже выполнено при рождении.
 */
export function* aiHero(g: G, seat: number, a: Archetype = ARCHETYPES[0], ownCharacter = true): Flow<Player> {
  const rich = RICH.includes(a.id)
  const target: Pos = rich ? 'ядро' : 'полупериферия'
  const country = pick(g, g.s.world.countries.filter((c) => c.pos === target))
  const fam = rich ? [3, -1, -3] : [-1, -1, 2]
  // Разброс: одно очко из одной шкалы в другую — сумма та же, «Доля» соблюдена.
  if (rnd(g, 2)) {
    const from = rnd(g, 3), to = rnd(g, 3)
    if (from !== to && fam[from] > -3 && fam[to] < 3) { fam[from]--; fam[to]++ }
  }
  const [fin, pos, coh] = fam
  const row = rowClasses(g, fin, country)
  const wanted: Cls = birthClass(rich ? 'Олигархи' : pick(g, ['Народ', 'Армия'] as Cls[]), country)
  const cls = row.includes(wanted) ? wanted : pick(g, row)
  const focus = FOCUS[a.id] ?? ['Харизма', 'Мудрость']
  const stats = Object.fromEntries(OWN.map((s) => [s, focus.includes(s) ? SHARE.statMax : 2])) as Record<Stat, number>
  if (rnd(g, 2)) {
    const others = shuffle(g, OWN.filter((s) => !focus.includes(s)))
    if (others.length >= 2) { stats[others[0]] -= 1; stats[others[1]] += 1 }
  }
  stats['Смекалка'] = Math.floor((stats['Харизма'] + stats['Мудрость'] + stats['Интеллект']) / 3)
  const t = g.c.tables.birth
  const predisps = [...new Set(t.predisp)]
  const predisp = predisps.includes(focus[0]) ? focus[0] : pick(g, predisps)
  const character = shareCharacter(g, ownCharacter ? a.character : undefined)
  const data: BirthData = {
    sex: rnd(g, 2) ? 'м' : 'ж', country, race: pick(g, country.mainRaces), culture: pick(g, country.mainCultures),
    fin, pos, coh, cls, phys: t.genetics[roll3(g).sum], stats, predisp, character,
  }
  return yield* born(g, seat, 1, data, (p) => {
    let best = ''
    let top = -Infinity
    for (const id of choosableMeanings(g, p)) {
      p.meaning = { id, from: 'рождение', verdict: 0 }
      const v = pilotOf(id) + 0.5 * happinessOf(g, p) + rnd(g, 100) / 1000
      if (v > top) { top = v; best = id }
    }
    delete p.meaning
    if (best) chooseMeaning(g, p, best)
  })
}
