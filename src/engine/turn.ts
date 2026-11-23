/** Ход игрока: движение по полю, клетки и карты, входы в отрезки, институты, слоты действий, конец хода. */
import type { BoardCell } from '../data/board-schema.ts'
import { SEGMENTS, type Card } from '../data/schema.ts'
import { ask, countryOf, emit, rnd, roll3, say, segName, type Flow, type G } from './core.ts'
import { charLean, cond, has, newCtx, type Ctx } from './cond.ts'
import { addParam, count, death, enterInst, fire, gainItem, itemsPerSeg, leaveInst, rollDie, runDue, visit, removeHeld } from './change.ts'
import { spend, strongIn } from './checks.ts'
import { run } from './exec.ts'
import { markEntry, meaningAtEntry, settle } from './meaning.ts'
import { rollFashion } from './setup.ts'
import { businessAtEntry, money } from './market.ts'
import { whyNot } from './explain.ts'
import { acculturate, decayStigmas, deportRisk, emigrate, naturalize } from './emigration.ts'
import { backToFront, frontTurn, volunteerAsk, volunteerSides } from './war.ts'
import { afterCard, atSegment } from './items.ts'
import { pawn, sellable } from './life.ts'
import { afterCardPoles, disasterMiss, familismCohesion, familismPrice } from './poles.ts'
import { enemyReminds } from './search.ts'
import { anytimePlays, cancelWarCard, peekTop, playMenu, saveFromBondage, travelDiscount } from './tricks.ts'
import type { Action, Player } from './types.ts'

const cellsOf = (g: G, seg: number): BoardCell[] => g.c.board.segments[seg].cells
export const cellOf = (g: G, p: Player): BoardCell => cellsOf(g, p.seg)[p.cell]

// ── Карты ───────────────────────────────────────────────────────────────

/** Подходит ли карта игроку сейчас: отрезок, подсектор, условие карты. */
function fits(g: G, p0: Player, card: Card, deck: string): boolean {
  // В плену карты «Тюрьмы» — по идеологии страны, взявшей в плен.
  const p = p0.inst?.captor !== undefined && deck === 'тюрьма' ? { ...p0, country: p0.inst.captor } : p0
  if (card.segs && !card.segs.includes(segName(p))) return false
  if (card.sub) {
    const codes = g.c.subCodes[deck]
    if (codes && !card.sub.includes(codes[cellOf(g, p).sub])) return false
  }
  return cond(g, p, card.requires, newCtx('карта', { card: card.id, deck, tags: card.tags }))
}

/** Тянуть карту стопки: неподходящая уходит под низ, тянут следующую. */
export function* drawCard(g: G, p: Player, pile: string): Flow {
  const stack = g.s.piles[pile] ?? []
  for (let i = 0; i < stack.length; i++) {
    const id = stack.shift()!
    const { card, deck } = g.cards.get(id)!
    if (fits(g, p, card, deck)) {
      // «Старушка у подъезда»: посмотреть верхнюю карту и, если надо, убрать её под низ.
      if (yield* peekTop(g, p, card.title, card.text || card.src)) { stack.push(id); say(g, p, `«${card.title}» — под низ`); continue }
      const where = yield* playCard(g, p, card, deck)
      if (where === 'замешать') stack.splice(rnd(g, stack.length + 1), 0, id)
      else stack.push(id)
      return
    }
    stack.push(id)
    emit(g, { t: 'пропуск', p: p.seat, id, why: 'не подходит' })
  }
  say(g, p, 'подходящей карты в колоде нет')
}

