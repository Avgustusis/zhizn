/**
 * Мировой ход (концепция, «Стабильность, революции и перевороты», «Мировые события»; колоды «Мир» и «Смута»).
 * Порядок: часы → проверка кризиса в каждой стране → карта «Мир». Война на «Фронте» — этап 3в: пока война длится
 * до следующего мирового хода (как в старой симуляции).
 */
import type { Card, Node } from '../data/schema.ts'
import { CULTURE_AXES } from '../data/schema.ts'
import { ask, clamp, die, emit, pick, rnd, roll3, say, shuffle, todo, type Flow, type G } from './core.ts'
import { cond, has, newCtx, relation, type Ctx } from './cond.ts'
import { addParam, count, enterInst, fire, gainItem, removeHeld, rollDie, runDue, setClass, visit } from './change.ts'
import { run } from './exec.ts'
import { settle } from './meaning.ts'
import { againstCulture, classesFor } from './setup.ts'
import { emigrate } from './emigration.ts'
import type { Cls, Country, Player, Relation } from './types.ts'

const alive = (p: Player | undefined): p is Player => !!p && p.alive && !p.finished
const inCountry = (g: G, id: number) => g.s.players.filter((p) => alive(p) && p.country === id)
const relKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
const STEPS: Relation[] = ['вражда', 'нейтралитет', 'союз']

/** Идеология против основной культуры страны: её полюс противоположен положению культуры. */
export function ideologyAgainstCulture(g: G, c: Country): boolean {
  return againstCulture(g, c.ideology, c.mainCultures[0])
}

/** Стабильность ±n в пределах 0…10. */
export function stab(g: G, c: Country, n: number): void {
  const w = g.c.tables.world.stability
  c.stability = clamp(c.stability + n, w.min, g.c.tables.world.stabilityCap[c.ideology] ?? w.max)
}

/** Сдвинуть отношения пары на шаг: −1 хуже, +1 лучше. */
export function shiftRelation(g: G, a: number, b: number, d: number): void {
  const k = relKey(a, b)
  const i = STEPS.indexOf(g.s.world.relations[k])
  g.s.world.relations[k] = STEPS[clamp(i + d, 0, 2)]
}

// ── Предчувствие ────────────────────────────────────────────────────────

/** За круг до мирового хода игрок с Мудростью 7+ видит верхнюю карту «Мира», с 10+ — ещё и стабильность своей страны. */
export function foresight(g: G): void {
  const t = g.c.tables.foresight
  const top = nextWorldCard(g, false)
  for (const p of g.s.players.filter(alive)) {
    if (p.stats['Мудрость'] < t.card) continue
    const c = g.s.world.countries[p.country]
    say(g, p, `предчувствие: «${top?.title ?? 'тишина'}»${p.stats['Мудрость'] >= t.stability ? `; стабильность страны ${c.stability}` : ''}`)
  }
}

// ── Мировой ход ─────────────────────────────────────────────────────────

export function* worldTurn(g: G): Flow {
  g.s.worldTurns += 1
  emit(g, { t: 'мир', text: `мировой ход ${g.s.worldTurns}` })
  // Всё «до следующего мирового хода» гаснет; война без «Фронта» длится один мировой ход.
  for (const c of g.s.world.countries) { c.war = false; delete c.suppressed }
  for (const p of g.s.players.filter(alive)) {
    for (const k of Object.keys(p.rules)) if (k.startsWith('мир: ')) delete p.rules[k]
    p.mods = p.mods.filter((m) => m.until !== 'мировой ход')
    fire(g, p, 'следующий мировой ход')
    yield* runDue(g, p)
  }
  for (const c of g.s.world.countries) yield* crisisCheck(g, c, false)
  yield* worldCard(g)
  for (const p of g.s.players.filter(alive)) settle(g, p)
}

/** Проверка кризиса: 3d6 ≥ 8 + стабильность. Без кризиса стабильность +1, минус дестабилизирующие факторы. */
export function* crisisCheck(g: G, c: Country, now: boolean): Flow {
  const t = g.c.tables.crisis
  const r = roll3(g).sum
  if (r < t.base + c.stability) {
    if (!now) stab(g, c, t.calm - (ideologyAgainstCulture(g, c) ? 1 : 0) - (c.alienated === 'Народ' ? 1 : 0))
    return
  }
  emit(g, { t: 'мир', text: `${c.name}: кризис — выступает класс ${c.alienated} (стабильность ${c.stability})` })
  yield* crisis(g, c)
}

