/**
 * Война на «Фронте» (концепция, раздел «Война»; ответы 13.11, 14.11, 16.11).
 * Одна война на мир: две стороны (в мировой — коалиции), трек от +7 до −7, метка — с края первой стороны.
 * Солдат-игрок — в институте «фронт»: фишка идёт по полю жизни, клетки не играются; вместо них тактика,
 * атака и событие клетки трека. Хранитель часов бросает атаку за сторону без солдат-игроков;
 * солдат-игроков нет ни у одной стороны — войну решают два броска хранителя, без трека.
 */
import { CULTURE_AXES, type FrontEvent } from '../data/schema.ts'
import { ask, clamp, die, emit, pick, rnd, roll3, say, type Flow, type G } from './core.ts'
import { charLean, cond, culturesOf, has, isMinority, newCtx, relation } from './cond.ts'
import { addParam, count, enterInst, gainItem, rollDie } from './change.ts'
import { spend } from './checks.ts'
import { run } from './exec.ts'
import { arrive } from './emigration.ts'
import { addStazh } from './market.ts'
import { settle } from './meaning.ts'
import { classesFor } from './setup.ts'
import { crisisCheck, flight, stab, turmoil } from './world.ts'
import type { Country, Player, War } from './types.ts'

type Side = 0 | 1
type Tactic = 'атака' | 'держать' | 'беречь'

const RANK: Record<string, number> = { 'периферия': 0, 'полупериферия': 1, 'ядро': 2 }
const alive = (p: Player | undefined): p is Player => !!p && p.alive && !p.finished
const T = (g: G) => g.c.tables.war

// ── Справки ─────────────────────────────────────────────────────────────

export const sideOf = (w: War, country: number): Side | undefined => (w.sides[0].includes(country) ? 0 : w.sides[1].includes(country) ? 1 : undefined)
/** Клетка метки со своего края: +7 — своя «ПОБЕДА!», −7 — «Разгром». */
export const cellFor = (w: War, side: Side): number => (side === 0 ? w.mark : -w.mark)
const lead = (g: G, w: War, side: Side): Country => g.s.world.countries[w.sides[side][0]]
const members = (w: War): number[] => [...w.sides[0], ...w.sides[1]]
const names = (g: G, ids: number[]) => ids.map((id) => g.s.world.countries[id].name).join(', ')
const cellTitle = (g: G, cell: number) => g.c.front.cells.find((c) => c.cell === cell)?.title ?? String(cell)
/** Солдаты-игроки на фронте этой войны (стороны — все или одна). */
export const soldiers = (g: G, w: War, side?: Side): Player[] =>
  g.s.players.filter((p) => alive(p) && p.inst?.kind === 'фронт' && p.inst.war === w.n && (side === undefined || p.inst.side === side))
const log = (g: G, text: string, p?: Player) => emit(g, { t: 'фронт', text, ...(g.s.war ? { mark: g.s.war.mark } : {}), ...(p ? { p: p.seat } : {}) })
const served = (p: Player, w: War) => p.rules['фронт пройден']?.arg === String(w.n)

// ── Трек ────────────────────────────────────────────────────────────────

/** Сдвиг метки на n клеток к противнику стороны side (минус — к своим). */
export function moveMark(g: G, w: War, side: Side, n: number): void {
  if (w.over !== undefined || n === 0) return
  w.mark = clamp(w.mark + (side === 0 ? n : -n), -T(g).track, T(g).track)
  log(g, `метка → ${cellFor(w, 0) > 0 ? '+' : ''}${w.mark} («${cellTitle(g, cellFor(w, side))}» для ${lead(g, w, side).name})`)
  reached(g, w)
}

/** Метка дошла до «ПОБЕДЫ!» стороны: победа — или «Ни шагу назад!» госсоциализма. */
function reached(g: G, w: War): void {
  for (const att of [0, 1] as Side[]) {
    if (cellFor(w, att) < T(g).track) continue
    const def = (1 - att) as Side
    if (lead(g, w, def).ideology !== T(g).hold) { w.over = att; return }
    const r = die(g, 6)
    if (r % 2 === 0) { log(g, `«Ни шагу назад!»: d6 = ${r}, чёт — город взят`); w.over = att; return }
    w.siege[att] += 1
    log(g, `«Ни шагу назад!»: d6 = ${r}, нечет — город держится${w.siege[att] >= 2 ? '; второй нечет подряд — враг отброшен' : ''}`)
    if (w.siege[att] >= 2) { w.mark = att === 0 ? T(g).track - 1 : -(T(g).track - 1); w.siege[att] = 0 }
  }
}

/**
 * Бросок атаки стороны («В атаку» солдата или хранителя). 4–6 — метка на d4 к противнику; сторона с позицией выше в каждую
 * вторую свою атаку бросает d4 с преимуществом; офицер перебрасывает d4 ≤ 2. 1 на кубике у солдата — −1 физ. (офицеру нет).
 */