/** Сыграть карту: отмена козырем → эффект → правила после карты. Возвращает, куда уходит карта. */
export function* playCard(g: G, p: Player, card: Card, deck: string): Flow<'под низ' | 'замешать'> {
  emit(g, { t: 'карта', p: p.seat, id: card.id, title: card.title, deck })
  const polar = g.c.polar.includes(deck)
  const ctx: Ctx = newCtx('карта', { card: card.id, deck, tags: card.tags, polar, ...(polar && strongIn(g, p, card.requires) ? { strong: true } : {}) })
  const trump = p.items.find((h) => card.cancelBy?.includes(h.name))
  if (trump) {
    const a = yield* ask(g, p, 'отмена', `${card.title}. Отменить карту козырем «${trump.name}»?`, [{ id: 'да', label: `сыграть «${trump.name}»` }, { id: 'нет', label: 'оставить' }], { card: card.id, force: true })
    if (a === 'да') { spend(g, p, trump); return 'под низ' }
  }
  // «Катастрофа мимо»: следующая карта «Судьбы» не разыгрывается.
  if (disasterMiss(g, p, deck)) return 'под низ'
  // «Друг в Генштабе»: отменить одну карту #война для себя и семьи.
  if (yield* cancelWarCard(g, p, card.tags, ctx)) { say(g, p, '«Друг в Генштабе»: карта отменена'); return 'под низ' }
  if (card.miracle) p.flags['чудо'] = true
  if (card.tags.includes('#утрата')) visit(p, 'утрата')
  yield* run(g, p, card.effect, ctx)
  if (p.alive) yield* afterCard(g, p, card.tags)
  if (p.alive) for (const [k, v] of afterCardPoles(g, p, card.tags, !!ctx.shared.failed, card.id, ctx.shared.chose)) addParam(g, p, k, v, newCtx('правило'))
  // #закон: проваленная проверка в «жёсткой» стране — на d6 = 1 тюрьма («Тотальные институты»).
  const t = g.c.tables.inst
  const c = countryOf(g, p)
  // «Без документов»: любая карта #закон — риск высылки.
  if (card.tags.includes('#закон')) yield* deportRisk(g, p)
  if (p.alive && !p.inst && p.seg >= 1 && ctx.shared.failed && card.tags.includes('#закон') && (c.pos === 'периферия' || t.harshIdeologies.includes(c.ideology))) {
    if (rollDie(g, p, 6, '#закон: тюрьма') <= (t.lawPrisonWide[c.ideology] ?? t.lawPrisonUpTo)) enterInst(g, p, 'тюрьма', rollDie(g, p, t.prison.light, 'срок'), '#закон')
  }
  settle(g, p)
  yield* runDue(g, p)
  return ctx.shared.dispose === 'замешать' ? 'замешать' : 'под низ'
}

/** Напечатанная развилка: карта лежит не в колоде, а на поле. */
function* playFork(g: G, p: Player, title: string): Flow {
  const card = g.c.decks['развилка']?.find((c) => c.cell && c.title === title)
  if (!card) { say(g, p, `развилка «${title}»`); return }
  if (!cond(g, p, card.requires, newCtx('карта', { card: card.id, tags: card.tags }))) { say(g, p, `развилка «${title}»: проходишь мимо`); return }
  yield* playCard(g, p, card, 'развилка')
}

// ── Отрезки ─────────────────────────────────────────────────────────────

/** «Итог воспитания»: очки по финансам семьи в две характеристики её класса; Красота («Воспитание»). */
function upbringing(g: G, p: Player): void {
  const t = g.c.tables.upbringing
  const ctx = newCtx('правило')
  let pts = t.points[String(p.fin)] + (p.coh >= t.cohesionBonusFrom ? 1 : 0)
  if (p.coh <= t.cohesionHalfUpTo) { pts = Math.floor(pts / 2); addParam(g, p, 'Смекалка', 1, ctx) }
  const [a, b] = t.stats[p.familyCls]
  for (let i = 0; i < pts; i++) addParam(g, p, i % 2 === 0 ? a : b, 1, ctx)
  if (p.seg === 0) { if (p.fin <= t.beautyHungerUpTo) addParam(g, p, 'Красота', -1, ctx) } else addParam(g, p, 'Красота', rollDie(g, p, t.beautyPubertyDie, 'Красота: гормональная лотерея'), ctx)
  say(g, p, 'итог воспитания')
}

/** Всё, что привязано к концу отрезка, гаснет. */
function expire(p: Player): void {
  const left = p.seg - 1
  const afterYoung = left >= SEGMENTS.indexOf('Молодость')
  p.mods = p.mods.filter((m) => !((m.until === 'отрезок' || (m.until === 'проверка' && m.max === 'отрезок')) && (m.seg ?? left) <= left) && !(m.until === 'конец Молодости' && afterYoung))
  p.income = p.income.filter((i) => !(i.until === 'отрезок' && i.seg <= left) && !(i.until === 'конец Молодости' && afterYoung))
  p.laters = p.laters.filter((l) => l.seg === undefined || l.seg > left)
  for (const [k, v] of Object.entries(p.rules)) if (v.seg !== undefined && v.seg <= left) delete p.rules[k]
}