type Side = 'за' | 'против' | 'в стороне'

/** Кризис: каждый игрок страны объявляет сторону; исход 3d6 + влияние ≥ 11 — власть меняется. */
function* crisis(g: G, c: Country): Flow {
  const t = g.c.tables.crisis
  const sides = new Map<number, Side>()
  let influence = 0
  for (const p of inCountry(g, c.id)) {
    const forced = p.rules['смута']?.arg ?? ''
    let side: Side
    if (/на стороне/.test(forced)) side = 'за'
    else {
      side = (yield* ask(g, p, 'кризис', `${c.name}: выступает класс ${c.alienated} против власти (${c.dominant}, ${c.ideology}). Твоя сторона?`, [
        { id: 'за', label: 'поддержать выступление' }, { id: 'против', label: 'защищать власть' }, { id: 'в стороне', label: 'остаться в стороне' },
      ], { force: true })) as Side
    }
    sides.set(p.seat, side)
    if (side === 'в стороне') continue
    // Влияние: положение +2 — 1, +3 или Династия — 2; вложить 5 возм. — ещё 1; «влияние ±1» с карты.
    let w = p.pos >= 3 || g.meanings.get(p.meaning?.id ?? '')?.deck === 'Династии' ? t.influence.pos3 : p.pos >= 2 ? t.influence.pos2 : 0
    if (/влияние/.test(forced)) w += 1
    if (p.vozm >= t.influence.invest) {
      const a = yield* ask(g, p, 'кризис', `Вложить ${t.influence.invest} возм. в исход (влияние ещё ${t.influence.investAdd})?`, [{ id: 'да', label: `вложить ${t.influence.invest} возм.` }, { id: 'нет', label: 'нет' }], { force: true })
      if (a === 'да') { addParam(g, p, 'возм', -t.influence.invest, newCtx('правило')); w += t.influence.investAdd }
    }
    influence += side === 'за' ? w : -w
    delete p.rules['смута']
  }
  const roll = roll3(g).sum
  const changed = roll + influence >= t.change
  emit(g, { t: 'мир', text: `${c.name}: исход 3d6 = ${roll}${influence ? `, влияние ${influence > 0 ? '+' : ''}${influence}` : ''} — ${changed ? 'власть меняется' : 'кризис подавлен'}` })
  if (!changed) {
    stab(g, c, t.suppressed)
    c.suppressed = true
    // Поддержавшим выступление: −2 возм. и «Учёт»; при диктатурах и национализме — ещё тюрьма d3.
    for (const p of inCountry(g, c.id)) {
      if (sides.get(p.seat) !== 'за') continue
      addParam(g, p, 'возм', t.rebelCost, newCtx('правило'))
      yield* gainItem(g, p, t.rebelStigma)
      if (t.harsh.includes(c.ideology) && !p.inst) enterInst(g, p, 'тюрьма', rollDie(g, p, g.c.tables.inst.prison.light, 'срок'), '#политика')
    }
    return
  }
  yield* powerChange(g, c, sides)
}

/** Смена власти: новая идеология по отчуждённому классу; классы — по таблице «Идеологии и классы»; «Смута» каждому игроку страны. */
export function* powerChange(g: G, c: Country, sides = new Map<number, Side>()): Flow {
  const t = g.c.tables.crisis
  const oldDom = c.dominant
  const oldAli = c.alienated
  const options = [...t.coup[oldAli]]
  const theism = g.s.world.cultures[c.mainCultures[0]][CULTURE_AXES.findIndex(([a]) => a === 'Теизм')]
  if (oldAli === 'Народ' && theism === -2) options.push('Теократия')
  c.ideology = pick(g, options)
  c.dominant = t.close[c.ideology].includes(oldAli) ? oldAli : classesFor(g, c.ideology).dominant
  if (die(g, 6) <= t.oldDominantUpTo && oldDom !== c.dominant) c.alienated = oldDom
  else { let a = classesFor(g, c.ideology).alienated; while (a === c.dominant) a = classesFor(g, c.ideology).alienated; c.alienated = a }
  c.stability = Math.min(t.after, g.c.tables.world.stabilityCap[c.ideology] ?? t.after)
  c.powerChanges += 1
  emit(g, { t: 'мир', text: `${c.name}: смена власти — ${c.ideology}; правит ${c.dominant}, отчуждён ${c.alienated}` })
  // Отношения с каждой страной: d6 1 — хуже, 6 — лучше.
  for (const o of g.s.world.countries) {
    if (o.id === c.id) continue
    const r = die(g, 6)
    if (r <= t.relWorse) shiftRelation(g, c.id, o.id, -1)
    if (r >= t.relBetter) shiftRelation(g, c.id, o.id, 1)
  }
  yield* turmoil(g, c, oldDom, sides)
}

