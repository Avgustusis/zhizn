/** Справки о состоянии игрока и вычисление условий формата карт (`Cond`). */
import { CHAR_AXES, CLASSES, CULTURE_AXES, IDEOLOGY_GROUPS, SEGMENTS, STATS, type Cond } from '../data/schema.ts'
import { countryOf, die, step, type G } from './core.ts'
import type { CharPole, Cls, Country, Culture, Held, Player, Relation, Stat, Tag } from './types.ts'

/** Что знает исполнитель о карте, которая сейчас играется. */
export interface Ctx {
  card?: string
  deck?: string
  tags: Tag[]
  /** Источник изменения чисел: возрастной сдвиг — только у карт, «рынок не убивает» — только у действий. */
  source: 'карта' | 'действие' | 'правило'
  /** Колода «по полюсам». */
  polar?: boolean
  /** Бросок d6 этого уровня карты (параллельные d6 читают один бросок). */
  d6?: { value?: number }
  /** Общие на всю карту: последняя проверка, выбранные варианты, бросок призыва. */
  shared: { used?: Stat; chose: string[]; draft?: number; failed?: boolean; dispose?: 'замешать' }
  /** Внутри ветки полюса колоды «по полюсам» при «сильно»: числа на 1 крупнее. */
  strong?: boolean
  /** Потолок характеристик для шага `add` (рынок: 7 или 8). */
  cap?: number
  /** Мир и Смута. */
  target?: number
  side?: 'победители' | 'проигравшие' | 'нейтралы'
  formerDominant?: boolean
}
export const newCtx = (source: Ctx['source'], part: Partial<Ctx> = {}): Ctx => ({ tags: [], source, shared: { chose: [] }, d6: {}, ...part })

// ── Культура и характер ─────────────────────────────────────────────────

const cultureAxis = new Map<string, [number, number]>()
CULTURE_AXES.forEach(([a, b], i) => { cultureAxis.set(a, [i, -1]); cultureAxis.set(b, [i, 1]) })
const charAxis = new Map<string, [number, number]>()
CHAR_AXES.forEach(([a, b], i) => { charAxis.set(a, [i, -1]); charAxis.set(b, [i, 1]) })

/** Профиль культуры игрока с поправкой идеологии страны проживания (сдвиг на 1 в пределах ±2). */
export function profileOf(g: G, p: Player): number[] {
  const base = p.ownProfile ?? g.s.world.cultures[p.culture]
  return shifted(g, base, countryOf(g, p))
}
/** Профиль основной культуры страны — «среда», в которой живёт игрок. */
export function countryProfile(g: G, c: Country): number[] {
  return shifted(g, g.s.world.cultures[c.mainCultures[0]], c)
}
function shifted(g: G, base: number[], c: Country): number[] {
  const pole = g.c.tables.world.ideologyShift[c.ideology]
  if (!pole) return base
  const [axis, sign] = cultureAxis.get(pole)!
  const out = [...base]
  out[axis] = Math.max(-2, Math.min(2, out[axis] + sign))
  return out
}
/** Сила полюса культуры у игрока: 0 — не клонится, 1 — умеренно, 2 — сильно. */
export function cultureLean(g: G, p: Player, pole: string): number {
  const [axis, sign] = cultureAxis.get(pole)!
  return Math.max(0, profileOf(g, p)[axis] * sign)
}
export function charLean(p: Player, pole: CharPole): number {
  const [axis, sign] = charAxis.get(pole)!
  return Math.max(0, p.character[axis] * sign)
}
export const charAxisOf = (pole: CharPole): [number, number] => charAxis.get(pole)!
export const cultureAxisOf = (pole: string): [number, number] => cultureAxis.get(pole)!

/** Пол игрока по оси Патриархат ↔ Матриархат: +сила — в преимуществе, −сила — в помехе, 0 — ось нейтральна. */
export function sexStanding(g: G, p: Player): number {
  const v = profileOf(g, p)[2]
  if (v === 0) return 0
  const favored = v < 0 ? 'м' : 'ж'
  return p.sex === favored ? Math.abs(v) : -Math.abs(v)
}