/** Вход в отрезок («Поле и возраст», «Подсекторы отрезков»). */
function* enterSegment(g: G, p: Player): Flow {
  const t = g.c.tables
  const seg = segName(p)
  if (seg === 'Древность') {
    const a = t.segments.ancient
    const c = countryOf(g, p)
    const mod = (c.pos === 'ядро' ? a['ядро'] : c.pos === 'периферия' ? a['периферия'] : 0) + (p.vozm >= a.vozmFrom ? a.vozmAdd : 0)
      + (charLean(p, 'Мера') ? a.pole['Мера']! : 0) + (charLean(p, 'Аппетит') ? a.pole['Аппетит']! : 0)
    const roll = roll3(g)
    const ok = roll.sum + p.phys + mod >= a.dc
    emit(g, { t: 'проверка', p: p.seat, stat: 'Выносливость', dice: roll.dice, kept: roll.sum, value: p.phys, mod, trump: 0, dc: a.dc, ok, adv: 0, what: 'вход в Древность: 3d6 + физ.' })
    if (!ok) { p.seg -= 1; p.cell = cellsOf(g, p.seg).length - 1; return death(g, p, 'возраст') }
    // Сиделка — правило, а не карта: спрашиваем один раз; дальше — переключатель (решено 19.11).
    const tt = t.segments
    const nurse = yield* ask(g, p, 'действие', `Древность: −${tt.ancientWear} физ. каждый ход. Сиделка за ${tt.nurse} возм. за ход отменяет потерю (и ты живёшь не один). Как будешь жить? Переключить можно в любой ход.`, [
      { id: 'постоянно', label: `сиделка постоянно: −${tt.nurse} возм. за ход`, note: 'пока хватает денег' },
      { id: 'сам', label: `справляться самому: −${tt.ancientWear} физ. за ход` },
    ], { force: true })
    if (nurse === 'постоянно') p.rules['сиделка постоянно'] = {}
  }
  emit(g, { t: 'отрезок', p: p.seat, seg })
  expire(p)
  const ctx = newCtx('правило')
  // Жетоны ◆: три на входе в Молодость, неиспользованные сгорают на выходе.
  p.youthTokens = seg === 'Молодость' ? g.c.tables.youthTokens : 0
  // «Присяга» — выбор (23.11): согласие — статус; отказ ничего не стоит, класс остаётся, статуса нет (позже — только событием).
  if (seg === 'Молодость' && p.cls === 'Армия' && p.citizenship.includes(p.country)) {
    const a = yield* ask(g, p, 'предмет', 'Присяга: ты входишь в Молодость в армейской семье. Принимаешь «Присягу»?', [
      { id: 'да', label: 'принять «Присягу»', note: 'ключ Армии: аттестация на «Офицерское звание» в Зрелости' },
      { id: 'нет', label: 'отказаться', note: 'класс Армия остаётся; статус потом — только событием' },
    ], { force: true })
    if (a === 'да') yield* gainItem(g, p, 'Присяга')
    else { say(g, p, 'отказался от «Присяги»'); count(p, 'отказ от Присяги') }
  }
  // «Старый офицер» — ключ к «Офицерскому званию»: аттестация и без пяти лет Стажа.
  if (seg === 'Зрелость' && p.cls === 'Армия' && has(g, p, 'Присяга') && (p.stazh >= 5 || has(g, p, 'Старый офицер')) && !has(g, p, 'Офицерское звание')) {
    const stat = p.stats['Интеллект'] >= p.stats['Харизма'] ? 'Интеллект' as const : 'Харизма' as const
    const roll = roll3(g, p.predisp === stat ? 1 : 0)
    const ok = roll.sum + p.stats[stat] >= 12
    emit(g, { t: 'проверка', p: p.seat, stat, dice: roll.dice, kept: roll.sum, value: p.stats[stat], mod: 0, trump: 0, dc: 12, ok, adv: p.predisp === stat ? 1 : 0, what: 'аттестация' })
    if (ok) yield* gainItem(g, p, 'Офицерское звание')
  }
  if (t.segments.beautyLoss.includes(seg)) addParam(g, p, 'Красота', -1, ctx)
  // Аппетит заедает стресс: с Юности на входе в каждый отрезок −1 физ. и +1 псих.
  if (charLean(p, 'Аппетит')) { addParam(g, p, 'физ', -1, ctx); addParam(g, p, 'псих', 1, ctx) }
  rollFashion(g, countryOf(g, p))
  yield* itemsPerSeg(g, p)
  yield* atSegment(g, p)
  yield* enemyReminds(g, p)
  // Фамилизм: без семьи ты никто — при низкой Сплочённости −1 псих. на входе в отрезок.
  if (familismCohesion(g, p)) { say(g, p, 'Фамилизм: без семьи ты никто'); addParam(g, p, 'псих', familismCohesion(g, p), ctx) }
  yield* businessAtEntry(g, p)
  decayStigmas(g, p)
  if (seg !== 'Детство') { yield* acculturate(g, p); naturalize(g, p) }
  for (const nodes of p.everySeg) yield* run(g, p, nodes, ctx)
  fire(g, p, 'вход в следующий отрезок')
  if (seg === 'Зрелость') fire(g, p, 'вход в Зрелость')
  yield* runDue(g, p)
  if (!p.alive) return
  yield* meaningAtEntry(g, p)
  markEntry(g, p)
  settle(g, p)
}

