/** Изменения состояния игрока: числа, здоровье и смерть, класс, характер, институты, предметы. */
import { SEGMENTS, STATS, type Node } from '../data/schema.ts'
import { ask, clamp, countryOf, die, emit, pick, say, segName, shuffle, step, todo, type Flow, type G } from './core.ts'
import { charAxisOf, cultureLean, has, held, kindOf, pairOf, type Ctx, newCtx } from './cond.ts'
import { run } from './exec.ts'
import { settle } from './meaning.ts'
import type { CharPole, Cls, Culture, Held, InstKind, Player, Race, Stat, Tag } from './types.ts'

export const count = (p: Player, name: string, n = 1): void => { p.counters[name] = (p.counters[name] ?? 0) + n }

// ── Числа ───────────────────────────────────────────────────────────────

const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0)
/** Сделать число на n крупнее (n < 0 — мельче, но не дальше нуля). */
const grow = (x: number, n: number): number => (x === 0 ? 0 : sign(x) * Math.max(0, Math.abs(x) + n))

export function statCap(g: G, p: Player, stat: Stat): number {
  return p.unsealed.includes(stat) ? g.c.tables.caps.miracle : g.c.tables.caps.stat
}
export function vozmCap(g: G, p: Player): number {
  const t = g.c.tables.caps
  return p.cls === 'Олигархи' && t.vozmOligarchItems.some((n) => has(g, p, n)) ? t.vozmOligarch : t.vozm
}

/** Изменить число. Вся арифметика правил — здесь: «сильно», возрастной сдвиг, потолки, пороги. */
export function addParam(g: G, p: Player, param: string, delta: number, ctx: Ctx): void {
  if (!p.alive || delta === 0) return
  const t = g.c.tables
  const health = param === 'физ' || param === 'псих'
  if (ctx.strong && (health || param === 'возм')) delta = grow(delta, 1)
  if (health && ctx.source === 'карта') {
    const sh = t.ageShift[segName(p)]
    const n = param === 'физ' ? (delta > 0 ? sh.physPos : sh.physNeg) : delta > 0 ? sh.psyPos : sh.psyNeg
    if (n) delta = grow(delta, n)
    if (delta === 0) return
  }
  const from = read(p, param)
  let to = from + delta
  if (health) to = clamp(to, t.caps.death, t.caps.health)
  else if (param === 'возм') to = clamp(to, t.caps.bondage, vozmCap(g, p))
  else if (param === 'Сплочённость' || param === 'Финансы' || param === 'Положение') to = clamp(to, -t.caps.scale, t.caps.scale)
  else if ((STATS as readonly string[]).includes(param)) {
    // Рынок поднимает до 7 (с предрасположенностью до 8); события — до 10, с чудом до 12. Явный потолок шага важнее.
    const cap = ctx.cap ?? (ctx.source === 'действие' ? (p.predisp === param ? t.caps.marketPredisp : t.caps.market) : statCap(g, p, param as Stat))
    to = delta > 0 ? Math.max(from, Math.min(cap, to)) : Math.max(0, to)
  } else to = Math.max(0, to)
  if (to === from) return
  write(p, param, to)
  emit(g, { t: 'число', p: p.seat, param, from, to, delta: to - from })
  if (param === 'Стаж') {
    p.stazhHire += to - from
    visit(p, 'Стаж')
    if (p.counters['выход из института']) count(p, 'Стаж после выхода', to - from)
  }
  if ((health || param === 'возм') && to < -5) p.flags['За чертой'] = true
  if (health) checkHealth(g, p, ctx)
}

export function setParam(g: G, p: Player, param: string, value: number): void {
  const from = read(p, param)
  if (from === value) return
  write(p, param, value)
  emit(g, { t: 'число', p: p.seat, param, from, to: value, delta: value - from })
}

function read(p: Player, param: string): number {
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
    default: return p.stats[param as Stat]
  }
}
function write(p: Player, param: string, v: number): void {
  switch (param) {
    case 'физ': p.phys = v; break
    case 'псих': p.psy = v; break
    case 'возм': p.vozm = v; break
    case 'Стаж': p.stazh = v; break
    case 'Стаж найма': p.stazhHire = v; break
    case 'Пожертвования': p.donations = v; break
    case 'Сплочённость': p.coh = v; break
    case 'Финансы': p.fin = v; break
    case 'Положение': p.pos = v; break
    default: p.stats[param as Stat] = v
  }
}