// ── Свой и чужой ────────────────────────────────────────────────────────

export const culturesOf = (p: Player): Culture[] => (p.culture2 ? [p.culture, p.culture2] : [p.culture])
export function isMinority(g: G, p: Player): boolean {
  const c = countryOf(g, p)
  return !c.mainRaces.includes(p.race) || !culturesOf(p).some((x) => c.mainCultures.includes(x))
}
export function relation(g: G, a: number, b: number): Relation | 'свои' {
  return a === b ? 'свои' : g.s.world.relations[`${Math.min(a, b)}-${Math.max(a, b)}`]
}

// ── Предметы ────────────────────────────────────────────────────────────

/** Карты игрока, подходящие под имя: имя карты, стопка людей, «Супруг(а)», «Партнёр», «Диплом». */
export function held(g: G, p: Player, name: string): Held[] {
  if (name === 'Супруг(а)') return p.items.filter((h) => h.spouse)
  if (name === 'Партнёр') return p.items.filter((h) => !h.spouse && g.items.get(h.name)?.group === 'Партнёр')
  if (name === 'Диплом') return p.items.filter((h) => h.name === 'Диплом' || h.name === 'Престижный диплом')
  if (g.groups.has(name)) return p.items.filter((h) => g.items.get(h.name)?.group === name)
  return p.items.filter((h) => h.name === name)
}
export const has = (g: G, p: Player, name: string): boolean => held(g, p, name).length > 0
export const pairOf = (g: G, p: Player): Held | undefined => p.items.find((h) => g.items.get(h.name)?.group === 'Партнёр')
export const kindOf = (g: G, h: Held) => g.items.get(h.name)?.kind

// ── Числа ───────────────────────────────────────────────────────────────

/** Красота в событии: задатки + канон страны («Канон красоты»). Остальные характеристики — как есть. */
export function effStat(g: G, p: Player, stat: Stat): number {
  const v = p.stats[stat]
  if (stat !== 'Красота') return v
  const t = g.c.tables.beauty
  const c = countryOf(g, p)
  let add = 0
  if (c.pos === 'ядро') add += step(t.athletic, Math.floor((p.stats['Сила'] + p.stats['Выносливость'] + p.stats['Ловкость']) / 3))
  if (c.pos === 'периферия') add += step(t.wealth, p.vozm)
  if (p.phys <= t.sickFrom) add += t.sick
  return Math.max(0, v + add)
}

export function paramValue(g: G, p: Player, param: string): number {
  switch (param) {
    case 'физ': return p.phys
    case 'псих': return p.psy
    case 'возм': return p.vozm
    case 'Стаж': return p.stazh
    case 'Стаж найма': return p.stazhHire
    case 'Пожертвования': return p.donations
    case 'Сплочённость': return p.coh
    case 'Финансы': return p.fin
    case 'Положение': return p.pos
    default:
      if ((STATS as readonly string[]).includes(param)) return effStat(g, p, param as Stat)
      throw new Error(`неизвестный параметр: ${param}`)
  }
}

/** Производные значения «сейчас» (условие `val`). */
export function derived(g: G, p: Player, name: string): number {
  switch (name) {
    case 'связи': return p.items.filter((h) => kindOf(g, h) === 'связь').length
    case 'вещи': return p.items.filter((h) => kindOf(g, h) === 'вещь').length
    case 'козыри': return p.items.filter((h) => kindOf(g, h) === 'козырь').length
    case 'друзья': return held(g, p, 'Друг').length
    case 'аккультурация': return p.counters['аккультурация'] ?? 0
    case 'аккультурация (максимум за жизнь)': return p.counters['аккультурация (максимум за жизнь)'] ?? 0
    case 'пенсия': return p.counters['пенсия за ход'] ?? 0
    default: throw new Error(`неизвестное значение: ${name}`)
  }
}

