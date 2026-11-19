/**
 * Этап 3г: оставшиеся особые правила карт — пенсия, утраты, вещи и скупка, «Летопись» и «Итог воспитания» (запись для «Рода»).
 * Решения, где правило читается по-разному, — docs/ENGINE.md, раздел 9е.
 */
import { ask, countryOf, say, type Flow, type G } from './core.ts'
import { held, kindOf, newCtx, type Ctx } from './cond.ts'
import { addParam, count, dropHeld, gainItem, removeHeld, rollDie } from './change.ts'
import type { Held, Player } from './types.ts'

const T = (g: G) => g.c.tables.life

// ── Пенсия (развилка «Пенсия», Старость) ────────────────────────────────

/**
 * «Уйти» — пенсия по Стажу, работы больше нет. «Работать дальше» — пенсии нет, каждая отметка Стажа стоит ещё −1 физ.
 * «Учить молодых» — пенсия по Стажу, доход как Подработка (из работ — только она).
 */
export function retire(g: G, p: Player, how: 'пенсия' | 'работа на пенсии' | 'учить молодых'): void {
  delete p.rules['на пенсии']; delete p.rules['работа на пенсии']; delete p.rules['учит молодых']
  if (how === 'пенсия') { p.rules['на пенсии'] = {}; say(g, p, 'на пенсии: работы больше нет, пенсия по Стажу') }
  if (how === 'работа на пенсии') { p.rules['работа на пенсии'] = {}; say(g, p, 'работаешь дальше: пенсии нет, каждая отметка Стажа — ещё −1 физ.') }
  if (how === 'учить молодых') { p.rules['учит молодых'] = {}; count(p, 'учить молодых'); say(g, p, 'учишь молодых: пенсия по Стажу, доход как Подработка') }
}

// ── Вещи и скупка ───────────────────────────────────────────────────────

/** Цена вещи в скупке и что бывает при продаже (каталог «Вещи», колонка «Скупка»). */
export function sellPrice(g: G, p: Player, h: Held): number | undefined {
  const item = g.items.get(h.name)
  if (!item?.sell) return undefined
  const sp = T(g).sell[h.name]
  const pos = countryOf(g, p).pos
  if (sp?.byPos?.[pos] !== undefined) return sp.byPos[pos]
  if (sp?.fromCard && h.origin && sp.fromCard.includes(h.origin)) return sp.fromCardPrice
  return item.sell
}

/** Продать вещь в скупку: цена по стране; особые вещи — «Судимость» на d6 1, фамильное серебро — Сплочённость −1. */
export function* sellThing(g: G, p: Player, h: Held): Flow {
  const price = sellPrice(g, p, h) ?? 0
  const sp = T(g).sell[h.name]
  const c = countryOf(g, p)
  removeHeld(g, p, h)
  say(g, p, `скупка: «${h.name}» за ${price} возм.`)
  const ctx = newCtx('правило')
  if (price) addParam(g, p, 'возм', price, ctx)
  if (sp?.coh) addParam(g, p, 'Сплочённость', sp.coh, ctx)
  if (sp?.recordUpTo && (!sp.recordWhere || sp.recordWhere.includes(c.ideology)) && rollDie(g, p, 6, `продажа «${h.name}»: «Судимость» на 1`) <= sp.recordUpTo) yield* gainItem(g, p, 'Судимость')
}

/** «Комната с окном на школу»: из Имущества оставь одну вещь, остальные продай по скупке. */
export function* keepOneThing(g: G, p: Player): Flow {
  const things = p.items.filter((h) => kindOf(g, h) === 'вещь')
  if (things.length <= 1) return
  const keep = yield* ask(g, p, 'предмет', 'Переезд: какую вещь оставить? Остальные уйдут в скупку', things.map((h) => ({ id: String(h.uid), label: h.name, note: `скупка: ${sellPrice(g, p, h) ?? 'не берут'}` })), { force: true })
  for (const h of things) if (String(h.uid) !== keep) yield* sellThing(g, p, h)
}

/** Вещи, которые берёт скупка. */
export const sellable = (g: G, p: Player): Held[] => p.items.filter((h) => kindOf(g, h) === 'вещь' && sellPrice(g, p, h) !== undefined)