export function visit(p: Player, place: string): void {
  const v = (p.visits[place] ??= [])
  if (!v.includes(p.seg)) v.push(p.seg)
}

// ── Здоровье и смерть ───────────────────────────────────────────────────

/** Пороги здоровья («Смерть и победа», «Тотальные институты», «Рынок не убивает»). */
export function checkHealth(g: G, p: Player, ctx: Ctx): void {
  const t = g.c.tables
  const soft = ctx.source === 'действие' || p.inst?.kind === 'кабала'
  if (p.phys <= t.caps.death) {
    if (soft) { p.phys = t.caps.floor; if (ctx.source === 'действие') breakdown(g, p) } else return death(g, p, 'физическое здоровье')
  }
  if (p.psy <= t.caps.death) {
    if (soft) { p.psy = t.caps.floor; if (ctx.source === 'действие') breakdown(g, p); return }
    if (p.seg === 0) { p.psy = t.caps.floor; p.skip = Math.max(p.skip, 1); say(g, p, 'опека: следующий ход пропущен'); return }
    if (p.seg === 1 && !p.teenBreak && p.inst?.kind !== 'психбольница') {
      p.teenBreak = true; p.psy = t.caps.floor; p.skip = Math.max(p.skip, 1); say(g, p, 'срыв: следующий ход пропущен'); return
    }
    const c = countryOf(g, p)
    const limit = t.inst.asylum[c.pos] + (c.ideology === 'Социал-демократия' ? t.inst.asylum.socialDemocracy : 0)
    if (p.seg === 1 || rollDie(g, p, 6, 'психбольница или смерть') <= limit) {
      p.psy = t.inst.asylum.startPsy
      enterInst(g, p, 'психбольница', t.inst.asylum.turns, ctx.tags[0])
    } else death(g, p, 'психическое здоровье')
  }
}

/** Срыв: рынок не убивает, но следующий ход пропускается, а до конца отрезка открыто только лечение. */
function breakdown(g: G, p: Player): void {
  p.skip = Math.max(p.skip, 1)
  p.rules['срыв'] = { seg: p.seg }
  say(g, p, 'срыв: следующий ход пропущен')
}

export function death(g: G, p: Player, cause: string): void {
  if (!p.alive) return
  p.alive = false
  p.death = { seg: segName(p), cause, round: g.s.round }
  delete p.inst
  emit(g, { t: 'смерть', p: p.seat, cause })
  settle(g, p)
}

export function rollDie(g: G, p: Player, n: number, why: string): number {
  const value = die(g, n)
  emit(g, { t: 'бросок', p: p.seat, die: n, value, why })
  return value
}

// ── Класс и характер ────────────────────────────────────────────────────

/** Смена класса: ключи старого класса гаснут («Смена класса»). Без гражданства в Армию и Полицию не берут. */
export function setClass(g: G, p: Player, cls: Cls): boolean {
  if (cls === p.cls) return false
  if ((cls === 'Армия' || cls === 'Полиция') && !p.citizenship.includes(p.country)) { say(g, p, `без гражданства в класс ${cls} не берут`); return false }
  const from = p.cls
  const key = { 'Армия': ['Присяга', 'Офицерское звание'], 'Полиция': ['Значок'] }[from as string] ?? []
  for (const k of key) for (const h of held(g, p, k)) removeHeld(g, p, h)
  p.cls = cls
  emit(g, { t: 'класс', p: p.seat, from, to: cls })
  count(p, 'смена класса')
  if (from === 'Армия') count(p, 'уход из Армии')
  if (from === 'Мафия') count(p, 'уход из Мафии')
  if (from === 'Олигархи') count(p, 'уход из Олигархов')
  if (cls === 'Армия') p.flags['Армия, война'] = true
  p.vozm = Math.min(p.vozm, vozmCap(g, p))
  if (cls === 'Мафия') fire(g, p, 'переход в Мафию')
  return true
}

export function charStep(g: G, p: Player, pole: CharPole, n = 1): void {
  const [axis, dir] = charAxisOf(pole)
  const cap = g.c.tables.caps.character
  const to = clamp(p.character[axis] + dir * n, -cap, cap)
  if (to === p.character[axis]) return
  p.character[axis] = to
  emit(g, { t: 'характер', p: p.seat, pole, value: to })
}