const inRange = (v: number, c: { gte?: number; lte?: number }): boolean => (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte)

/** Подлежит призыву: пол в преимуществе, при нейтральной оси — любой. */
const sexCalled = (g: G, p: Player): boolean => sexStanding(g, p) >= 0

// ── Условия ─────────────────────────────────────────────────────────────

export function cond(g: G, p: Player, c: Cond | undefined, ctx?: Ctx): boolean {
  if (!c) return true
  const country = countryOf(g, p)
  if ('all' in c) return c.all.every((x) => cond(g, p, x, ctx))
  if ('any' in c) return c.any.some((x) => cond(g, p, x, ctx))
  if ('not' in c) return !cond(g, p, c.not, ctx)
  if ('p' in c) return inRange(paramValue(g, p, c.p), c)
  if ('pos' in c) return c.pos.includes(country.pos)
  if ('ideo' in c) return c.ideo.some((i) => (i in IDEOLOGY_GROUPS ? (IDEOLOGY_GROUPS[i as keyof typeof IDEOLOGY_GROUPS] as readonly string[]).includes(country.ideology) : i === country.ideology))
  if ('culture' in c) return c.strong ? cultureLean(g, p, c.culture) === 2 : cultureLean(g, p, c.culture) > 0
  if ('neutral' in c) return profileOf(g, p)[cultureAxisOf(c.neutral)[0]] === 0
  if ('char' in c) return c.strong ? charLean(p, c.char) === 2 : charLean(p, c.char) > 0
  if ('cls' in c) return c.cls.includes(p.cls)
  if ('sex' in c) return p.sex === c.sex
  if ('sexFavored' in c) return c.sexFavored ? sexStanding(g, p) > 0 : sexStanding(g, p) < 0
  if ('familyCls' in c) return c.familyCls.includes(p.familyCls)
  if ('war' in c) return country.war === c.war
  if ('partnerMinority' in c) {
    const person = pairOf(g, p)?.person
    const minor = !!person && (!country.mainRaces.includes(person.race) || !country.mainCultures.includes(person.culture))
    return minor === c.partnerMinority
  }
  if ('minority' in c) return isMinority(g, p) === c.minority
  if ('has' in c) return has(g, p, c.has)
  if ('seg' in c) return c.seg.includes(SEGMENTS[p.seg])
  if ('flag' in c) return !!p.flags[c.flag]
  if ('log' in c) return inRange(p.counters[c.log] ?? 0, c)
  if ('val' in c) return inRange(derived(g, p, c.val), c)
  if ('countOf' in c) return c.countOf.filter((n) => has(g, p, n)).length >= c.gte
  if ('atEntry' in c) return !!p.flags[entryKey(c)]
  if ('reached' in c) return p.seg >= SEGMENTS.indexOf(c.reached)
  if ('clsVsBirth' in c) {
    const l = g.c.tables.work.ladder
    return c.clsVsBirth === 'выше' ? l[p.cls] > l[p.familyCls] : l[p.cls] >= l[p.familyCls]
  }
  if ('partnerCls' in c) { const person = pairOf(g, p)?.person; return !!person && c.partnerCls.includes(person.cls) }
  if ('inInst' in c) return p.inst?.kind === c.inInst
  if ('vsStart' in c) return c.is === 'выше' ? p.pos > p.start.pos : p.pos >= p.start.pos
  if ('mainCulture' in c) return c.mainCulture.includes(country.mainCultures[0])
  if ('diaspora' in c) return !culturesOf(p).some((x) => country.mainCultures.includes(x) || country.minorityCultures.includes(x)) === c.diaspora
  if ('mode' in c) return g.s.config.mode === c.mode
  if ('meaning' in c) return c.meaning === 'серость' ? p.meaning?.id === 'серость' : !!p.meaning && p.meaning.id !== 'серость'
  if ('hasKind' in c) return p.items.some((h) => kindOf(g, h) === c.hasKind)
  if ('visited' in c) return (p.visits[c.visited] ?? []).includes(p.seg)
  if ('draft' in c) return drafted(g, p, ctx) === c.draft
  if ('inTarget' in c) return (ctx?.target === p.country) === c.inTarget
  if ('draftable' in c) return ((p.seg === 2 || p.seg === 3) && sexCalled(g, p)) === c.draftable
  if ('formerDominant' in c) return !!ctx?.formerDominant === c.formerDominant
  if ('side' in c) return ctx?.side === c.side
  if ('chose' in c) return !!ctx?.shared.chose.includes(c.chose)
  if ('sentenceTag' in c) return p.inst?.tag === c.sentenceTag
  if ('emigrant' in c) return (p.country !== p.birthCountry) === c.emigrant
  if ('notAlone' in c) return (!!pairOf(g, p) || !!p.flags['Не один'] || !!p.rules['сиделка']) === c.notAlone
  if ('partnerDiff' in c) {
    const person = pairOf(g, p)?.person
    if (!person) return false
    if (c.partnerDiff === 'культура') return !culturesOf(p).includes(person.culture)
    if (c.partnerDiff === 'класс') return person.cls !== p.cls
    return person.race !== p.race
  }
  if ('count' in c) return held(g, p, c.count).length >= c.gte
  if ('powerChanged' in c) return (c.inSeg ? (p.visits['смена власти'] ?? []).includes(p.seg) : country.powerChanges > 0) === c.powerChanged
  if ('stability' in c) return inRange(country.stability, c.stability)
  if ('clsRole' in c) return p.cls === (c.clsRole === 'доминирующий' ? country.dominant : country.alienated)
  if ('dominant' in c) return c.dominant.includes(country.dominant)
  if ('alienated' in c) return c.alienated.includes(country.alienated)
  if ('multicultural' in c) return country.multicultural === c.multicultural
  if ('relation' in c) return g.s.world.countries.some((o) => o.id !== country.id && relation(g, o.id, country.id) === c.relation)
  if ('fromHostile' in c) return (p.country !== p.birthCountry && relation(g, p.country, p.birthCountry) === 'вражда') === c.fromHostile
  if ('inFashion' in c) return (country.fashionIn === p.race) === c.inFashion
  if ('cultureIs' in c) return culturesOf(p).some((x) => c.cultureIs.includes(x))
  if ('ownBusiness' in c) return p.items.some((h) => kindOf(g, h) === 'дело') === c.ownBusiness
  if ('working' in c) return ((p.visits['Стаж'] ?? []).includes(p.seg) || !!p.student) === c.working
  throw new Error(`неизвестное условие: ${JSON.stringify(c)}`)
}

