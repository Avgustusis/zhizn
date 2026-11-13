/** Подготовка партии: мир (культуры, страны, отношения), стопки карт и рождение игроков. */
import { CLASSES, CULTURE_AXES, CULTURES, IDEOLOGIES, RACES, STATS } from '../data/schema.ts'
import { ask, die, emit, pick, rnd, roll3, say, seedRng, shuffle, type Flow, type G } from './core.ts'
import { cultureAxisOf, newCtx } from './cond.ts'
import { gainItem } from './change.ts'
import { run } from './exec.ts'
import { markEntry, meaningAtBirth, meaningPiles, settle } from './meaning.ts'
import type { Cls, Country, Culture, GameConfig, GameState, Player, Race, Relation, Stat } from './types.ts'

export function newState(config: GameConfig): GameState {
  return {
    version: 1, config, rng: seedRng(config.seed), phase: 'подготовка', round: 0, worldTurns: 0, current: 0,
    world: { countries: [], relations: {}, cultures: {} as GameState['world']['cultures'] },
    piles: {}, players: [], graves: [], log: [], uid: 0, asked: 0, todo: {},
  }
}

// ── Мир ─────────────────────────────────────────────────────────────────

/** Профиль культуры: 3 оси «сильно», 3 «умеренно», остальные нейтральны; полюс — монеткой. */
function cultureProfile(g: G): number[] {
  const t = g.c.tables.culture
  const prof = Array<number>(CULTURE_AXES.length).fill(0)
  shuffle(g, CULTURE_AXES.map((_, i) => i)).slice(0, t.strong + t.moderate).forEach((axis, k) => {
    prof[axis] = (k < t.strong ? 2 : 1) * (rnd(g, 2) ? 1 : -1)
  })
  return prof
}

function take<T>(g: G, from: readonly T[], n: number, except: readonly T[] = []): T[] {
  return shuffle(g, from.filter((x) => !except.includes(x))).slice(0, n)
}

function makeCountry(g: G, id: number, pos: Country['pos']): Country {
  const t = g.c.tables.world
  const multicultural = die(g, 6) > t.homogeneousUpTo[pos]
  const n = () => (multicultural ? t.multiMain[0] + rnd(g, t.multiMain[1] - t.multiMain[0] + 1) : 1)
  const mainRaces = take<Race>(g, RACES, n())
  const mainCultures = take<Culture>(g, CULTURES, n())
  const minorityRaces: Race[] = []
  const minorityCultures: Culture[] = []
  const minorities = t.minorities[0] + rnd(g, t.minorities[1] - t.minorities[0] + 1)
  for (let i = 0; i < minorities; i++) {
    if (rnd(g, 2)) minorityRaces.push(...take<Race>(g, RACES, 1, [...mainRaces, ...minorityRaces]))
    else minorityCultures.push(...take<Culture>(g, CULTURES, 1, [...mainCultures, ...minorityCultures]))
  }
  const ideology = pick(g, IDEOLOGIES)
  const dominant = pick(g, CLASSES)
  const alienated = pick(g, CLASSES.filter((c) => c !== dominant))
  // Идеология тянет против культуры большинства: её полюс противоположен положению основной культуры.
  const pole = t.ideologyShift[ideology]
  const against = !!pole && g.s.world.cultures[mainCultures[0]][cultureAxisOf(pole)[0]] * cultureAxisOf(pole)[1] < 0
  const stability = t.stability.start + (pos === 'ядро' ? t.stability['ядро'] : pos === 'периферия' ? t.stability['периферия'] : 0)
    + (against ? t.stability.ideologyVsCulture : 0) + (alienated === 'Народ' ? t.stability.alienatedPeople : 0)
  const country: Country = {
    id, name: t.countries[id].name, pos, multicultural, mainRaces, mainCultures, minorityRaces, minorityCultures,
    ideology, dominant, alienated, stability: Math.max(t.stability.min, stability), fashionIn: mainRaces[0], fashionOut: mainRaces[0], war: false, powerChanges: 0,
  }
  rollFashion(g, country)
  return country
}

/** Мода: одна раса в моде, другая нет; при сильном Этноцентризме в моде всегда раса большинства. */
export function rollFashion(g: G, c: Country): void {
  const ethno = g.s.world.cultures[c.mainCultures[0]][cultureAxisOf('Этноцентризм')[0]] === -2
  c.fashionIn = ethno ? c.mainRaces[0] : pick(g, RACES)
  c.fashionOut = pick(g, RACES.filter((r) => r !== c.fashionIn))
}

export function setupWorld(g: G): void {
  const t = g.c.tables.world
  for (const c of CULTURES) g.s.world.cultures[c] = cultureProfile(g)
  const positions = shuffle(g, [...t.positions])
  g.s.world.countries = positions.map((pos, id) => makeCountry(g, id, pos))
  for (let a = 0; a < positions.length; a++) for (let b = a + 1; b < positions.length; b++) {
    const r = die(g, 6)
    const rel: Relation = r <= t.relations['вражда'] ? 'вражда' : r <= t.relations['нейтралитет'] ? 'нейтралитет' : 'союз'
    g.s.world.relations[`${a}-${b}`] = rel
  }
  for (const c of g.s.world.countries) emit(g, { t: 'мир', text: `${c.name}: ${c.pos}, ${c.ideology}; правит ${c.dominant}, отчуждён ${c.alienated}; стабильность ${c.stability}` })
}