/** Платежи в рассрочку: по одному на входе в каждый следующий подсектор. */
function* payInstallments(g: G, p: Player): Flow {
  for (const it of [...p.installments]) {
    yield* run(g, p, it.each, newCtx('правило'))
    if (--it.left <= 0) p.installments.splice(p.installments.indexOf(it), 1)
  }
}

// ── Движение ────────────────────────────────────────────────────────────

function finish(g: G, p: Player): void {
  p.finished = true
  emit(g, { t: 'финал', p: p.seat })
  settle(g, p)
}

/**
 * Фишка идёт по клеткам. Напечатанная развилка — шлагбаум: встаёшь, разыгрываешь, проходишь остаток хода.
 * Вход в отрезок и «Итог воспитания» срабатывают на проходе. В институте развилки проходят мимо.
 */
function* move(g: G, p: Player, steps: number): Flow<BoardCell | undefined> {
  for (let i = 0; i < steps; i++) {
    const subBefore = cellOf(g, p).sub
    if (p.cell + 1 >= cellsOf(g, p.seg).length) {
      p.seg += 1; p.cell = 0
      yield* enterSegment(g, p)
      if (!p.alive) return undefined
      yield* payInstallments(g, p)
    } else {
      p.cell += 1
      if (cellOf(g, p).sub !== subBefore) {
        yield* payInstallments(g, p)
        // Студент — первые 15 клеток Молодости; дальше учёба кончается.
        if (p.rules['студент'] && segName(p) === 'Молодость') { delete p.rules['студент']; say(g, p, 'учёба окончена'); fire(g, p, 'конец учёбы'); yield* runDue(g, p) }
      }
    }
    const cell = cellOf(g, p)
    if (cell.type === 'итог воспитания') upbringing(g, p)
    if (cell.type === 'финал') { finish(g, p); return undefined }
    if (cell.type === 'развилка' && cell.fork && !p.inst) {
      emit(g, { t: 'клетка', p: p.seat, seg: segName(p), ...(cell.n ? { n: cell.n } : {}), type: `развилка: ${cell.fork}` })
      yield* playFork(g, p, cell.fork)
      if (!p.alive || p.inst) return undefined
    }
    if (!p.alive) return undefined
  }
  return cellOf(g, p)
}

/** Клетка, на которой остановилась фишка. */
function* resolveCell(g: G, p: Player, cell: BoardCell): Flow {
  const t = g.c.tables
  emit(g, { t: 'клетка', p: p.seat, seg: segName(p), ...(cell.n ? { n: cell.n } : {}), type: cell.type })
  if (cell.type === 'возраст') yield* drawCard(g, p, t.ageDeck[segName(p)])
  else if (cell.type === 'класс') yield* drawCard(g, p, `класс.${p.cls}`)
  else if (cell.type === 'развилка') { if (!cell.fork) yield* drawCard(g, p, 'развилка') } else if (t.cellDeck[cell.type]) yield* drawCard(g, p, t.cellDeck[cell.type])
}