function* attack(g: G, w: War, side: Side, p?: Player): Flow {
  if (w.over !== undefined) return
  const t = T(g)
  const own = lead(g, w, side)
  const foe = lead(g, w, (1 - side) as Side)
  if (cellFor(w, side) >= t.track && foe.ideology === t.hold) { reached(g, w); return }
  let nat: number
  if (own.ideology === t.ready && w.first[side]) {
    nat = 6
    log(g, `«Всегда готовы»: первая атака ${own.name} — успех без броска`, p)
  } else {
    nat = p ? rollDie(g, p, 6, 'атака') : die(g, 6)
    if (nat < t.attack.hit && t.holy.includes(own.ideology) && w.holy[side]) {
      // «Священная война»: кубик перебрасывает игрок, чей он; за сторону без игроков — движок, первый проваленный.
      const again = p ? (yield* ask(g, p, 'фронт', `Атака провалена (d6 = ${nat}). «Священная война»: перебросить d6? Переброс один на мировой ход.`, [
        { id: 'перебросить', label: 'перебросить d6 атаки' }, { id: 'нет', label: 'оставить' },
      ], { force: true })) === 'перебросить' : true
      if (again) { w.holy[side] = false; nat = p ? rollDie(g, p, 6, 'атака: «Священная война»') : die(g, 6); log(g, `«Священная война»: переброс — ${nat}`, p) }
    }
  }
  w.first[side] = false
  if (nat >= t.attack.hit) {
    let st = p ? rollDie(g, p, t.attack.steps, 'шаги') : die(g, t.attack.steps)
    if (RANK[own.pos] > RANK[foe.pos]) {
      w.attacks[side] += 1
      if (w.attacks[side] % 2 === 0) st = Math.max(st, die(g, t.attack.steps))
    }
    if (p && has(g, p, 'Офицерское звание') && st <= 2) { st = rollDie(g, p, t.attack.steps, 'шаги: офицер перебрасывает'); }
    log(g, `${p ? p.name : `хранитель за ${own.name}`}: атака ${nat} — вперёд на ${st}`, p)
    moveMark(g, w, side, st)
  } else {
    log(g, `${p ? p.name : `хранитель за ${own.name}`}: атака ${nat} — без продвижения`, p)
    if (nat === t.attack.fumble && p && !has(g, p, 'Офицерское звание')) { say(g, p, 'сорванная атака'); addParam(g, p, 'физ', t.attack.fumbleLoss, newCtx('правило', { tags: ['#война'] })) }
  }
}

// ── Объявление ──────────────────────────────────────────────────────────

/**
 * Карта «Война» / «Мировая война», часть «Страна». Мировая: ядра — случайная враждующая пара, остальные вступают за того,
 * с кем у них союз (союзник обеих или ничей — нейтрал). Возвращает страны в войне.
 */
export function declareWar(g: G, world: boolean): number[] {
  const all = g.s.world.countries
  const t = T(g)
  const pairsOf = (r: string) => all.flatMap((a) => all.filter((b) => b.id > a.id && relation(g, a.id, b.id) === r).map((b) => [a.id, b.id] as [number, number]))
  let hostile = pairsOf('вражда')
  // Вражды нет: местная — одна случайная нейтральная пара становится враждой, мировая — две.
  if (!hostile.length) {
    for (let i = 0; i < (world ? 2 : 1); i++) {
      const n = pairsOf('нейтралитет')
      if (!n.length) break
      const [a, b] = pick(g, n)
      g.s.world.relations[`${a}-${b}`] = 'вражда'
    }
    hostile = pairsOf('вражда')
  }
  if (!hostile.length) return []
  const [a, b] = pick(g, hostile)
  const sides: [number[], number[]] = [[a], [b]]
  if (world) {
    for (const c of all) {
      if (c.id === a || c.id === b) continue
      const ra = relation(g, c.id, a), rb = relation(g, c.id, b)
      if (ra === 'союз' && rb !== 'союз') sides[0].push(c.id)
      else if (rb === 'союз' && ra !== 'союз') sides[1].push(c.id)
    }
  }
  g.s.wars = (g.s.wars ?? 0) + 1
  const w: War = {
    n: g.s.wars, kind: world ? 'мировая' : 'местная', sides, mark: 0, first: [true, true], holy: [true, true], siege: [0, 0], attacks: [0, 0],
    rounds: 0, startWorldTurn: g.s.worldTurns, declaring: true,
  }
  g.s.war = w
  for (const id of members(w)) { all[id].war = true; stab(g, all[id], world ? t.declare.world : t.declare.local) }
  if (world) for (const c of all) if (!c.war) stab(g, c, t.declare.neutral)
  emit(g, { t: 'мир', text: `${world ? 'мировая война' : 'война'}: ${names(g, sides[0])} против ${names(g, sides[1])}; метка «Фронта» на 0` })
  return members(w)
}

/**
 * После части «Игроки» карты войны: в мировой — сразу проверка кризиса воюющим (смена власти даёт мир только на d12 10–12),
 * добровольцы, и если солдат-игроков нет — войну решает бросок хранителя.
 */
export function* afterDeclare(g: G): Flow {
  const w = g.s.war
  if (!w || !w.declaring) return
  if (w.kind === 'мировая') for (const id of members(w)) if (g.s.war === w) yield* crisisCheck(g, g.s.world.countries[id], true)
  if (g.s.war === w) for (const p of g.s.players.filter(alive)) yield* volunteerAsk(g, p)
  if (g.s.war === w) delete w.declaring
  if (g.s.war === w && !soldiers(g, w).length) yield* instant(g, w)
}

// ── Призыв и добровольцы ────────────────────────────────────────────────

/** Молодость и Зрелость, не в институте, на этой войне ещё не был. */
const fitForFront = (g: G, p: Player, w: War) => alive(p) && !p.inst && T(g).draft.segs.includes(segNameOf(p)) && !served(p, w)
const segNameOf = (p: Player) => (['Детство', 'Юность', 'Молодость', 'Зрелость', 'Старость', 'Древность'] as const)[p.seg]