/** Стопки: колоды событий (стопка класса — у каждого класса своя), люди, «Верхи», «Дно», смыслы. */
export function setupPiles(g: G): void {
  for (const [deck, cards] of Object.entries(g.c.decks)) {
    if (deck === 'класс') {
      for (const cls of CLASSES) g.s.piles[`класс.${cls}`] = shuffle(g, cards.filter((c) => c.cls === cls).map((c) => c.id))
    } else g.s.piles[deck] = shuffle(g, cards.filter((c) => !c.cell).map((c) => c.id))
  }
  for (const deck of ['Верхи', 'Дно'] as const) {
    g.s.piles[deck] = shuffle(g, g.c.items.filter((i) => i.deck === deck).flatMap((i) => Array<string>(Math.max(1, i.copies)).fill(i.name)))
  }
  meaningPiles(g)
}

// ── Рождение ────────────────────────────────────────────────────────────

/** 3d6 → уровень шкалы −3…+3 по верхним границам. */
function scale(g: G, bounds: number[], adv = 0): number {
  const { sum } = roll3(g, adv)
  return bounds.findIndex((hi) => sum <= hi) - 3
}

/** Раса и культура по составу страны: d10, 9–10 — случайное меньшинство. */
function origin(g: G, c: Country): { race: Race; culture: Culture } {
  const race = pick(g, c.mainRaces)
  const culture = pick(g, c.mainCultures)
  const minorities = [...c.minorityRaces.map((r) => ({ race: r })), ...c.minorityCultures.map((k) => ({ culture: k }))]
  if (die(g, 10) >= g.c.tables.birth.minorityFrom && minorities.length) return { race, culture, ...pick(g, minorities) }
  return { race, culture }
}

export function* birth(g: G, seat: number, gen = 1): Flow<Player> {
  const t = g.c.tables.birth
  const sex = rnd(g, 2) ? 'м' : 'ж'
  const country = g.s.world.countries[rnd(g, g.s.world.countries.length)]
  const { race, culture } = origin(g, country)
  const fin = scale(g, t.narrow, t.finAdv[country.pos])
  const pos = scale(g, t.narrow)
  const coh = scale(g, t.wide)
  const phys = t.genetics[roll3(g).sum]
  const cls: Cls = t.familyClass[String(fin)][die(g, 6) - 1]
  const stats = Object.fromEntries(STATS.map((s) => [s, die(g, t.statDie)])) as Record<Stat, number>
  stats['Смекалка'] = Math.floor((stats['Харизма'] + stats['Мудрость'] + stats['Интеллект']) / 3)
  const character = Array<number>(7).fill(0)
  character[rnd(g, 7)] = rnd(g, 2) ? 1 : -1
  const p: Player = {
    seat, name: g.s.config.seats[seat].name, gen, alive: true, finished: false,
    sex, race, culture, birthCountry: country.id, country: country.id, citizenship: [country.id],
    fin, pos, coh, familyCls: cls, cls, start: { fin, pos, coh, cls },
    phys, psy: t.scale5[String(coh)], vozm: t.scale5[String(fin)] + t.scale5[String(pos)],
    stats, predisp: t.predisp[die(g, 6) - 1], unsealed: [], character,
    seg: 0, cell: 0, turns: 0, skip: 0, stazh: 0, stazhHire: 0, donations: 0,
    items: [], achieved: {}, approved: [], happiness: 0,
    flags: {}, counters: {}, visits: {}, entry: {},
    mods: [], laters: [], income: [], pensionAdd: 0, everySeg: [], installments: [], noAging: 0, rules: {},
  }
  g.s.players[seat] = p
  say(g, p, `${p.name}: ${sex === 'м' ? 'мальчик' : 'девочка'}, ${race}, ${culture}; ${country.name}; семья — ${cls}; финансы ${fin}, положение ${pos}, сплочённость ${coh}`)
  // Что даёт семья: каждая строка таблицы — свой бросок.
  for (const line of t.items) yield* run(g, p, line, newCtx('правило'))
  if (fin >= t.trumpChoiceFrom) {
    const trumps = g.c.items.filter((i) => i.kind === 'козырь' && i.deck === 'каталог' && i.name !== 'Семейные сбережения')
    const name = yield* ask(g, p, 'предмет', 'Семья с состоянием: ещё один обычный козырь на выбор.', trumps.map((i) => ({ id: i.name, label: i.name, note: Object.values(i.src).join(' · ') })))
    yield* gainItem(g, p, name)
  }
  markEntry(g, p)
  yield* meaningAtBirth(g, p)
  settle(g, p)
  return p
}

export function* setup(g: G): Flow {
  setupWorld(g)
  setupPiles(g)
  for (let seat = 0; seat < g.s.config.seats.length; seat++) yield* birth(g, seat)
  g.s.phase = 'игра'
}

