/** Ход игрока: движение по полю, клетки и карты, входы в отрезки, институты, слоты действий, конец хода. */
import type { BoardCell } from '../data/board-schema.ts'
import { SEGMENTS, type Card } from '../data/schema.ts'
import { ask, countryOf, emit, rnd, roll3, say, segName, type Flow, type G } from './core.ts'
import { charLean, cond, has, newCtx, type Ctx } from './cond.ts'
import { addParam, death, enterInst, fire, gainItem, itemsPerSeg, leaveInst, rollDie, runDue, visit } from './change.ts'
import { spend, strongIn } from './checks.ts'
import { run } from './exec.ts'
import { markEntry, meaningAtEntry, settle } from './meaning.ts'
import { rollFashion } from './setup.ts'
import type { Player, Slot } from './types.ts'

const cellsOf = (g: G, seg: number): BoardCell[] => g.c.board.segments[seg].cells
export const cellOf = (g: G, p: Player): BoardCell => cellsOf(g, p.seg)[p.cell]

// ── Карты ───────────────────────────────────────────────────────────────

/** Подходит ли карта игроку сейчас: отрезок, подсектор, условие карты. */
function fits(g: G, p: Player, card: Card, deck: string): boolean {
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
  if (card.miracle) p.flags['чудо'] = true
  yield* run(g, p, card.effect, ctx)
  // #закон: проваленная проверка в «жёсткой» стране — на d6 = 1 тюрьма («Тотальные институты»).
  const t = g.c.tables.inst
  const c = countryOf(g, p)
  if (p.alive && !p.inst && p.seg >= 1 && ctx.shared.failed && card.tags.includes('#закон') && (c.pos === 'периферия' || t.harshIdeologies.includes(c.ideology))) {
    if (rollDie(g, p, 6, '#закон: тюрьма на 1') <= t.lawPrisonUpTo) enterInst(g, p, 'тюрьма', rollDie(g, p, t.prison.light, 'срок'), '#закон')
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
  }
  emit(g, { t: 'отрезок', p: p.seat, seg })
  expire(p)
  const ctx = newCtx('правило')
  if (seg === 'Молодость' && p.cls === 'Армия' && p.citizenship.includes(p.country)) yield* gainItem(g, p, 'Присяга')
  if (seg === 'Зрелость' && p.cls === 'Армия' && has(g, p, 'Присяга') && p.stazh >= 5 && !has(g, p, 'Офицерское звание')) {
    const stat = p.stats['Интеллект'] >= p.stats['Харизма'] ? 'Интеллект' as const : 'Харизма' as const
    const roll = roll3(g, p.predisp === stat ? 1 : 0)
    const ok = roll.sum + p.stats[stat] >= 12
    emit(g, { t: 'проверка', p: p.seat, stat, dice: roll.dice, kept: roll.sum, value: p.stats[stat], mod: 0, trump: 0, dc: 12, ok, adv: p.predisp === stat ? 1 : 0, what: 'аттестация' })
    if (ok) yield* gainItem(g, p, 'Офицерское звание')
  }
  if (t.segments.beautyLoss.includes(seg)) addParam(g, p, 'Красота', -1, ctx)
  if (charLean(p, 'Аппетит')) addParam(g, p, 'физ', -1, ctx)
  rollFashion(g, countryOf(g, p))
  yield* itemsPerSeg(g, p)
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
      if (cellOf(g, p).sub !== subBefore) yield* payInstallments(g, p)
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
    addParam(g, p, 'возм', inst.workoff ?? t.bondage.perTurn, ctx)
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

/** После события: ■ основное, ▲ дополнительное, ◆ рынок молодости. Действия — данные (`Content.actions`). */
function* actions(g: G, p: Player): Flow {
  const t = g.c.tables
  if (!g.c.actions.length || p.inst || p.skip > 0) return
  const left = {} as Record<Slot, number>
  for (const s of Object.keys(t.turnSlots) as Slot[]) left[s] = t.slotSegments[s].includes(segName(p)) ? t.turnSlots[s] : 0
  for (;;) {
    if (!p.alive) return
    const open = g.c.actions.filter((a) => {
      const need: Partial<Record<Slot, number>> = {}
      for (const s of a.slots) need[s] = (need[s] ?? 0) + 1
      if ((Object.keys(need) as Slot[]).some((s) => left[s] < need[s]!)) return false
      if (a.perSeg !== undefined && (p.counters[`действие:${a.id}:${p.seg}`] ?? 0) >= a.perSeg) return false
      return cond(g, p, a.requires)
    })
    if (!open.length) return
    const id = yield* ask(g, p, 'действие', `Что делаешь? Слоты: ${(Object.keys(left) as Slot[]).map((s) => s.repeat(left[s])).join(' ') || '—'}`, [
      ...open.map((a) => ({ id: a.id, label: a.label, note: a.slots.join('') })),
      { id: 'конец', label: 'закончить ход' },
    ], { force: true })
    if (id === 'конец') return
    const a = open.find((x) => x.id === id)!
    for (const s of a.slots) left[s] -= 1
    p.counters[`действие:${a.id}:${p.seg}`] = (p.counters[`действие:${a.id}:${p.seg}`] ?? 0) + 1
    if (a.place) visit(p, a.place)
    yield* run(g, p, a.effect, newCtx('действие', { card: a.id }))
    settle(g, p)
    yield* runDue(g, p)
  }
}

// ── Ход ─────────────────────────────────────────────────────────────────

export function* playerTurn(g: G, p: Player): Flow {
  const t = g.c.tables
  p.turns += 1
  emit(g, { t: 'ход', p: p.seat, round: g.s.round + 1 })
  if (p.skip > 0) {
    p.skip -= 1
    say(g, p, 'ход пропущен')
  } else {
    yield* ask(g, p, 'ход', `${p.name}: твой ход`, [{ id: 'бросок', label: 'бросить кубик' }], { force: true })
    const steps = rollDie(g, p, t.moveDie, 'ход')
    const wasInst = !!p.inst
    const cell = yield* move(g, p, steps)
    if (p.alive && !p.finished) {
      if (p.inst) { if (wasInst) yield* instTurn(g, p) } else if (cell) yield* resolveCell(g, p, cell)
    }
    if (p.alive && !p.finished) yield* actions(g, p)
  }
  yield* endTurn(g, p)
}

/** Конец хода: старение в Древности, кабала, точка покоя. Траты и пенсия придут с рынком (этап 3). */
function* endTurn(g: G, p: Player): Flow {
  const t = g.c.tables
  if (!p.alive || p.finished) return
  if (segName(p) === 'Древность') {
    if (p.noAging > 0) p.noAging -= 1
    else addParam(g, p, 'физ', -t.segments.ancientWear, newCtx('правило'))
  }
  if (p.alive && !p.inst && p.seg >= SEGMENTS.indexOf('Молодость') && p.vozm <= t.caps.bondage) enterInst(g, p, 'кабала', 0)
  delete p.rules['сиделка']
  if (p.alive) { settle(g, p); yield* runDue(g, p) }
}