// ── Отложенные эффекты ──────────────────────────────────────────────────

/** Событие наступило: отложенные эффекты (`later`) становятся в очередь и сработают в ближайшей точке покоя. */
export function fire(_g: G, p: Player, when: Player['laters'][number]['when']): void {
  for (const l of p.laters) if (l.when === when) l.due = true
}
/** Выполнить отложенные эффекты, для которых событие уже наступило. */
export function* runDue(g: G, p: Player): Flow {
  for (;;) {
    const i = p.laters.findIndex((l) => l.due)
    if (i < 0 || !p.alive) return
    const [l] = p.laters.splice(i, 1)
    yield* run(g, p, l.then, newCtx('карта', { card: l.card, tags: l.card ? g.cards.get(l.card)?.card.tags ?? [] : [] }))
  }
}

// ── Институты ───────────────────────────────────────────────────────────

export function enterInst(g: G, p: Player, kind: InstKind, turns: number, tag?: Tag): void {
  if (!p.alive) return
  if (p.counters['выход из института']) count(p, 'повторное попадание в институт')
  p.inst = { kind, left: turns, turn: 0 }
  if (tag) p.inst.tag = tag
  count(p, kind)
  emit(g, { t: 'институт', p: p.seat, kind, how: 'вход', turns })
}

/** Выход из института со стигмой («Судимость», «Учёт», «Долг»), если карта не сказала иначе. */
export function* leaveInst(g: G, p: Player, noStigma = false): Flow {
  const inst = p.inst
  if (!inst) return
  delete p.inst
  emit(g, { t: 'институт', p: p.seat, kind: inst.kind, how: 'выход' })
  count(p, 'выход из института')
  const t = g.c.tables.inst
  if (inst.kind === 'тюрьма') count(p, 'срок отбыт')
  const stigma = inst.kind === 'тюрьма' ? t.prison.stigma : inst.kind === 'психбольница' ? t.asylum.stigma : t.bondage.stigma
  // Подростковое отделение стигмы не оставляет: «Учёт» — с Молодости.
  if (!noStigma && !inst.noStigma && !(inst.kind === 'психбольница' && p.seg < 2)) yield* gainItem(g, p, stigma)
  if (inst.kind === 'тюрьма') { fire(g, p, 'выход из тюрьмы'); yield* runDue(g, p) }
}

// ── Предметы ────────────────────────────────────────────────────────────

/** Сколько ячеек у игрока под предметы вида; undefined — без лимита. */
export function capacity(g: G, p: Player, kind: string): number | undefined {
  const t = g.c.tables.slots
  const best = Math.max(p.fin, p.pos)
  switch (kind) {
    case 'связь': return step(t.links, p.stats['Харизма'])
    case 'статус': return t.statuses
    case 'козырь': return Math.max(0, best)
    case 'антикозырь': return p.fin === -3 || p.pos === -3 ? 1 : 0
    case 'вещь': return t.things + (p.vozm >= t.thingsExtraFromVozm ? 1 : 0)
    default: return undefined
  }
}
/** Занимает ли карта ячейку: Супруг(а) и дети — вне ячеек. */
const inSlot = (g: G, h: Held): boolean => !h.spouse && !g.c.tables.slots.free.includes(g.items.get(h.name)?.group ?? '')

/** Взять верхнюю карту слепой стопки; пустую стопку собираем заново из карт, которых нет на руках. */
function drawBlind(g: G, pile: string, names: () => string[]): string {
  const stack = (g.s.piles[pile] ??= [])
  if (stack.length === 0) {
    const out = new Set(g.s.players.flatMap((q) => q.items.map((h) => h.name)))
    const fresh = names().filter((n) => !out.has(n))
    stack.push(...shuffle(g, fresh.length ? fresh : names()))
  }
  return stack.shift()!
}

/** Человек «по населению страны, с перевесом в свою сторону» («Партнёр и брак»). */
function person(g: G, p: Player): NonNullable<Held['person']> {
  const t = g.c.tables.partner
  const c = countryOf(g, p)
  const weighted = Object.entries(t.classPop).flatMap(([k, w]) => Array<Cls>(w).fill(k as Cls))
  const cls = die(g, 100) <= t.sameClass ? p.cls : pick(g, weighted)
  const cultures = [...c.mainCultures, ...c.minorityCultures].filter((x) => x !== p.culture)
  const races = [...c.mainRaces, ...c.minorityRaces].filter((x) => x !== p.race)
  const culture: Culture = die(g, 100) <= t.sameCulture || !cultures.length ? p.culture : pick(g, cultures)
  const race: Race = die(g, 100) <= t.sameRace || !races.length ? p.race : pick(g, races)
  return { cls, culture, race }
}