/** Призыв: в «призывных» идеологиях — всегда, в остальных — d6 1–3, один бросок на карту. Зовут пол в преимуществе. */
function drafted(g: G, p: Player, ctx?: Ctx): boolean {
  if (!sexCalled(g, p)) return false
  const ideo = countryOf(g, p).ideology
  if (ideo === 'Военная диктатура' || ideo === 'Госсоциализм' || ideo === 'Национализм') return true
  if (!ctx) return false
  ctx.shared.draft ??= die(g, 6)
  return ctx.shared.draft <= 3
}

/** Ключ отметки «условие выполнялось на входе в отрезок». */
export const entryKey = (c: Extract<Cond, { atEntry: unknown }>): string => `вход:${JSON.stringify(c)}`

/** Все условия `atEntry` в дереве условия. */
export function entryConds(c: Cond, out: Extract<Cond, { atEntry: unknown }>[] = []): Extract<Cond, { atEntry: unknown }>[] {
  if ('all' in c) c.all.forEach((x) => entryConds(x, out))
  else if ('any' in c) c.any.forEach((x) => entryConds(x, out))
  else if ('not' in c) entryConds(c.not, out)
  else if ('atEntry' in c) out.push(c)
  return out
}

export const classRank = (g: G, cls: Cls): number => g.c.tables.work.ladder[cls]
export const ALL_CLASSES: readonly Cls[] = CLASSES