/** Правило «призыв»: таблица по классу и идеологии; освобождают «Справка», «Друг в Генштабе», откуп Мафии. */
export function* draftCheck(g: G, p: Player): Flow {
  const w = g.s.war
  if (!w || w.over !== undefined || !fitForFront(g, p, w)) return
  const side = sideOf(w, p.country)
  if (side === undefined || !p.citizenship.includes(p.country) || !cond(g, p, { draftable: true })) return
  const t = T(g).draft
  const ideo = g.s.world.countries[p.country].ideology
  if (t.never.includes(p.cls)) return
  if (t.contract.includes(ideo) && !t.always.includes(p.cls) && cellFor(w, side) > t.contractUntil) return
  const wide = t.wide.includes(ideo)
  const upTo = t.always.includes(p.cls) ? 6 : p.cls === 'Народ' ? (wide ? t.peopleWide : t.people) : wide ? t.othersWide : t.others
  if (upTo < 6 && rollDie(g, p, 6, `призыв (1–${upTo})`) > upTo) return
  // Повестка: можно освободиться.
  const buyout = ideo === 'Клептократия' ? t.buyoutKlepto : t.buyout
  const options = [
    { id: 'фронт', label: 'на фронт', note: `${lead(g, w, side).name}: «${cellTitle(g, cellFor(w, side))}»` },
    ...t.exempt.filter((n) => has(g, p, n)).map((n) => ({ id: n, label: `освободиться: «${n}»` })),
    ...(p.cls === 'Мафия' ? [{ id: 'откуп', label: `откупиться: −${buyout} возм.`, ...(p.vozm < buyout ? { off: 'нет денег' } : {}) }] : []),
  ]
  const a = yield* ask(g, p, 'фронт', `Повестка: ${p.name} призван на войну`, options)
  if (a === 'откуп') { addParam(g, p, 'возм', -buyout, newCtx('правило')); say(g, p, 'откупился от призыва'); count(p, 'откуп от призыва'); return }
  if (a !== 'фронт') { const h = p.items.find((x) => x.name === a); if (h) spend(g, p, h); say(g, p, `освобождён: «${a}»`); return }
  enlist(g, p, w, side)
}

/** Правило «фронт»: карта отправляет сразу на «Фронт» (страна игрока воюет). */
export function frontNow(g: G, p: Player): void {
  const w = g.s.war
  const side = w ? sideOf(w, p.country) : undefined
  if (!w || side === undefined || w.over !== undefined) { say(g, p, 'страна не воюет'); return }
  if (!fitForFront(g, p, w)) { say(g, p, 'на «Фронт» не берут'); return }
  enlist(g, p, w, side)
}

/** За какие стороны игрок может уйти добровольцем: за свою страну; военные — и на чужую войну. */
export function volunteerSides(g: G, p: Player): { side: Side; foreign: boolean }[] {
  const w = g.s.war
  if (!w || w.over !== undefined || !fitForFront(g, p, w)) return []
  const own = sideOf(w, p.country)
  if (own !== undefined) return [{ side: own, foreign: false }]
  const mil = T(g).draft.military
  if (!mil.cls.includes(p.cls) && !has(g, p, mil.item)) return []
  let ok = ([0, 1] as Side[]).filter((s) => w.sides[s].some((id) => relation(g, p.country, id) === 'союз'))
  if (!ok.length) ok = ([0, 1] as Side[]).filter((s) => !w.sides[s].some((id) => relation(g, p.country, id) === 'вражда'))
  return ok.map((side) => ({ side, foreign: true }))
}

/** Предложить уйти добровольцем (при объявлении войны и в мировой ход). */
export function* volunteerAsk(g: G, p: Player): Flow {
  const w = g.s.war
  const list = volunteerSides(g, p)
  if (!w || !list.length) return
  const a = yield* ask(g, p, 'фронт', `Война: ${names(g, w.sides[0])} против ${names(g, w.sides[1])}. Уйти добровольцем?`, [
    ...list.map((x) => ({ id: `сторона ${x.side}`, label: `добровольцем за ${names(g, w.sides[x.side])}`, ...(x.foreign ? { note: 'чужая война: Стаж без пенсии' } : {}) })),
    { id: 'нет', label: 'остаться дома' },
  ], { force: true })
  if (a === 'нет') return
  const x = list.find((v) => `сторона ${v.side}` === a)!
  enlist(g, p, w, x.side, x.foreign)
  count(p, 'доброволец')
}

function enlist(g: G, p: Player, w: War, side: Side, foreign = false): void {
  enterInst(g, p, 'фронт', 99)
  if (p.inst?.kind !== 'фронт') return
  p.inst.side = side
  p.inst.war = w.n
  if (foreign) p.inst.foreign = true
  p.rules['фронт пройден'] = { arg: String(w.n) }
  p.flags['Побывать на войне'] = true
  p.flags['Армия, война'] = true
  log(g, `${p.name} уходит на «Фронт» за ${names(g, w.sides[side])}`, p)
}

// ── Ход солдата ─────────────────────────────────────────────────────────

