/**
 * «Перемены в семье» (концепция, 23–24.11). В Детстве и Юности класс игрока — это класс семьи: карты Детство № 43–46
 * и Юность № 44–47 меняют класс, Финансы и Сплочённость семьи, а с ними и класс игрока; ключи прежнего класса гаснут
 * (setClass), понижение стоит −1 психики (общее правило там же). Числа — tables.family.
 */
import { countryOf, say, type Flow, type G } from './core.ts'
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

/** Бросок d10 по таблице семьи: «удар» (Финансы, Сплочённость или оба — одним броском) или «перемена» (Сплочённость). */
export function familyRoll(g: G, p: Player, kind: 'удар' | 'перемена', what: 'Финансы' | 'Сплочённость' | 'оба' = 'Сплочённость'): void {
  const t = T(g)
  const r = rollDie(g, p, 10, kind === 'удар' ? 'удар по семье' : 'перемена в семье')
  const ctx = newCtx('правило')
  if (kind === 'перемена') { const c = t.change.coh[r - 1]; if (c) addParam(g, p, 'Сплочённость', c, ctx); return }
  if (what !== 'Сплочённость') { const f = t.blow.fin[r - 1]; if (f) addParam(g, p, 'Финансы', f, ctx); else say(g, p, 'выкрутились') }
  if (what !== 'Финансы') { const c = t.blow.coh[r - 1]; if (c) addParam(g, p, 'Сплочённость', c, ctx); if (c > 0) say(g, p, 'беда сплотила') }
}

/** Класс по новой строке Финансов: если класс семьи есть в строке «Класс семьи при рождении» — остаётся, иначе d6 по строке. */
export function classByRow(g: G, p: Player): void {
  const row = g.c.tables.birth.familyClass[String(p.fin)]
  if (row.includes(p.familyCls)) return
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