// ── Институты ───────────────────────────────────────────────────────────

/** Ход в институте: вместо клетки — карта института; срок идёт («Тотальные институты»). */
function* instTurn(g: G, p: Player): Flow {
  const inst = p.inst!
  const t = g.c.tables.inst
  inst.turn += 1
  if (inst.kind === 'кабала') {
    // Отработка: +2 возм. и по очереди −1 физ. и −1 псих.; здоровье здесь не падает ниже −9.
    const ctx = newCtx('правило')
    addParam(g, p, 'возм', (inst.workoff ?? t.bondage.perTurn) + (has(g, p, 'Швейная машинка') ? 1 : 0), ctx)
    addParam(g, p, inst.turn % 2 ? 'физ' : 'псих', -1, ctx)
  }
  yield* drawCard(g, p, inst.kind)
  if (!p.alive || !p.inst) return
  if (inst.kind === 'кабала') { if (p.vozm >= g.c.tables.caps.bondageOut) yield* leaveInst(g, p) } else {
    inst.left -= 1
    if (inst.left <= 0 || (inst.kind === 'психбольница' && p.psy >= t.asylum.outPsy)) yield* leaveInst(g, p)
  }
}

// ── Слоты действий ──────────────────────────────────────────────────────

/** Цена действия: первая подходящая строка; нет строк — даром. */
export function priceOf(g: G, p: Player, a: Action): number {
  const n = a.price?.find((x) => cond(g, p, x.if))?.n ?? 0
  // Фамилизм — психолог дороже, Институции — дешевле (платное остаётся платным).
  return n > 0 ? Math.max(1, n + familismPrice(g, p, a.place)) : n
}

/** Подсказка о доступе по характеру: шанс пройти проверку или «закрыто». */
export function gateOf(g: G, p: Player, a: Action): { closed?: string; need?: number; rolls?: number; poles?: string } {
  if (!a.gate) return {}
  const t = g.c.tables.gate
  const against = (pole: string) => `Это против твоих убеждений (${pole} сильно)`
  if (Array.isArray(a.gate)) {
    // Несколько черт («Контора»): любая на ±2 — закрыто; каждая на ±1 — своя проверка d6 4–6.
    const hit = a.gate.filter((x) => charLean(p, x.pole) > 0)
    const strong = hit.find((x) => charLean(p, x.pole) >= 2)
    if (strong) return { closed: against(strong.pole) }
    return hit.length ? { need: t.lux, rolls: hit.length, poles: hit.map((x) => x.pole).join(', ') } : {}
  }
  const lean = charLean(p, a.gate.pole)
  if (!lean) return {}
  if (a.gate.need) return { need: t.need[lean], poles: a.gate.pole }
  if (lean >= 2) return a.gate.strongRoll ? { need: a.gate.strongRoll, poles: a.gate.pole } : { closed: against(a.gate.pole) }
  return { need: t.lux, poles: a.gate.pole }
}

/** Подпись проверки характера у кнопки: «⚠ шанс 50%: d6 4–6 (Мера)». */
export function gateNote(gate: ReturnType<typeof gateOf>): string {
  if (!gate.need) return ''
  const n = gate.rolls ?? 1
  return `⚠ шанс ${Math.round(((7 - gate.need) / 6) ** n * 100)}%: d6 ${gate.need}–6${n > 1 ? ` × ${n}` : ''} (${gate.poles})`
}

/** Бросок характера у двери: true — прошёл. Бросок и итог — в журнале. */
export function gateRoll(g: G, p: Player, gate: ReturnType<typeof gateOf>, place: string): boolean {
  for (let i = 0; gate.need && i < (gate.rolls ?? 1); i++) {
    const r = rollDie(g, p, 6, `характер (${gate.poles})`)
    if (r < gate.need) { say(g, p, `${place}: характер (${gate.poles}) — d6 = ${r}, нужно ${gate.need}–6: дошёл до двери и раздумал`); return false }
    say(g, p, `${place}: характер (${gate.poles}) — d6 = ${r}: прошёл`)
  }
  return true
}