/** Ход на фронте после движения фишки: Стаж, жалованье, тактика, атака, событие клетки, здоровье. */
export function* frontTurn(g: G, p: Player): Flow {
  const w = g.s.war
  const inst = p.inst!
  if (!w || inst.war !== w.n || w.over !== undefined) { offFront(g, p, 'домой'); return }
  if (p.seg >= 4) { offFront(g, p, 'демобилизация'); say(g, p, 'вошёл в Старость — демобилизован'); return }
  const t = T(g)
  const side = inst.side!
  const ideo = g.s.world.countries[p.country].ideology
  inst.turn += 1
  addStazh(p, !inst.foreign && !t.emptyStazh.includes(ideo))
  if (t.paid.includes(ideo)) addParam(g, p, 'возм', t.wage, newCtx('правило'))
  // Тактика.
  const hot = charLean(p, 'Вспыльчивость') === 2
  const cell = cellFor(w, side)
  const off = hot ? { off: 'сильная Вспыльчивость: только «В атаку»' } : {}
  const a = yield* ask(g, p, 'фронт', `«Фронт»: ${lead(g, w, side).name} на клетке ${cell > 0 ? '+' : ''}${cell} «${cellTitle(g, cell)}». Тактика?`, [
    { id: 'атака', label: 'В атаку', note: 'd6 4–6 — метка на d4 к противнику; 1 — −1 физ.' },
    { id: 'держать', label: 'Держать позицию', note: 'без броска атаки', ...off },
    { id: 'беречь', label: 'Беречь себя', note: 'потери физ. на 1 меньше; после события d6 1–2 — метка на клетку к своим', ...off },
    ...(has(g, p, 'Друг в Генштабе') ? [{ id: 'генштаб', label: '«Друг в Генштабе»: забрать с фронта', note: 'война для тебя кончится', ...off }] : []),
  ], { force: true })
  if (a === 'генштаб') {
    const h = p.items.find((x) => x.name === 'Друг в Генштабе')!
    spend(g, p, h)
    offFront(g, p, 'генштаб')
    return
  }
  inst.tactic = a as Tactic
  count(p, `тактика: ${a}`)
  emit(g, { t: 'выбор', p: p.seat, label: `тактика: ${a}` })
  if (a === 'атака') yield* attack(g, w, side, p)
  if (yield* health(g, p)) return
  if (w.over !== undefined) { yield* endWar(g, w.over); return }
  // Событие клетки, где метка, — со своего края; «Разгром» не играется: защитники госсоциализма читают «Последний рубеж».
  yield* frontEvent(g, p, Math.max(cellFor(w, side), -(t.track - 1)))
  if (yield* health(g, p)) return
  if (inst.tactic === 'беречь' && rollDie(g, p, 6, '«Беречь себя»: участок отходит на 1–2') <= t.retreatUpTo) { say(g, p, 'участок отходит'); moveMark(g, w, side, -1) }
  if (w.over !== undefined) yield* endWar(g, w.over)
}

/** Событие клетки трека: d10, офицер читает строку «Офицер». */
function* frontEvent(g: G, p: Player, cell: number): Flow {
  const n = rollDie(g, p, 10, 'событие фронта')
  const e = g.c.front.events.find((x) => x.cell === cell && x.n === n) as FrontEvent
  emit(g, { t: 'карта', p: p.seat, id: e.id, title: e.title, deck: 'фронт' })
  const officer = !!e.officer && has(g, p, 'Офицерское звание')
  // Возрастного сдвига нет: события «Фронта» — не карточки (как в симуляции war_sim.py).
  yield* run(g, p, officer ? e.officer! : e.effect, newCtx('правило', { card: e.id, deck: 'фронт', tags: e.tags }))
  settle(g, p)
}

/**
 * Потеря физ. в событии фронта: офицеру на 1 меньше, «Беречь себя» — ещё на 1. «Боевые друзья» могут отменить её целиком.
 */
export function* frontLoss(g: G, p: Player, delta: number): Flow<number> {
  const inst = p.inst
  let d = delta + (has(g, p, 'Офицерское звание') ? 1 : 0) + (inst?.tactic === 'беречь' ? 1 : 0)
  d = Math.min(0, d)
  if (d < 0 && has(g, p, 'Боевые друзья')) {
    const a = yield* ask(g, p, 'фронт', `Потеря ${d} физ. «Боевые друзья»: вытащить с фронта — отменить эту потерю? (козырь уйдёт)`, [
      { id: 'вытащить', label: `отменить −${-d} физ.` }, { id: 'нет', label: 'оставить козырь' },
    ], { force: true })
    if (a === 'вытащить') { spend(g, p, p.items.find((x) => x.name === 'Боевые друзья')!); say(g, p, 'боевые друзья вытащили'); return 0 }
  }
  return d
}

/** Здоровье после атаки или события. true — солдат ушёл с фронта (смерть, комиссия, плен, трибунал, психбольница). */
function* health(g: G, p: Player): Flow<boolean> {
  if (!p.alive) { warDeath(g, p); return true }
  if (p.inst?.kind !== 'фронт') {
    const how = p.inst?.kind === 'тюрьма' ? (p.inst.noStigma ? 'плен' : 'трибунал') : p.inst?.kind === 'психбольница' ? 'психбольница' : 'домой'
    left(g, p, how)
    return true
  }
  const c = T(g).commission
  if (p.phys <= c || p.psy <= c) { yield* commission(g, p); return true }
  return false
}

/** Комиссия: домой, война кончилась; бесплатное лечение по идеологии страны. */
function* commission(g: G, p: Player): Flow {
  const c = T(g).commission
  const body = p.phys <= c
  const mind = p.psy <= c
  offFront(g, p, body ? 'комиссия (физ.)' : 'комиссия (псих.)')
  const [tp, tq] = T(g).treat[g.s.world.countries[p.country].ideology]
  const ctx = newCtx('правило')
  for (const [need, how, param] of [[body, tp, 'физ'], [mind, tq, 'псих']] as const) {
    if (!need) continue
    if (!how) { say(g, p, param === 'физ' ? 'лечения не положено' : '«солдаты не плачут»'); continue }
    if (how.startsWith('+')) { say(g, p, '«свои выходят»'); addParam(g, p, param, Number(how.slice(1)), ctx) } else if (how === 'палата') {
      enterInst(g, p, 'психбольница', g.c.tables.inst.asylum.turns, '#война')
      if (p.inst) p.inst.noStigma = true
    } else {
      const act = g.c.actions.find((x) => x.id === how)
      if (act) { say(g, p, `лечение ветерана: ${act.label}`); yield* run(g, p, act.effect, ctx) }
    }
  }
}