// ── Смута ───────────────────────────────────────────────────────────────

interface Turmoil { prison: 'общее' | 'тяжёлое' | 'нет' | 'для всех'; denounced: boolean; stability?: number }

/** «Смута»: одна карта на страну; каждый игрок читает «Для всех» и строку своей стороны; общие правила поверх карты. */
function* turmoil(g: G, c: Country, oldDom: Cls, sides: Map<number, Side>): Flow {
  const t = g.c.tables.crisis
  const card = drawPile(g, 'смута')
  if (!card) return
  const state: Turmoil = { prison: 'общее', denounced: false }
  const players = inCountry(g, c.id)
  // Победители первыми (донос на нейтрала), затем проигравшие, затем нейтралы.
  const order = (s: Side) => (s === 'за' ? 0 : s === 'против' ? 1 : 2)
  players.sort((a, b) => order(sides.get(a.seat) ?? 'в стороне') - order(sides.get(b.seat) ?? 'в стороне'))
  for (const p of players) {
    const side0 = sides.get(p.seat) ?? 'в стороне'
    let side: NonNullable<Ctx['side']> = side0 === 'за' ? 'победители' : side0 === 'против' ? 'проигравшие' : 'нейтралы'
    const before = { cls: p.cls, oath: has(g, p, 'Присяга'), badge: has(g, p, 'Значок') }
    emit(g, { t: 'карта', p: p.seat, id: card.id, title: card.title, deck: 'смута' })
    visit(p, 'смена власти')
    count(p, 'смена власти')
    const ctx = newCtx('карта', {
      card: card.id, deck: 'смута', tags: card.tags, target: c.id, side, formerDominant: p.cls === oldDom,
      ...(p.citizenship.includes(c.id) ? {} : { dis: true }), ...(state.denounced && side === 'нейтралы' ? { penalty: -3 } : {}),
    })
    turmoilCtx.set(p.seat, { state, ctx })
    yield* run(g, p, card.effect, ctx)
    if (!p.alive) continue
    yield* run(g, p, card.sides![sideKey(ctx.side!)], ctx)
    side = ctx.side!
    turmoilCtx.delete(p.seat)
    if (!p.alive) continue
    // 1) Победители могут перейти в новый доминирующий класс; в Олигархи — только «Везение», 🎲 Смекалка 18.
    if (side === 'победители' && p.cls !== c.dominant && !p.inst) {
      const a = yield* ask(g, p, 'класс', `Перейти в новый доминирующий класс — ${c.dominant}?${c.dominant === 'Олигархи' ? ` Только через «Везение»: 🎲 Смекалка ${t.oligarchDc}.` : ''}`, [{ id: 'да', label: `перейти: ${c.dominant}` }, { id: 'нет', label: `остаться: ${p.cls}` }], { force: true })
      if (a === 'да') {
        if (c.dominant !== 'Олигархи') setClass(g, p, c.dominant)
        else { const r = roll3(g).sum; if (r + p.stats['Смекалка'] >= t.oligarchDc) setClass(g, p, 'Олигархи'); else say(g, p, '«Везение» не случилось') }
      }
    }
    // 2) Новая власть сурова: проигравшие — в тюрьму на d3; при военной диктатуре нейтралы — 🎲 Смекалка 12.
    const harsh = t.harsh.includes(c.ideology) || state.prison === 'для всех'
    if (harsh && state.prison !== 'нет' && !p.inst) {
      let jail = side === 'проигравшие'
      if (!jail && side === 'нейтралы' && c.ideology === 'Военная диктатура') {
        const r = roll3(g).sum
        jail = r + p.stats['Смекалка'] + (ctx.penalty ?? 0) < t.neutralDc
        if (jail) { say(g, p, '«кто не с нами, тот против нас»'); yield* run(g, p, card.sides!.lose, { ...ctx, side: 'проигравшие' }) }
      }
      if (jail) {
        const t2 = g.c.tables.inst.prison
        const turns = state.prison === 'тяжёлое' ? rollDie(g, p, t2.heavyDie, 'срок') + t2.heavyAdd : rollDie(g, p, t2.light, 'срок')
        enterInst(g, p, 'тюрьма', turns, '#политика')
      }
    }
    // Журнал.
    if (side !== 'нейтралы') count(p, 'сторона в Смуте')
    if (side === 'победители') count(p, 'победа в Смуте')
    if (side === 'проигравшие') count(p, 'поражение в Смуте')
    if (p.cls === before.cls) count(p, 'смена власти без потери класса')
    if (p.vozm >= 5) count(p, 'смена власти при возм. +5 и выше')
    if (before.oath && has(g, p, 'Присяга')) count(p, 'смена власти с Присягой')
    if (before.badge && has(g, p, 'Значок')) count(p, 'смена власти со Значком')
    settle(g, p)
  }
  if (state.stability !== undefined) c.stability = state.stability
  // Смена власти даёт право бегства.
  for (const p of inCountry(g, c.id)) if (!p.inst && p.seg >= 2) yield* flight(g, p)
}