/** Получить предмет: имя карты или стопка людей («Друг» — вслепую). Возвращает карту или undefined, если не взят. */
export function* gainItem(g: G, p: Player, name: string, opts: { adopted?: true } = {}): Flow<Held | undefined> {
  if (!p.alive) return
  if (name === 'Супруг(а)') { yield* wed(g, p); return pairOf(g, p) }
  // «Партнёр» не приходит, если уже есть Партнёр или Супруг(а).
  if (name === 'Партнёр' && pairOf(g, p)) { say(g, p, 'пара уже есть: новый Партнёр не приходит'); return }
  const group = g.groups.has(name) ? name : undefined
  const cardName = group ? drawBlind(g, `люди.${group}`, () => g.groups.get(group)!.flatMap((n) => Array<string>(Math.max(1, g.items.get(n)!.copies)).fill(n))) : name
  const item = g.items.get(cardName)
  if (!item) throw new Error(`нет предмета «${cardName}»`)
  if (item.group === 'Партнёр' && pairOf(g, p)) {
    if (group) g.s.piles[`люди.${group}`].unshift(cardName)
    say(g, p, 'пара уже есть: новый Партнёр не приходит')
    return
  }
  // Карту человека назвали по имени: из слепой стопки она тоже уходит.
  if (!group && item.group) {
    const stack = g.s.piles[`люди.${item.group}`]
    const i = stack?.indexOf(cardName) ?? -1
    if (i >= 0) stack.splice(i, 1)
  }
  // Стигмы и статусы не дублируются: «стигма одна».
  if ((item.kind === 'стигма' || item.kind === 'статус') && has(g, p, item.name) && item.name !== 'Привычка') {
    if (item.kind === 'стигма') count(p, 'стигма получена')
    say(g, p, `«${item.name}» уже есть`)
    return
  }
  if (item.kind === 'дело') {
    const old = p.items.find((h) => kindOf(g, h) === 'дело')
    if (old) { addParam(g, p, 'возм', 3 * (g.items.get(old.name)?.biz?.bonus ?? 0), newCtx('правило')); removeHeld(g, p, old); say(g, p, `старое дело «${old.name}» продано`) }
  }
  const cap = capacity(g, p, item.kind)
  if (cap !== undefined && inSlotKind(g, item.kind, item.group)) {
    const same = p.items.filter((h) => kindOf(g, h) === item.kind && inSlot(g, h))
    if (cap === 0) { say(g, p, `нет ячейки: «${item.name}» не взять`); return }
    if (same.length >= cap) {
      const a = yield* ask(g, p, 'сброс', `Ячейки заняты. Взять «${item.name}» вместо другой карты?`, [
        ...same.map((h) => ({ id: String(h.uid), label: `сбросить «${h.name}»`, note: dropNote(g, h) })),
        { id: 'нет', label: `не брать «${item.name}»` },
      ], { force: true })
      if (a === 'нет') return
      yield* dropHeld(g, p, same.find((h) => String(h.uid) === a)!, true)
    }
  }
  const h: Held = { uid: ++g.s.uid, name: item.name }
  if (opts.adopted) h.adopted = true
  if (item.uses) h.uses = item.uses
  if (item.group === 'Партнёр') h.person = person(g, p)
  p.items.push(h)
  emit(g, { t: 'предмет', p: p.seat, name: item.name, how: 'получен' })
  if (item.kind === 'стигма') count(p, 'стигма получена')
  if (item.kind === 'козырь') count(p, 'козырь получен')
  if (item.name === 'Компромат') count(p, 'получен «Компромат»')
  if (['Партбилет', 'Присяга', 'Значок'].includes(item.name)) count(p, 'получен Партбилет, Присяга или Значок')
  if (item.group === 'Партнёр') count(p, 'партнёр')
  if (item.onGain) yield* run(g, p, item.onGain, newCtx('правило'))
  return h
}
const inSlotKind = (g: G, _kind: string, group?: string): boolean => !g.c.tables.slots.free.includes(group ?? '')