/**
 * После события: два действия (решено 17.11). ■ работа — не больше одной за ход; ▲ малый обмен или знакомство;
 * большой обмен ▲▲ — оба действия. ◆ — решение рынка молодости сверх двух. Действия — данные (src/data/market.ts).
 * Характер: место может требовать проверки d6 или быть закрыто; в стрессе черта тянет в ловушку.
 */
function* actions(g: G, p: Player): Flow {
  const t = g.c.tables
  if (!g.c.actions.length || p.inst || p.skip > 0) return
  // «Тихий день» Эшвинов: на следующем ходу рынок недоступен.
  if (p.rules['без рынка']) {
    const due = p.rules['без рынка'].arg === String(p.turns)
    if (Number(p.rules['без рынка'].arg) <= p.turns) delete p.rules['без рынка']
    if (due) { say(g, p, 'тихий день: рынок недоступен'); return }
  }
  const adult = t.slotSegments['▲'].includes(segName(p))
  const left = { acts: adult ? t.turnActions : 0, work: adult ? t.workPerTurn : 0, youth: t.slotSegments['◆'].includes(segName(p)) ? Math.min(t.turnSlots['◆'], p.youthTokens) : 0 }
  const cost = (a: Action) => ({ acts: a.slots.filter((s) => s !== '◆').length, work: a.slots.filter((s) => s === '■').length, youth: a.slots.filter((s) => s === '◆').length })
  const fits = (a: Action) => { const c = cost(a); return c.acts <= left.acts && c.work <= left.work && c.youth <= left.youth }
  const spendSlots = (a: Action) => { const c = cost(a); left.acts -= c.acts; left.work -= c.work; left.youth -= c.youth; p.youthTokens -= c.youth }
  const ready = (a: Action) => (a.perSeg === undefined || (p.counters[`действие:${a.id}:${p.seg}`] ?? 0) < a.perSeg) && !(a.once && p.counters[`действие:${a.id}`]) && cond(g, p, a.requires)

  for (;;) {
    if (!p.alive || p.inst || (left.acts <= 0 && left.youth <= 0)) return
    // Тяга: в стрессе черта уводит действие в свою ловушку (если хватает Возможностей).
    if (left.acts > 0 && p.psy <= t.pull.stressFrom) {
      const pulled = t.pull.list.map(([pole, id]) => ({ pole, a: g.c.actions.find((x) => x.id === id)! })).find(({ pole, a }) => {
        const lean = charLean(p, pole)
        return lean > 0 && a && ready(a) && p.vozm >= priceOf(g, p, a) && rollDie(g, p, 6, `тяга: ${pole}`) <= lean
      })
      if (pulled) {
        say(g, p, `тяга (${pulled.pole}): действие уходит в «${pulled.a.label.split(':')[0]}»`)
        left.acts -= 1
        yield* perform(g, p, pulled.a)
        continue
      }
    }
    const shown = g.c.actions.flatMap((a) => {
      if (!fits(a) || (a.once && p.counters[`действие:${a.id}`])) return []
      const price = priceOf(g, p, a)
      const gate = gateOf(g, p, a)
      const off = a.perSeg !== undefined && (p.counters[`действие:${a.id}:${p.seg}`] ?? 0) >= a.perSeg ? 'уже было в этом отрезке'
        : whyNot(g, p, a.requires) ?? a.refuse?.find((r) => !cond(g, p, r.unless))?.text ?? gate.closed ?? (price > 0 && p.vozm < price ? 'нет денег' : undefined)
      const row = { a, price, gate, off, via: false }
      // Клептократия: незаконное можно сделать «по знакомству» — −1 возм. сверху, зато без риска.
      const klepto = a.illegal && countryOf(g, p).ideology === 'Клептократия'
      return klepto ? [row, { ...row, price: price + 1, via: true, off: off ?? (p.vozm < price + 1 ? 'нет денег' : undefined) }] : [row]
    })
    if (!shown.some((x) => !x.off)) return
    const id = yield* ask(g, p, 'действие', `Что делаешь? Действий осталось: ${left.acts}${left.acts && !left.work ? ' (работа уже была)' : ''}${left.youth ? '; ещё ◆ рынок молодости' : ''}`, [
      ...shown.map(({ a, price, gate, off, via }) => ({
        id: via ? `${a.id}@знакомство` : a.id, label: via ? `${a.label} — по знакомству, без риска` : a.label, effect: a.effect, ...(off ? { off } : {}),
        note: [a.slots.join(''), price ? `${price} возм.` : '', gateNote(gate), a.note ?? ''].filter(Boolean).join(' · '),
      })),
      // Скупка (каталог «Предметы»: «в свой ход любую вещь можно продать за цену с карты») — бесплатно, без действия.
      ...(sellable(g, p).length ? [{ id: 'скупка', label: 'продать вещь в скупку', note: 'бесплатно, действие не тратится' }] : []),
      { id: 'конец', label: 'закончить ход' },
    ], { force: true })
    if (id === 'конец') return
    if (id === 'скупка') { yield* pawn(g, p); continue }
    const { a, gate, via } = shown.find((x) => (x.via ? `${x.a.id}@знакомство` : x.a.id) === id)!
    spendSlots(a)
    // Проверка характера: провал — действие потрачено, деньги не списываются.
    if (!gateRoll(g, p, gate, a.place ?? a.label)) {
      if (a.tryCounts) p.counters[`действие:${a.id}:${p.seg}`] = (p.counters[`действие:${a.id}:${p.seg}`] ?? 0) + 1
      continue
    }
    yield* perform(g, p, a, via)
  }
}