/** Гибель на войне: запись, похоронка по идеологии страны (наследнику — в режиме «Род»). */
function warDeath(g: G, p: Player): void {
  if (p.death) p.death.cause = `война (${p.death.cause})`
  count(p, 'гибель на войне')
  const b = T(g).death[g.s.world.countries[p.country].ideology]
  emit(g, { t: 'текст', p: p.seat, text: `похоронка: ${b.text}` })
  p.pos = clamp(p.pos + (b.pos ?? 0), -3, 3)
  p.coh = clamp(p.coh + (b.coh ?? 0), -3, 3)
  // Наследнику: пока «Рода» нет — отметка в правилах игрока, её прочтёт наследник.
  if (b.vozm || b.wisdom || b.name) p.rules['похоронка'] = { arg: JSON.stringify({ vozm: b.vozm ?? 0, wisdom: b.wisdom ?? 0, name: !!b.name }) }
  log(g, `${p.name} погиб на войне`, p)
}

/** Солдат ушёл с фронта (институт уже сменился или кончился). */
function left(g: G, p: Player, how: string): void {
  count(p, `фронт: ${how}`)
  log(g, `${p.name}: ${how}`, p)
}

/** Снять с фронта: война для него кончилась. */
export function offFront(g: G, p: Player, how: string): void {
  if (p.inst?.kind === 'фронт') {
    const turns = p.inst.turn
    delete p.inst
    emit(g, { t: 'институт', p: p.seat, kind: 'фронт', how: 'выход', turns })
  }
  left(g, p, how)
}

/** Отпуск по ранению: ход дома прошёл — вернуться, если война та же и страна в ней. */
export function backToFront(g: G, p: Player, saved: NonNullable<Player['inst']>): void {
  const w = g.s.war
  if (alive(p) && !p.inst && w && w.n === saved.war && w.over === undefined && p.seg >= 2 && p.seg <= 3 && (saved.foreign || sideOf(w, p.country) === saved.side)) {
    p.inst = { ...saved }
    delete p.inst.leave
    say(g, p, 'отпуск кончился: обратно на «Фронт»')
  } else left(g, p, p.alive ? 'после отпуска домой' : 'умер в отпуске')
}

// ── Слова событий ───────────────────────────────────────────────────────

export function* warRule(g: G, p: Player, rule: string, arg?: string): Flow {
  const w = g.s.war
  const inst = p.inst?.kind === 'фронт' ? p.inst : undefined
  if (rule === 'награда') {
    if (inst?.tactic === 'атака') { addParam(g, p, 'Положение', 1, newCtx('правило')); count(p, 'награда'); say(g, p, 'награда') } else say(g, p, 'награда — тем, кто шёл «В атаку»')
  } else if (rule === 'метка фронта') {
    if (w && inst) moveMark(g, w, inst.side!, Number((arg ?? '1').replace('−', '-')))
  } else if (rule === 'плен') {
    if (!inst) return
    captivity(g, p)
    say(g, p, 'плен')
  } else if (rule === 'отпуск') {
    if (inst) { inst.leave = true; say(g, p, 'отпуск по ранению: следующий ход дома') }
  }
  yield* []
}

/** Плен: d3 хода тюрьмы без «Судимости», потом домой. */
function captivity(g: G, p: Player): void {
  delete p.inst
  enterInst(g, p, 'тюрьма', rollDie(g, p, T(g).captivity, 'плен'), '#война')
  const inst = p.inst as Player['inst']
  if (inst) inst.noStigma = true
}

// ── Круг и хранитель часов ──────────────────────────────────────────────

/** Конец круга: хранитель бросает атаку за каждую сторону без солдат-игроков; солдат нет ни у кого — бросок на победителя. */
export function* frontRound(g: G): Flow {
  const w = g.s.war
  if (!w) return
  w.rounds += 1
  if (!soldiers(g, w).length) { yield* instant(g, w); return }
  for (const side of [0, 1] as Side[]) if (w.over === undefined && !soldiers(g, w, side).length) yield* attack(g, w, side)
  if (w.over !== undefined) yield* endWar(g, w.over)
}

/**
 * Война без солдат-игроков: d6 — 6 «Белый мир»; позиции равны — 1–2 первая, 3–4 вторая, 5 — перебросить;
 * разные — 1–3 побеждает та, что выше, 4–5 слабая. Проигравшая сторона со «Священной войной» может раз потребовать переброс.
 */
function* instant(g: G, w: War): Flow {
  const a = RANK[lead(g, w, 0).pos], b = RANK[lead(g, w, 1).pos]
  const once = (): Side | 'мир' => {
    for (;;) {
      const r = die(g, 6)
      if (r === 6) return 'мир'
      if (a === b) { if (r <= 4) return r <= 2 ? 0 : 1; continue }
      const strong: Side = a > b ? 0 : 1
      return r <= 3 ? strong : ((1 - strong) as Side)
    }
  }
  let res = once()
  if (res !== 'мир') {
    const loser = (1 - res) as Side
    if (T(g).holy.includes(lead(g, w, loser).ideology) && w.holy[loser]) { w.holy[loser] = false; log(g, `«Священная война»: ${lead(g, w, loser).name} требует переброса`); res = once() }
  }
  log(g, `солдат-игроков нет — войну решает бросок хранителя: ${res === 'мир' ? '«Белый мир»' : `победа — ${names(g, w.sides[res])}`}`)
  count0(g, 'войн решено броском хранителя')
  yield* endWar(g, res)
}
/** Счётчик партии (для сверки с симуляцией). */
const count0 = (g: G, key: string) => { const st = (g.s.stats ??= {}); st[key] = (st[key] ?? 0) + 1 }

