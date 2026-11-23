/**
 * Оружие, лицензия, обыск (решено 19.11; концепция, «Оружие, лицензия, обыск»).
 * Некоторые вещи законны не везде: пока никто не пришёл, они лежат и работают; при обыске запрещённое изымают,
 * за часть — ещё «Судимость» (одна, сколько бы ни нашли). Числа и таблица — tables.search.
 */
import { ask, countryOf, die, say, type Flow, type G } from './core.ts'
import { has, newCtx } from './cond.ts'
import { addParam, gainItem, removeHeld, rollDie } from './change.ts'
import type { Held, Ideo, Player } from './types.ts'

const T = (g: G) => g.c.tables.search

/** Итог обыска для вещи в стране: законно, изъять или изъять с «Судимостью». */
export function verdict(g: G, p: Player, h: Held, ideology: Ideo = countryOf(g, p).ideology): 'ok' | 'take' | 'record' {
  const t = T(g)
  const row = t.table[h.name]
  if (!row || t.free.includes(ideology)) return 'ok'
  if (t.service.cls.includes(p.cls) && t.service.items.includes(h.name)) return 'ok'
  const gi = t.groups.findIndex((gr) => gr.includes(ideology))
  const cell = row[gi < 0 ? 0 : gi]
  if (cell.startsWith('L:')) return licensed(g, p, ideology) ? 'ok' : (cell.slice(2) as 'take' | 'record')
  return cell as 'ok' | 'take' | 'record'
}

/** «Лицензия» действует: она есть, и строй её признаёт (не военная диктатура и не полицейское государство). */
export const licensed = (g: G, p: Player, ideology: Ideo = countryOf(g, p).ideology): boolean =>
  has(g, p, T(g).license.name) && !T(g).license.void.includes(ideology)

/** Запрещено ли держать вещь в стране игрока (для скупки за треть цены). */
export const forbidden = (g: G, p: Player, h: Held): boolean => verdict(g, p, h) !== 'ok'

/** Скупка берёт за треть: запрещено в стране и у вещи нет своей цены в скупке («Контрабанда»). */
export const pawnHot = (g: G, p: Player, h: Held): boolean => !T(g).pawnOwn.includes(h.name) && forbidden(g, p, h)

/**
 * Обыск: запрещённое изымают (карта уходит в стопку), за часть — «Судимость» (одна).
 * Возвращает, нашли ли что-нибудь. Вызывается и без вопросов (при аресте): «Судимость» вопросов не задаёт.
 */
export function* search(g: G, p: Player, why: string): Flow<boolean> {
  const c = countryOf(g, p)
  if (T(g).free.includes(c.ideology)) { say(g, p, `обыск (${why}): в вольнице ничего не изымают`); return false }
  let found = false
  let record = false
  for (const h of [...p.items]) {
    const v = verdict(g, p, h)
    if (v === 'ok') continue
    found = true
    if (v === 'record') record = true
    say(g, p, `обыск (${why}): изъято «${h.name}»${v === 'record' ? ' — «Судимость»' : ''}`)
    removeHeld(g, p, h)
  }
  if (record && !has(g, p, 'Судимость')) yield* gainItem(g, p, 'Судимость')
  if (!found) say(g, p, `обыск (${why}): ничего не нашли`)
  p.counters['обыск'] = (p.counters['обыск'] ?? 0) + 1
  return found
}

/** Обыск без вопросов (при аресте, из синхронного входа в тюрьму): генератор проходит до конца сразу. */
export function searchNow(g: G, p: Player, why: string): void {
  const flow = search(g, p, why)
  for (let r = flow.next(); !r.done; r = flow.next()) throw new Error('обыск: неожиданный вопрос')
}

/** Карта «Ночной обыск» (Страна № 70): суровые строи — обыск; остальные — только с «Учётом» или «Судимостью». */
export function* nightSearch(g: G, p: Player): Flow {
  const c = countryOf(g, p)
  const harsh = T(g).turmoilLosers.includes(c.ideology)
  if (harsh || has(g, p, 'Учёт') || has(g, p, 'Судимость')) {
    if (!(yield* search(g, p, 'ночной обыск'))) addParam(g, p, 'псих', -1, newCtx('правило'))
  } else {
    say(g, p, 'обыскивают соседей')
    addParam(g, p, 'псих', -1, newCtx('правило'))
  }
}

/** Смена власти в стране игрока: «Лицензия» на d6 1–3 недействительна. */
export function licenseAtPowerChange(g: G, p: Player): void {
  const t = T(g).license
  const h = p.items.find((x) => x.name === t.name)
  if (h && rollDie(g, p, 6, `«Лицензия» при смене власти: в сброс на 1–${t.lostUpTo}`) <= t.lostUpTo) {
    say(g, p, 'новая власть не признаёт «Лицензию»')
    removeHeld(g, p, h)
  }
}

/** Покупка оружия: со склада — облава (d6 1, при ГС, ВД, ПГ — d8 1–2; Мафии и вольнице без риска). */
export function* buyWeapon(g: G, p: Player, name: string): Flow {
  const t = T(g)
  const c = countryOf(g, p)
  const h = yield* gainItem(g, p, name)
  if (!h) return
  const store = name === 'Оружие со складов' || name === 'Взрывчатка'
  if (!store || p.cls === 'Мафия' || t.free.includes(c.ideology)) return
  const harsh = t.raid.harsh.includes(c.ideology)
  const die_ = harsh ? t.raid.harshDie : t.raid.die
  const upTo = harsh ? t.raid.harshUpTo : t.raid.upTo
  if (rollDie(g, p, die_, `облава на складе: на 1–${upTo}`) <= upTo) {
    say(g, p, `облава: «${name}» изъяли`)
    removeHeld(g, p, h)
    if (!has(g, p, 'Судимость')) yield* gainItem(g, p, 'Судимость')
  }
}

/** «Листовки» (Порт и склады, с печатным станком): жетон ✊ своего класса; в несвободной стране ночью, в страхе, d6 1 — обыск. */
export function* leaflets(g: G, p: Player): Flow {
  const c = countryOf(g, p)
  const ctx = newCtx('правило')
  if (!T(g).leaflets.free.includes(c.ideology)) {
    say(g, p, 'листовки печатают ночью, в страхе')
    addParam(g, p, 'псих', -1, ctx)
    addParam(g, p, 'физ', -1, ctx)
    if (die(g, 6) === 1) { yield* search(g, p, 'листовки'); return }
  }
  count(p, 'листовки')
}
const count = (p: Player, k: string) => { p.counters[k] = (p.counters[k] ?? 0) + 1 }

/** «Враг напомнил о себе»: при входе в отрезок, за каждого «Врага» d6 1 — −2 возм. или −1 физ. на выбор. */
export function* enemyReminds(g: G, p: Player): Flow {
  const t = T(g).enemy
  for (const _ of p.items.filter((h) => h.name === 'Враг')) {
    if (!p.alive || rollDie(g, p, 6, '«Враг» напоминает о себе на 1') > t.upTo) continue
    const a = yield* ask(g, p, 'карта', '«Враг» напомнил о себе. Чем заплатишь?', [
      { id: 'возм', label: `${t.vozm} возм.` }, { id: 'физ', label: `${t.phys} физ.` },
    ], { force: true })
    addParam(g, p, a, a === 'возм' ? t.vozm : t.phys, newCtx('правило'))
  }
}