const sideKey = (s: NonNullable<Ctx['side']>) => (s === 'победители' ? 'win' : s === 'проигравшие' ? 'lose' : 'neutral')
/** Текущая «Смута» игрока: правила карты меняют общее правило о тюрьме и сторону. */
const turmoilCtx = new Map<number, { state: Turmoil; ctx: Ctx }>()

/** Правила карт «Смуты». */
export function* turmoilRule(g: G, p: Player, rule: string, arg = ''): Flow {
  const cur = turmoilCtx.get(p.seat)
  if (!cur) return void todo(g, p, rule)
  const { state, ctx } = cur
  if (rule === 'правило тюрьмы') {
    if (/не действует/.test(arg)) state.prison = 'нет'
    else if (/тяжёл/.test(arg)) state.prison = 'тяжёлое'
    else if (/любой идеологии/.test(arg)) state.prison = 'для всех'
    else if (/вместо общего/.test(arg)) state.prison = 'нет'
  } else if (rule === 'стать нейтралом') { ctx.side = 'нейтралы'; state.prison = state.prison === 'тяжёлое' ? 'тяжёлое' : state.prison }
  else if (rule === 'стать проигравшим') { ctx.side = 'проигравшие'; yield* run(g, p, (cardOf(g, ctx.card)?.sides?.lose) ?? [], ctx) }
  else if (rule === 'донос на нейтрала') state.denounced = true
  else if (rule === 'выбрать сторону') {
    const a = yield* ask(g, p, 'кризис', 'Выбери сторону сейчас и читай её строку', [{ id: 'победители', label: 'с победителями' }, { id: 'проигравшие', label: 'с проигравшими' }], { force: true })
    ctx.side = a as 'победители' | 'проигравшие'
  } else if (rule === 'люстрация') {
    const list = p.items.filter((h) => ['Значок', 'Присяга', 'Офицерское звание', 'Партбилет'].includes(h.name))
    if (/сохраняешь/.test(arg) && list.length > 1) {
      const keep = yield* ask(g, p, 'предмет', 'Люстрация: какой статус сохранить?', list.map((h) => ({ id: String(h.uid), label: h.name })))
      for (const h of list) if (String(h.uid) !== keep) removeHeld(g, p, h)
    } else if (/один статус из списка/.test(arg) && list.length) removeHeld(g, p, list[rnd(g, list.length)])
    else if (/все/.test(arg)) for (const h of list) removeHeld(g, p, h)
    if ((p.cls === 'Армия' && !has(g, p, 'Присяга') && !has(g, p, 'Офицерское звание')) || (p.cls === 'Полиция' && !has(g, p, 'Значок'))) setClass(g, p, 'Народ')
  }
}
const cardOf = (g: G, id?: string) => (id ? g.cards.get(id)?.card : undefined)