// ── Конец войны ─────────────────────────────────────────────────────────

/** Победа или мир. Солдаты едут домой (победители — через «ПОБЕДУ!», проигравшие — «Разгром»); затем итог войны. */
export function* endWar(g: G, how: 0 | 1 | 'мир'): Flow {
  const w = g.s.war
  if (!w || w.closing) return
  w.over = how
  w.closing = true
  const t = T(g)
  const all = g.s.world.countries
  emit(g, { t: 'мир', text: how === 'мир' ? `война окончена миром: ${names(g, members(w))}` : `победа: ${names(g, w.sides[how])} над ${names(g, w.sides[1 - how])} (кругов ${w.rounds})` })
  for (const p of soldiers(g, w)) {
    const side = p.inst!.side!
    if (how === 'мир') { offFront(g, p, 'домой (мир)'); continue }
    if (side === how) {
      p.inst!.tactic = 'атака'
      yield* frontEvent(g, p, t.track)
      if (yield* health(g, p)) continue
      offFront(g, p, 'домой (победа)')
    } else if (rollDie(g, p, 6, 'разгром: плен на 1') <= t.routCaptive) {
      captivity(g, p)
      left(g, p, 'плен (разгром)')
    } else {
      offFront(g, p, 'домой (разгром)')
      addParam(g, p, 'псих', t.routPsy, newCtx('правило', { tags: ['#война'] }))
    }
  }
  for (const id of members(w)) all[id].war = false
  delete g.s.war
  count0(g, how === 'мир' ? 'войн миром' : 'войн победой')
  if (how === 'мир') { for (const id of members(w)) stab(g, all[id], t.peaceStab); return }
  const win = w.sides[how], lose = w.sides[1 - how]
  for (const id of win) stab(g, all[id], t.winStab)
  for (const id of lose) { stab(g, all[id], t.loseStab); yield* crisisCheck(g, all[id], true) }
  for (const id of lose) yield* outcome(g, win[0], id)
}

/** Смена власти в воюющей стране: новая власть просит мира (при объявлении — d12 10–12, иначе d6 4–6). */
export function* coupPeace(g: G, c: Country): Flow {
  const w = g.s.war
  const t = T(g)
  if (!w || w.over !== undefined) return
  const side = sideOf(w, c.id)
  if (side === undefined) return
  const peace = w.declaring ? die(g, 12) >= t.declarePeace : die(g, 6) >= t.coupPeace
  if (!peace) return
  if (w.sides[side][0] === c.id) {
    emit(g, { t: 'мир', text: `${c.name}: новая власть просит мира` })
    count0(g, 'мир после смены власти')
    yield* endWar(g, 'мир')
    return
  }
  // Член коалиции выходит из войны: его солдаты едут домой.
  w.sides[side] = w.sides[side].filter((id) => id !== c.id)
  c.war = false
  emit(g, { t: 'мир', text: `${c.name}: новая власть выходит из войны` })
  for (const p of soldiers(g, w)) if (p.country === c.id && !p.inst!.foreign) offFront(g, p, 'домой (страна вышла из войны)')
}

/** «Итог войны»: d6 победителя на каждую проигравшую страну. */
function* outcome(g: G, wi: number, li: number): Flow {
  const t = T(g)
  const W = g.s.world.countries[wi], L = g.s.world.countries[li]
  const r = die(g, 6)
  let res = t.outcome.find(([hi]) => r <= hi)![1]
  if (res === 'геноцид' && !(t.genocideBy.includes(W.ideology) && groupsOf(L).length > 1)) res = t.genocideElse[W.ideology] ?? 'оккупация'
  if (res === 'грабёж' && t.noPlunder.includes(W.ideology)) res = 'смена режима'
  emit(g, { t: 'мир', text: `итог войны для ${L.name}: d6 = ${r} — ${res}` })
  count0(g, `итог: ${res}`)
  if (res === 'оккупация' || res === 'смена режима') yield* tribunal(g, li)
  if (res === 'оккупация') yield* occupy(g, W, L)
  else if (res === 'смена режима') yield* regime(g, W, L)
  else if (res === 'грабёж') {
    if (RANK[L.pos] > RANK[W.pos]) { const x = L.pos; L.pos = W.pos; W.pos = x } else L.pos = (['периферия', 'периферия', 'полупериферия'] as const)[RANK[L.pos]]
    emit(g, { t: 'мир', text: `грабёж: ${W.name} — ${W.pos}, ${L.name} — ${L.pos}` })
  } else yield* genocide(g, W, L)
}