function dropNote(g: G, h: Held): string | undefined {
  const price = g.c.tables.dropPrice[h.spouse ? 'Супруг(а)' : g.items.get(h.name)?.group ?? '']
  return price ? `${price.psy} псих.` : undefined
}

/** Убрать карту без цены и вернуть её под низ своей стопки. */
export function removeHeld(g: G, p: Player, h: Held): void {
  const i = p.items.indexOf(h)
  if (i < 0) return
  p.items.splice(i, 1)
  const item = g.items.get(h.name)
  emit(g, { t: 'предмет', p: p.seat, name: h.name, how: 'потерян' })
  if (item?.kind === 'стигма') { count(p, 'стигма снята'); if (h.name === 'Долг') count(p, 'снят «Долг»') }
  if (item?.group && g.s.piles[`люди.${item.group}`]) g.s.piles[`люди.${item.group}`].push(h.name)
  if (item && (item.deck === 'Верхи' || item.deck === 'Дно') && g.s.piles[item.deck]) g.s.piles[item.deck].push(h.name)
}

/** Сбросить карту; price — с ценой сброса своего вида («Сброс предметов»). */
export function* dropHeld(g: G, p: Player, h: Held, price: boolean, widowed = false): Flow {
  const item = g.items.get(h.name)
  const key = h.spouse ? 'Супруг(а)' : item?.group ?? ''
  removeHeld(g, p, h)
  // Супруг(а) уходит — развод; на карте #утрата — вдовство, в журнал разводов не идёт.
  if (h.spouse && !widowed) count(p, 'развод')
  const cost = price ? g.c.tables.dropPrice[key] : undefined
  if (!cost) return
  const ctx = newCtx('правило')
  addParam(g, p, 'псих', cost.psy, ctx)
  if (cost.coh) addParam(g, p, 'Сплочённость', cost.coh, ctx)
  // Развод в традиционной или теистичной культуре: ещё помеха в #статус до конца отрезка.
  if (h.spouse && (cultureLean(g, p, 'Традиция') || cultureLean(g, p, 'Теизм'))) p.mods.push({ tag: '#статус', dis: true, until: 'отрезок', seg: p.seg })
  if (cost.enemyUpTo && rollDie(g, p, 6, 'обида Покровителя') <= cost.enemyUpTo) yield* gainItem(g, p, 'Враг')
}

/** Потерять предмет по имени или стопке. Если подходящих несколько, кого терять — решает игрок. */
export function* loseItem(g: G, p: Player, name: string, price: boolean, widowed = false): Flow<boolean> {
  const list = held(g, p, name)
  if (!list.length) return false
  const id = list.length === 1 ? String(list[0].uid) : yield* ask(g, p, 'предмет', `Кого теряешь: ${name}?`, list.map((h) => ({ id: String(h.uid), label: h.name })))
  yield* dropHeld(g, p, list.find((h) => String(h.uid) === id)!, price, widowed)
  return true
}

/** Свадьба: карта Партнёра переворачивается стороной «Супруг(а)» и уходит из ячеек в семью. */
export function* wed(g: G, p: Player): Flow<boolean> {
  const h = pairOf(g, p)
  if (!h || h.spouse) return false
  h.spouse = true
  emit(g, { t: 'предмет', p: p.seat, name: h.name, how: 'свадьба' })
  count(p, 'свадьба')
  if (p.counters['свадьба'] === 1 && p.seg >= SEGMENTS.indexOf('Зрелость')) count(p, 'первый брак в Зрелости или позже')
  const onWed = g.items.get(h.name)?.sides?.spouse.onWed
  if (onWed) yield* run(g, p, onWed, newCtx('правило'))
  return true
}

/** Эффекты предметов в начале отрезка: сама карта, её сторона (Партнёр или Супруг(а)) и тень. */
export function* itemsPerSeg(g: G, p: Player): Flow {
  for (const h of [...p.items]) {
    const item = g.items.get(h.name)
    if (!item || !p.alive) continue
    const parts: (Node[] | undefined)[] = [item.perSeg, item.shadow?.perSeg, item.sides ? (h.spouse ? item.sides.spouse.perSeg : item.sides.partner.perSeg) : undefined]
    for (const nodes of parts) if (nodes) yield* run(g, p, nodes, newCtx('правило'))
  }
}

export { todo }