/** Выполнить действие: цена, отметки, шаги. */
function* perform(g: G, p: Player, a: Action, via = false): Flow {
  p.counters[`действие:${a.id}:${p.seg}`] = (p.counters[`действие:${a.id}:${p.seg}`] ?? 0) + 1
  p.counters[`действие:${a.id}`] = (p.counters[`действие:${a.id}`] ?? 0) + 1
  if (a.place) visit(p, a.place)
  for (const l of a.log ?? []) p.counters[l] = (p.counters[l] ?? 0) + 1
  const ctx = newCtx('действие', { card: a.id, tags: a.tags ?? [], ...(a.cap ? { cap: a.cap } : {}) })
  const price = Math.max(0, priceOf(g, p, a) + (via ? 1 : 0) - (a.place === 'Путешествие' ? travelDiscount(g, p) : 0))
  if (price) addParam(g, p, 'возм', -price, ctx)
  if (via) p.rules['по знакомству'] = {}
  yield* run(g, p, a.effect, ctx)
  delete p.rules['по знакомству']
  settle(g, p)
  yield* runDue(g, p)
}

// ── Ход ─────────────────────────────────────────────────────────────────

export function* playerTurn(g: G, p: Player): Flow {
  const t = g.c.tables
  p.turns += 1
  delete p.rules['сиделка']
  emit(g, { t: 'ход', p: p.seat, round: g.s.round + 1 })
  // Отпуск по ранению: этот ход — дома, как обычный; потом обратно на «Фронт».
  const leave = p.inst?.kind === 'фронт' && p.inst.leave ? p.inst : undefined
  if (leave) { delete p.inst; say(g, p, 'отпуск по ранению: ход дома') }
  if (p.skip > 0) {
    p.skip -= 1
    say(g, p, 'ход пропущен')
  } else {
    // С Молодости можно эмигрировать вместо движения (концепция, «Виды отъезда»); в войну — уйти добровольцем.
    const canLeave = !p.inst && p.seg >= SEGMENTS.indexOf('Молодость')
    const volunteer = leave ? [] : volunteerSides(g, p)
    let how = 'сиделка'
    while (how === 'сиделка' || how === 'сыграть' || how === 'скупка') {
      how = yield* ask(g, p, 'ход', `${p.name}: твой ход`, [
      { id: 'бросок', label: 'бросить кубик' },
      // Из закрытой страны (госсоциализм, военная диктатура, полицейское государство) «по своей воле» не выпускают — только нелегально.
      ...(canLeave ? [t.emigration.closed.includes(countryOf(g, p).ideology)
        ? { id: 'эмиграция', label: 'уехать нелегально вместо хода', note: 'легально из твоей страны выпускают только бегством' }
        : { id: 'эмиграция', label: 'эмигрировать вместо хода' }] : []),
      ...(volunteer.length ? [{ id: 'доброволец', label: 'уйти добровольцем на «Фронт» вместо хода' }] : []),
      ...(sellable(g, p).length ? [{ id: 'скупка', label: 'продать вещь в скупку', note: 'бесплатно, ход не тратится' }] : []),
      ...(anytimePlays(g, p).length ? [{ id: 'сыграть', label: 'сыграть карту (козырь, вещь, знакомый)', note: 'ход не тратится' }] : []),
      ...(segName(p) === 'Древность' ? [{ id: 'сиделка', label: p.rules['сиделка постоянно'] ? 'сиделка: сейчас постоянно — переключить на «сам»' : 'сиделка: сейчас «сам» — нанять постоянно', note: 'ход не тратится' }] : []),
    ], { force: true })
      if (how === 'сыграть') yield* playMenu(g, p)
      if (how === 'скупка') yield* pawn(g, p)
      if (how === 'сиделка') {
        if (p.rules['сиделка постоянно']) delete p.rules['сиделка постоянно']; else p.rules['сиделка постоянно'] = {}
        say(g, p, p.rules['сиделка постоянно'] ? 'сиделка теперь постоянно' : 'теперь справляешься сам')
      }
    }
    if (how === 'эмиграция' && (yield* emigrate(g, p, { optional: true }))) {
      // Переезд занял ход: ни движения, ни клетки.
    } else if (how === 'доброволец') {
      yield* volunteerAsk(g, p)
    } else {
      const steps = rollDie(g, p, t.moveDie, 'ход')
      const wasInst = !!p.inst
      const cell = yield* move(g, p, steps)
      if (p.alive && !p.finished) {
        if (p.inst?.kind === 'фронт') { if (wasInst) yield* frontTurn(g, p) } else if (p.inst) { if (wasInst) yield* instTurn(g, p) } else if (cell) yield* resolveCell(g, p, cell)
      }
    }
    if (p.alive && !p.finished && !p.inst && p.skip === 0) money(g, p)
    if (p.alive && !p.finished) yield* actions(g, p)
  }
  if (leave) backToFront(g, p, leave)
  yield* endTurn(g, p)
}