/** «Кровь на руках»: после оккупации или смены режима — под трибунал, 🎲 Смекалка 15, провал — тюрьма (тяжёлое). */
function* tribunal(g: G, li: number): Flow {
  const t = T(g).tribunal
  for (const p of g.s.players.filter(alive)) {
    if (p.country !== li || !p.flags['Кровь на руках'] || p.inst) continue
    const roll = roll3(g, p.predisp === t.stat ? 1 : 0)
    const ok = roll.sum + p.stats[t.stat] >= t.dc
    emit(g, { t: 'проверка', p: p.seat, stat: t.stat, dice: roll.dice, kept: roll.sum, value: p.stats[t.stat], mod: 0, trump: 0, dc: t.dc, ok, adv: p.predisp === t.stat ? 1 : 0, what: 'трибунал: «Кровь на руках»' })
    count(p, 'трибунал')
    if (!ok) { const pr = g.c.tables.inst.prison; enterInst(g, p, 'тюрьма', rollDie(g, p, pr.heavyDie, 'срок') + pr.heavyAdd, '#война') }
  }
  yield* []
}

function* occupy(g: G, W: Country, L: Country): Flow {
  const o = T(g).occupation
  stab(g, L, o.loser)
  stab(g, W, o.winner)
  L.occupied = g.s.worldTurns + 1
  const ctx = newCtx('правило', { tags: ['#война'] })
  for (const p of g.s.players.filter((x) => alive(x) && x.country === L.id)) {
    addParam(g, p, 'возм', o.tribute, ctx)
    const a = yield* ask(g, p, 'фронт', `Оккупация ${L.name}: контрибуция ${o.tribute} возм. Как жить при оккупантах?`, [
      { id: 'сотрудничать', label: 'сотрудничать', note: `+${o.collab} возм., отметка «Коллаборант»; когда оккупация кончится — d6 1–${o.shameUpTo} «Дурная слава»` },
      { id: 'сопротивляться', label: 'сопротивляться', note: `${o.resist} физ., d6 1 — тюрьма (тяжёлое); когда кончится — Положение семьи +1` },
    ], { force: true })
    p.rules['оккупация'] = { arg: a }
    if (a === 'сотрудничать') { addParam(g, p, 'возм', o.collab, ctx); p.flags['Коллаборант'] = true } else {
      addParam(g, p, 'физ', o.resist, ctx)
      if (p.alive && !p.inst && rollDie(g, p, 6, 'сопротивление: тюрьма на 1') <= o.resistPrisonUpTo) {
        const pr = g.c.tables.inst.prison
        enterInst(g, p, 'тюрьма', rollDie(g, p, pr.heavyDie, 'срок') + pr.heavyAdd, '#война')
      }
    }
  }
}

/** Смена режима: идеология и доминирующий класс победителя; отчуждён — бывший доминирующий. Это смена власти: «Смута». */
function* regime(g: G, W: Country, L: Country): Flow {
  const oldDom = L.dominant
  L.ideology = W.ideology
  L.dominant = W.dominant
  if (oldDom !== L.dominant) L.alienated = oldDom
  else { let a = classesFor(g, L.ideology).alienated; while (a === L.dominant) a = classesFor(g, L.ideology).alienated; L.alienated = a }
  L.stability = Math.min(T(g).regimeStab, g.c.tables.world.stabilityCap[L.ideology] ?? 10)
  L.powerChanges += 1
  delete L.embargo
  emit(g, { t: 'мир', text: `${L.name}: смена режима — ${L.ideology}; правит ${L.dominant}, отчуждён ${L.alienated}` })
  // Победители «Смуты» — принявшие новую власть.
  const sides = new Map<number, 'за' | 'против' | 'в стороне'>()
  for (const p of g.s.players.filter((x) => alive(x) && x.country === L.id && !x.inst)) {
    const a = yield* ask(g, p, 'кризис', `${L.name}: победитель ставит свою власть (${L.ideology}). Твоя сторона?`, [
      { id: 'за', label: 'принять новую власть' }, { id: 'против', label: 'сопротивляться' }, { id: 'в стороне', label: 'остаться в стороне' },
    ], { force: true })
    sides.set(p.seat, a as 'за' | 'против' | 'в стороне')
  }
  yield* turmoil(g, L, oldDom, sides)
}

// ── Геноцид ─────────────────────────────────────────────────────────────

type Group = { race?: string; culture?: string; main?: true }
/** Группы страны: сначала меньшинства (расы, потом культуры), последней — основная. */
const groupsOf = (c: Country): Group[] => [...c.minorityRaces.map((race) => ({ race })), ...c.minorityCultures.map((culture) => ({ culture })), { main: true as const }]
const inGroup = (g: G, p: Player, gr: Group) => (gr.main ? !isMinority(g, p) : gr.race ? p.race === gr.race : culturesOf(p).includes(gr.culture as Player['culture']))