/** Скупка: в свой ход продать вещь за цену с карты — бесплатно, без действия (каталог «Предметы»). */
export function* pawn(g: G, p: Player): Flow {
  const things = sellable(g, p)
  if (!things.length) { say(g, p, 'продавать нечего'); return }
  const id = yield* ask(g, p, 'предмет', 'Скупка: что продаёшь?', [
    ...things.map((h) => ({ id: String(h.uid), label: `«${h.name}» — ${sellPrice(g, p, h)} возм.`, ...(T(g).sell[h.name]?.note ? { note: T(g).sell[h.name]!.note } : {}) })),
    { id: 'нет', label: 'ничего не продавать' },
  ], { force: true })
  if (id === 'нет') return
  yield* sellThing(g, p, things.find((h) => String(h.uid) === id)!)
}

// ── Утраты и отдать ─────────────────────────────────────────────────────

/** «Ночной звонок»: среди близких (Партнёр или Супруг(а), Друг, Наставник, Покровитель) бросок решает, кто ушёл. */
export function* loseClose(g: G, p: Player): Flow {
  const close = p.items.filter((h) => h.spouse || ['Партнёр', 'Друг', 'Наставник', 'Покровитель'].includes(g.items.get(h.name)?.group ?? ''))
  if (!close.length) return
  const h = close[rollDie(g, p, close.length, `кто ушёл: d${close.length}`) - 1]
  say(g, p, `ушёл: «${h.name}»${h.spouse ? ' (Супруг(а))' : ''}`)
  count(p, 'утрата')
  yield* dropHeld(g, p, h, false, true)
}

/** «Коллекторы»: отдать любой статус или козырь (выбор игрока). */
export function* giveItem(g: G, p: Player, ctx: Ctx): Flow {
  const list = p.items.filter((h) => ['статус', 'козырь'].includes(kindOf(g, h) ?? ''))
  if (!list.length) return
  const id = yield* ask(g, p, 'предмет', 'Что отдаёшь коллекторам?', list.map((h) => ({ id: String(h.uid), label: `${h.name} (${kindOf(g, h)})` })), { card: ctx.card, force: true })
  const h = list.find((x) => String(x.uid) === id)!
  say(g, p, `отдано: «${h.name}»`)
  removeHeld(g, p, h)
}

/** «Всё заповеднику»: отдать все Возможности выше нуля; сколько отдано — для «Летописи» (за каждые 3 — отметка, до 3). */
export function giveAll(g: G, p: Player, to: string): void {
  const n = Math.max(0, p.vozm)
  p.counters['отдано последним'] = n
  if (n) { say(g, p, `отдано ${to}: ${n} возм.`); addParam(g, p, 'возм', -n, newCtx('правило')) }
}

// ── «Род»: Летопись и Итог воспитания ───────────────────────────────────

/** Отметка в «Летописи» (виды заповедника): запись в состоянии партии, её прочтёт «Род» (этап 5). */
export function chronicle(g: G, p: Player, arg = 'отметка любому виду'): void {
  const per = arg.match(/за каждые (\d+)/)
  const marks = per ? Math.min(T(g).chronicleMax, Math.floor((p.counters['отдано последним'] ?? 0) / Number(per[1]))) : 1
  if (!marks) return
  ;(g.s.chronicle ??= []).push({ worldTurn: g.s.worldTurns, country: p.country, text: `Летопись: ${p.name} — ${arg}${marks > 1 ? ` × ${marks}` : ''}` })
  say(g, p, `Летопись: ${arg}${marks > 1 ? ` × ${marks}` : ''}`)
}

/** «Итог воспитания этого ребёнка +1»: прибавка на карте ребёнка (последнего), её прочтёт «Род». */
export function upbringingBonus(g: G, p: Player, arg = ''): void {
  const kids = held(g, p, 'Ребёнок')
  const h = kids[kids.length - 1]
  if (!h) return
  const n = Number(arg.match(/[+−-]\d+/)?.[0].replace('−', '-') ?? 1)
  h.upbringing = (h.upbringing ?? 0) + n
  say(g, p, `«Итог воспитания» ребёнка «${h.name}» ${n > 0 ? '+' : ''}${n}`)
}

/** «Обряд дорожает» (Сарды, «Ледоход»): обряд своей культуры стоит на 1 возм. дороже — навсегда. */
export function riteCost(_g: G, p: Player, arg = ''): void {
  const n = Number(arg.match(/\+(\d+)/)?.[1] ?? 1)
  p.rules['обряд дорожает'] = { arg: String(Number(p.rules['обряд дорожает']?.arg ?? 0) + n) }
}