// ── Карта «Мир» ─────────────────────────────────────────────────────────

/** Верхняя подходящая карта стопки; сыгранная — в сброс, колода кончилась — перетасуй сброс. */
function drawPile(g: G, deck: string): Card | undefined {
  const pile = (g.s.piles[deck] ??= [])
  const used = (g.s.piles[`${deck}:сброс`] ??= [])
  for (let i = 0; i < 100; i++) {
    if (!pile.length) { pile.push(...shuffle(g, used.splice(0))); if (!pile.length) return undefined }
    const id = pile.shift()!
    used.push(id)
    const card = g.cards.get(id)!.card
    if (!card.requires || g.s.config.mode === 'род' || !JSON.stringify(card.requires).includes('"род"')) return card
  }
  return undefined
}
/** Верхняя карта «Мира» без вытягивания (для предчувствия). */
function nextWorldCard(g: G, _draw: boolean): Card | undefined {
  const pile = g.s.piles['мир'] ?? []
  const id = pile.find((x) => { const c = g.cards.get(x)!.card; return !JSON.stringify(c.requires ?? '').includes('"род"') || g.s.config.mode === 'род' })
  return id ? g.cards.get(id)!.card : undefined
}

/** Выбрать целевую страну карты «Мир». undefined — подходящей нет: карта как «Спокойные годы». */
function targetOf(g: G, card: Card): number[] | undefined {
  const all = g.s.world.countries
  const t = card.target
  if (!t || t === 'нет') return []
  if (t === 'все') return all.map((c) => c.id)
  if (t === 'случайная') return [pick(g, all).id]
  if (t === 'случайная не из ядра') return [pick(g, all.filter((c) => c.pos !== 'ядро')).id]
  if (t === 'случайная с врагом') {
    const list = all.filter((c) => all.some((o) => o.id !== c.id && relation(g, c.id, o.id) === 'вражда'))
    return list.length ? [pick(g, list).id] : undefined
  }
  if (t === 'периферия с наименьшей стабильностью') {
    const list = all.filter((c) => c.pos === 'периферия')
    const min = Math.min(...list.map((c) => c.stability))
    return [pick(g, list.filter((c) => c.stability === min)).id]
  }
  if (t === 'самая этноцентричная') {
    const ethno = (c: Country) => g.s.world.cultures[c.mainCultures[0]][CULTURE_AXES.findIndex(([a]) => a === 'Этноцентризм')]
    const list = all.filter((c) => c.stability <= 5 && ethno(c) < 0)
    if (!list.length) return undefined
    const min = Math.min(...list.map(ethno))
    return [pick(g, list.filter((c) => ethno(c) === min)).id]
  }
  if (t === 'по культуре') {
    const want = g.c.tables.worldCulture[card.id] ?? []
    const list = all.filter((c) => want.includes(c.mainCultures[0]))
    return list.length ? list.map((c) => c.id) : undefined
  }
  return []
}

/** Карта «Мир»: часть страны (на каждой цели) и часть игроков (каждому; inTarget — живёт ли в цели). */
function* worldCard(g: G): Flow {
  const card = drawPile(g, 'мир')
  if (!card) return
  emit(g, { t: 'мир', text: `«Мир»: ${card.title}` })
  const targets = targetOf(g, card)
  if (targets === undefined) { emit(g, { t: 'мир', text: 'подходящей страны нет — как «Спокойные годы»' }); return }
  const holder = g.s.players.find(alive)
  const pair: number[] = []
  // Часть страны: условия читаются на самой стране.
  for (const id of targets.length ? targets : [-1]) {
    if (!card.country) break
    const proxy = holder ? ({ ...holder, country: id >= 0 ? id : holder.country } as Player) : undefined
    if (!proxy) break
    yield* runCountry(g, proxy, card.country, newCtx('карта', { card: card.id, deck: 'мир', tags: card.tags, ...(id >= 0 ? { target: id } : {}) }), pair)
  }
  const tgt = pair.length ? pair : targets
  for (const p of g.s.players.filter(alive)) {
    emit(g, { t: 'карта', p: p.seat, id: card.id, title: card.title, deck: 'мир' })
    const ctx = newCtx('карта', { card: card.id, deck: 'мир', tags: card.tags, ...(tgt.length === 1 ? { target: tgt[0] } : { targets: tgt }) })
    yield* run(g, p, card.effect, ctx)
    if (card.scope === 'глобальный' && p.alive) count(p, 'глобальное событие в своей стране')
    settle(g, p)
  }
}