function* genocide(g: G, W: Country, L: Country): Flow {
  const t = T(g).genocide
  const all = g.s.world.countries
  const groups = groupsOf(L)
  const gr = groups[rnd(g, groups.length)]
  const label = gr.main ? `основная группа (${[...L.mainRaces, ...L.mainCultures].join(', ')})` : (gr.race ?? gr.culture)!
  emit(g, { t: 'мир', text: `геноцид: ${W.name} — ${L.name}, ${label}` })
  // Куда уходит группа: страна, которая не воюет и не национализм.
  const safe = all.filter((c) => c.id !== L.id && c.ideology !== 'Национализм' && !c.war)
  const dest = safe.length ? pick(g, safe) : undefined
  for (const p of g.s.players.filter((x) => alive(x) && x.country === L.id && inGroup(g, x, gr))) {
    const ctx = newCtx('правило', { tags: ['#война'] })
    addParam(g, p, 'физ', t.phys, ctx)
    addParam(g, p, 'возм', t.vozm, ctx)
    const roll = roll3(g, p.predisp === t.stat ? 1 : 0)
    const ok = roll.sum + p.stats[t.stat] >= t.dc
    emit(g, { t: 'проверка', p: p.seat, stat: t.stat, dice: roll.dice, kept: roll.sum, value: p.stats[t.stat], mod: 0, trump: 0, dc: t.dc, ok, adv: p.predisp === t.stat ? 1 : 0, what: 'дорога беженцев' })
    if (!ok) addParam(g, p, 'физ', t.extra, ctx)
    if (!p.alive) continue
    if (p.inst?.kind === 'фронт') offFront(g, p, 'домой (геноцид)')
    if (p.inst) continue
    count(p, 'беженец')
    const to = dest ?? pick(g, all.filter((c) => c.id !== L.id))
    yield* arrive(g, p, to.id, !!dest, 'бегство')
  }
  // Страна-жертва теряет группу; удар по основной — позиция на шаг вниз, основной становится первое меньшинство.
  if (gr.main) {
    L.pos = (['периферия', 'периферия', 'полупериферия'] as const)[RANK[L.pos]]
    if (L.minorityRaces.length) { L.mainRaces = [L.minorityRaces.shift()!] } else if (L.minorityCultures.length) { L.mainCultures = [L.minorityCultures.shift()!] }
  } else if (gr.race) L.minorityRaces = L.minorityRaces.filter((x) => x !== gr.race)
  else L.minorityCultures = L.minorityCultures.filter((x) => x !== gr.culture)
  L.emptied = g.s.worldTurns + t.incomeTurns
  // Группа становится меньшинством там, куда пришла; мест нет — самое старое меньшинство ассимилируется.
  if (dest && !gr.main) {
    if (gr.race && !dest.mainRaces.includes(gr.race as Country['mainRaces'][number])) dest.minorityRaces.push(gr.race as Country['mainRaces'][number])
    if (gr.culture && !dest.mainCultures.includes(gr.culture as Country['mainCultures'][number])) dest.minorityCultures.push(gr.culture as Country['mainCultures'][number])
    while (dest.minorityRaces.length + dest.minorityCultures.length > t.maxMinorities) {
      if (dest.minorityRaces.length) dest.minorityRaces.shift(); else dest.minorityCultures.shift()
    }
  }
  // Исполнитель: имущество жертв делят Полиция, Мафия и Олигархи; эмбарго, пока не сменится власть.
  for (const p of g.s.players.filter((x) => alive(x) && x.country === W.id && t.lootCls.includes(x.cls))) addParam(g, p, 'возм', t.loot, newCtx('правило'))
  W.embargo = true
  const prof = g.s.world.cultures[W.mainCultures[0]]
  const lean = (pole: string) => { const i = CULTURE_AXES.findIndex((ax) => (ax as readonly string[]).includes(pole)); return prof[i] * (CULTURE_AXES[i][0] === pole ? -1 : 1) > 0 }
  if (lean('Открытость') || lean('Гуманизм')) stab(g, W, -2)
  count0(g, 'геноцид')
}

// ── Мировой ход ─────────────────────────────────────────────────────────

/** Начало мирового хода: военный налог, конец оккупации, эмбарго, «Священная война» снова доступна. */
export function* warWorldStart(g: G): Flow {
  const t = T(g)
  const all = g.s.world.countries
  const w = g.s.war
  if (w) {
    w.holy = [true, true]
    for (const id of members(w)) stab(g, all[id], t.tax.stab)
    for (const p of g.s.players.filter(alive)) {
      if (sideOf(w, p.country) === undefined) continue
      count(p, 'жизнь в воюющей стране')
      if (p.seg >= t.tax.from && p.inst?.kind !== 'фронт') addParam(g, p, 'возм', p.cls === 'Мафия' ? t.tax.mafia : t.tax.vozm, newCtx('правило'))
    }
  }
  for (const c of all) {
    if (c.occupied !== undefined && g.s.worldTurns > c.occupied) {
      delete c.occupied
      emit(g, { t: 'мир', text: `${c.name}: оккупация кончилась` })
      for (const p of g.s.players.filter((x) => alive(x) && x.country === c.id && x.rules['оккупация'])) {
        const side = p.rules['оккупация'].arg
        delete p.rules['оккупация']
        if (side === 'сотрудничать' && rollDie(g, p, 6, 'коллаборант: «Дурная слава» на 1–2') <= t.occupation.shameUpTo) yield* gainItem(g, p, 'Дурная слава')
        if (side === 'сопротивляться') addParam(g, p, 'Положение', 1, newCtx('правило'))
      }
    }
    if (c.embargo) {
      for (const p of g.s.players.filter((x) => alive(x) && x.country === c.id && x.seg >= 2)) {
        addParam(g, p, 'возм', p.cls === 'Мафия' ? t.genocide.embargo.mafia : t.genocide.embargo.vozm, newCtx('правило'))
        p.rules['мир: ловушка «Контрабанда» даёт +8'] = {}
      }
    }
  }
}

/** Конец мирового хода: пока война идёт (и не объявлена только что), призыв, добровольцы и право бегства. */
export function* warWorldEnd(g: G): Flow {
  const w = g.s.war
  if (!w || w.declaring || w.startWorldTurn === g.s.worldTurns) return
  for (const p of g.s.players.filter(alive)) {
    if (g.s.war !== w) return
    if (sideOf(w, p.country) !== undefined) yield* draftCheck(g, p)
    if (!p.inst) yield* volunteerAsk(g, p)
    if (alive(p) && !p.inst && sideOf(w, p.country) !== undefined) yield* flight(g, p)
  }
  if (g.s.war === w && !soldiers(g, w).length) yield* instant(g, w)
}
