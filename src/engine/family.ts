/**
 * «Перемены в семье» (концепция, 23–24.11). В Детстве и Юности класс игрока — это класс семьи: карты Детство № 43–46
 * и Юность № 44–47 меняют класс, Финансы и Сплочённость семьи, а с ними и класс игрока; ключи прежнего класса гаснут
 * (setClass), понижение стоит −1 психики (общее правило там же). Числа — tables.family.
 */
import { ask, countryOf, say, type Flow, type G } from './core.ts'
import { newCtx } from './cond.ts'
import { addParam, rollDie, setClass } from './change.ts'
import { arrive } from './emigration.ts'
import type { Cls, Player } from './types.ts'

const T = (g: G) => g.c.tables.family
const kid = (p: Player) => p.seg <= 1

/** Класс семьи меняется; в Детстве и Юности — и класс игрока. Госсоциализм — без Олигархов: вместо них Полиция («человек из органов»). */
export function familyClass(g: G, p: Player, cls: Cls): void {
  if (cls === 'Олигархи' && countryOf(g, p).ideology === 'Госсоциализм') { say(g, p, 'при госсоциализме Олигархов нет: он из органов — Полиция'); cls = 'Полиция' }
  if (cls === p.familyCls && (!kid(p) || cls === p.cls)) return
  say(g, p, `класс семьи: ${p.familyCls} → ${cls}`)
  p.familyCls = cls
  if (kid(p)) setClass(g, p, cls)
}

/** Броски d10 по таблице семьи: «удар» (Финансы, Сплочённость или оба — отдельным броском на каждую шкалу, 24.11) или «перемена» (Сплочённость). */
export function familyRoll(g: G, p: Player, kind: 'удар' | 'перемена', what: 'Финансы' | 'Сплочённость' | 'оба' = 'Сплочённость'): void {
  const t = T(g)
  const ctx = newCtx('правило')
  const d10 = (why: string) => rollDie(g, p, 10, why)
  if (kind === 'перемена') { const c = t.change.coh[d10('перемена в семье') - 1]; if (c) addParam(g, p, 'Сплочённость', c, ctx); return }
  if (what !== 'Сплочённость') { const f = t.blow.fin[d10('удар по семье: Финансы') - 1]; if (f) addParam(g, p, 'Финансы', f, ctx); else say(g, p, 'выкрутились') }
  if (what !== 'Финансы') { const c = t.blow.coh[d10('удар по семье: Сплочённость') - 1]; if (c) addParam(g, p, 'Сплочённость', c, ctx); if (c > 0) say(g, p, 'беда сплотила') }
}

/** Класс по новой строке Финансов: если класс семьи есть в строке «Класс семьи при рождении» — остаётся, иначе d6 по строке. */
export function classByRow(g: G, p: Player): void {
  const row = g.c.tables.birth.familyClass[String(p.fin)]
  if (row.includes(p.familyCls)) return
  // Олигархи выпадают по строке только при Финансах 0 и ниже: связи и активы остаются (24.11).
  if (p.familyCls === 'Олигархи' && p.fin > 0) return
  familyClass(g, p, row[rollDie(g, p, 6, `класс по строке Финансов ${p.fin}`) - 1])
}

/**
 * «Чемоданы» (Детство № 46). Из ядра: специалистами в полупериферию — класс семьи сохраняется, Финансы +1.
 * Не из ядра: эмиграция в страну выше по позиции — класс Народ (Олигархи сохраняют), Финансы −1. Обоим — «Перемена»
 * и «На новом месте» (штраф по культурной дистанции, аккультурация с шага 0). Закрытая граница — в requires карты.
 */
export function* suitcases(g: G, p: Player): Flow {
  const c = countryOf(g, p)
  const rank = (pos: string) => g.c.tables.family.rank[pos] ?? 0
  const core = c.pos === 'ядро'
  const fits = g.s.world.countries.filter((x) => x.id !== c.id && (core ? x.pos === 'полупериферия' : rank(x.pos) > rank(c.pos)))
  if (!fits.length) { say(g, p, 'подходящей страны нет — остаёмся'); return }
  const dest = fits.length === 1 ? fits[0] : fits[rollDie(g, p, fits.length, `куда едет семья: d${fits.length}`) - 1]
  say(g, p, core ? `родителей послали специалистами: ${dest.name}` : `семья эмигрирует: ${dest.name}`)
  const cls = p.cls
  yield* arrive(g, p, dest.id, true, 'по своей воле', true)
  const ctx = newCtx('правило')
  if (core) {
    if (p.cls !== cls) setClass(g, p, cls)
    addParam(g, p, 'Финансы', 1, ctx)
  } else {
    if (p.familyCls !== 'Олигархи') familyClass(g, p, 'Народ')
    addParam(g, p, 'Финансы', -1, ctx)
  }
  familyRoll(g, p, 'перемена')
}

// ── Олигархи при госсоциализме (концепция, 24.11) ───────────────────────

/** Класс, который выдаёт карта: при госсоциализме вместо Олигархов — Полиция («человек из органов»). */
export const gsClass = (g: G, p: Player, cls: Cls): Cls => (cls === 'Олигархи' && countryOf(g, p).ideology === 'Госсоциализм' ? 'Полиция' : cls)

/**
 * Страна стала госсоциализмом: каждый Олигарх в ней бросает d8 — 1: Полиция или Мафия на выбор, 2–8: Народ.
 * «Офшор» сохраняет Возможности, но не класс. Понижение — −1 психики (setClass).
 */
export function* nationalize(g: G, countryId: number): Flow {
  for (const p of g.s.players.filter((x) => x.alive && !x.finished && x.country === countryId && x.cls === 'Олигархи')) {
    const vozm = p.vozm
    const r = rollDie(g, p, 8, 'госсоциализм: Олигарх (1 — служба или тень, 2–8 — Народ)')
    const to: Cls = r === 1 ? ((yield* ask(g, p, 'класс', 'Госсоциализм: частного капитала больше нет. Сдать всё и пойти служить или уйти в тень?', [
      { id: 'Полиция', label: 'служить: Полиция' }, { id: 'Мафия', label: 'в тень: Мафия' },
    ], { force: true })) as Cls) : 'Народ'
    say(g, p, `госсоциализм: класс Олигархи отменён — ${to}`)
    setClass(g, p, to)
    if (p.familyCls === 'Олигархи' && kid(p)) p.familyCls = to
    const off = p.items.find((h) => h.name === 'Офшор')
    if (off && p.vozm < vozm) { say(g, p, '«Офшор» сохраняет возможности'); p.vozm = vozm }
  }
}