/** Конец хода: старение в Древности, кабала, точка покоя. Траты и пенсия придут с рынком (этап 3). */
function* endTurn(g: G, p: Player): Flow {
  const t = g.c.tables
  if (!p.alive || p.finished) return
  if (segName(p) === 'Древность') {
    if (p.noAging > 0) p.noAging -= 1
    else {
      // Сиделка за 2 возм. отменяет потерю за ход (и даёт «живёшь не один» в этот ход). Выбор — при входе в Древность.
      const want = !!p.rules['сиделка постоянно'] && !p.inst
      if (want && p.vozm < t.segments.nurse) say(g, p, `на сиделку не хватает (нужно ${t.segments.nurse} возм.): справляешься сам`)
      const nurse = want && p.vozm >= t.segments.nurse ? 'да' : 'нет'
      if (nurse === 'да') { addParam(g, p, 'возм', -t.segments.nurse, newCtx('правило')); p.rules['сиделка'] = {} } else addParam(g, p, 'физ', -t.segments.ancientWear, newCtx('правило'))
    }
  }
  if (p.alive && !p.inst && p.seg >= SEGMENTS.indexOf('Молодость') && p.vozm <= t.caps.bondage) {
    // «Семейные сбережения»: один раз не попасть в кабалу.
    if (yield* saveFromBondage(g, p)) say(g, p, '«Семейные сбережения»: в кабалу не попал')
    else enterInst(g, p, 'кабала', 0)
  }
  // Для угасания «Долга»: отрезок, когда Возможности были ниже нуля.
  if (p.vozm < 0) visit(p, 'в минусе')
  // Карантин — только на этот ход; «Судимость гаснет через один ход» — тоже.
  if (p.rules['карантин'] && Number(p.rules['карантин'].arg) <= p.turns) delete p.rules['карантин']
  for (const h of p.items.filter((x) => x.decay === 0 && x.seg !== undefined && x.seg < 0)) removeHeld(g, p, h)
  // Козырь без ячейки, не сыгранный в этот ход, уходит.
  for (const h of p.items.filter((x) => x.temp)) removeHeld(g, p, h)
  if (p.alive) { settle(g, p); yield* runDue(g, p) }
}