/** Выполнить часть «Страна»: шаги stab и правила стран идут на целевую страну, а не на игрока. */
function* runCountry(g: G, proxy: Player, nodes: Node[], ctx: Ctx, pair: number[]): Flow {
  for (const n of nodes) {
    if ('stab' in n) { const c = g.s.world.countries[ctx.target ?? proxy.country]; stab(g, c, n.stab) }
    else if ('say' in n) emit(g, { t: 'мир', text: n.say })
    else if ('if' in n) yield* runCountry(g, proxy, cond(g, proxy, n.if, ctx) ? n.then : n.else ?? [], ctx, pair)
    else if ('rule' in n) yield* countryRule(g, n.rule, n.arg, ctx, pair)
  }
}

/** Правила стран: война (пока без «Фронта»), мирный договор, отношения, проверка кризиса. */
function* countryRule(g: G, rule: string, arg: string | undefined, ctx: Ctx, pair: number[]): Flow {
  const all = g.s.world.countries
  const pairsOf = (r: Relation) => all.flatMap((a) => all.filter((b) => b.id > a.id && relation(g, a.id, b.id) === r).map((b) => [a.id, b.id]))
  if (rule === 'проверка кризиса' && ctx.target !== undefined) yield* crisisCheck(g, all[ctx.target], true)
  else if (rule === 'война') {
    // Этап 3б: страны воюют до следующего мирового хода; «Фронт», призыв и итоги — этап 3в.
    const global = /мировая/.test(arg ?? '')
    let hostile = pairsOf('вражда')
    if (!hostile.length) { const n = pairsOf('нейтралитет'); if (n.length) { const [a, b] = pick(g, n); g.s.world.relations[relKey(a, b)] = 'вражда'; hostile = [[a, b]] } }
    if (!hostile.length) return
    const [a, b] = pick(g, hostile)
    const sides = global ? all.filter((c) => c.id === a || c.id === b || relation(g, c.id, a) === 'союз' || relation(g, c.id, b) === 'союз').map((c) => c.id) : [a, b]
    for (const id of sides) { all[id].war = true; stab(g, all[id], global ? -3 : -2) }
    if (global) for (const c of all) if (!c.war) stab(g, c, -1)
    pair.push(...sides)
    emit(g, { t: 'мир', text: `война: ${sides.map((id) => all[id].name).join(', ')}` })
    if (global) for (const id of sides) yield* crisisCheck(g, all[id], true)
  } else if (rule === 'мирный договор') {
    const atWar = all.filter((c) => c.war)
    if (atWar.length) { for (const c of atWar) { c.war = false; stab(g, c, 1) } pair.push(...atWar.map((c) => c.id)); emit(g, { t: 'мир', text: 'мир: война окончена без итога' }); return }
    const hostile = pairsOf('вражда')
    if (hostile.length) { const [a, b] = pick(g, hostile); g.s.world.relations[relKey(a, b)] = 'нейтралитет'; stab(g, all[a], 1); stab(g, all[b], 1); pair.push(a, b); return }
    const neutral = pairsOf('нейтралитет')
    if (neutral.length && die(g, 6) >= 5) { const [a, b] = pick(g, neutral); g.s.world.relations[relKey(a, b)] = 'союз'; pair.push(a, b) }
  } else if (rule === 'отношения') emit(g, { t: 'мир', text: `отношения: ${arg ?? ''}` })
  else if (rule === 'новая земля') emit(g, { t: 'мир', text: 'открываются «Земли за ледником» (режим «Род»)' })
}

// ── Бегство ─────────────────────────────────────────────────────────────

/** Право бегства (война, чистка, голод, смена власти): бежать сейчас — бесплатно, в любую страну, даже враждебную. */
export function* flight(g: G, p: Player): Flow {
  if (!p.alive || p.inst || p.seg < 2) return
  yield* emigrate(g, p, { kind: 'бегство', optional: true })
}

