/**
 * Особые механики полюсов культуры и характера (концепция, «Культура», «Характер»): то, что не сводится к поправке
 * к броску по тегу (поправки — tables.cultureTags / characterTags, docs/MODIFIERS.md). Числа — tables.poles.
 * Симуляция автора эти механики не считает: это прочтения текста концепции, они перечислены в docs/ENGINE.md, 9ж.
 */
import { say, type G } from './core.ts'
import { charLean, cultureLean, newCtx, type Ctx } from './cond.ts'
import { addParam } from './change.ts'
import type { Cls, Player, Stat } from './types.ts'

const T = (g: G) => g.c.tables.poles

/**
 * Поправка к изменению числа на карте: Порядок — катастрофы (колода «Судьба») мягче на 1; Риск — выигрыши и потери
 * Возможностей крупнее на 1; Цинизм — обман (#мошенничество) отнимает Возможностей на 1 меньше.
 */
export function poleDelta(g: G, p: Player, param: string, d: number, ctx: Ctx): number {
  if (ctx.source !== 'карта' || d === 0) return d
  const t = T(g)
  const disaster = ctx.deck === t.disaster.deck && (cultureLean(g, p, t.disaster.pole) > 0 || !!p.rules['катастрофа мягче'])
  if (d < 0 && disaster && t.disaster.params.includes(param)) d = Math.min(0, d + t.disaster.soften)
  if (param === 'возм' && d !== 0 && cultureLean(g, p, t.risk.pole) > 0) d += Math.sign(d) * t.risk.add
  if (param === 'возм' && d < 0 && ctx.tags.includes(t.fraud.tag) && cultureLean(g, p, t.fraud.cynic) > 0) d = Math.min(0, d + 1)
  return d
}

/** «Катастрофа мимо» (отметка с карты): следующая карта «Судьбы» не разыгрывается. */
export function disasterMiss(g: G, p: Player, deck: string): boolean {
  if (deck !== T(g).disaster.deck || !p.rules['катастрофа мимо']) return false
  delete p.rules['катастрофа мимо']
  say(g, p, 'катастрофа прошла мимо')
  return true
}

/** После карты: Доверие — обман бьёт сильнее (провал на #мошенничество: ещё −1 возм., −1 псих.); Щедрость — помощь другим стоит денег. */
export function afterCardPoles(g: G, p: Player, tags: string[], failed: boolean): [string, number][] {
  const t = T(g)
  const out: [string, number][] = []
  if (failed && tags.includes(t.fraud.tag) && cultureLean(g, p, t.fraud.trust) > 0) { say(g, p, 'обман бьёт сильнее: ты поверил'); out.push(['возм', -1], ['псих', -1]) }
  if (tags.includes(t.generosity.tag) && charLean(p, t.generosity.pole) > 0) { say(g, p, 'Щедрость: помогаешь и деньгами'); out.push(['возм', t.generosity.vozm]) }
  return out
}

/** Развод: в светской культуре без штрафа. */
export const freeDivorce = (g: G, p: Player): boolean => cultureLean(g, p, T(g).divorceFree) > 0

/** Серость: Традиция — мягче (сценарий жизни задан), Самовыражение — жёстче. */
export function greyPsy(g: G, p: Player): number {
  return Object.entries(T(g).grey).reduce((s, [pole, n]) => s + (cultureLean(g, p, pole) > 0 ? n : 0), 0)
}

/** Отказ от предназначения Династии: Коллективизм — труднее, Индивидуализм — легче (на силу положения). */
export function dynastyRefusal(g: G, p: Player): number {
  return Object.entries(T(g).dynasty).reduce((s, [pole, n]) => s + n * cultureLean(g, p, pole), 0)
}

/** Фамилизм и Институции: цена психолога ±1. */
export function familismPrice(g: G, p: Player, place?: string): number {
  if (!place || !T(g).familism.places.includes(place)) return 0
  return Object.entries(T(g).familism.price).reduce((s, [pole, n]) => s + (cultureLean(g, p, pole) > 0 ? n : 0), 0)
}

/** Достоинство: конфликт решается через суд — к проверке Силы с #конфликт можно Харизму или Интеллект. */
export function dignityStats(g: G, p: Player, stat: Stat, tags: string[]): Stat[] {
  const t = T(g).dignity
  return stat === t.from && tags.includes(t.tag) && cultureLean(g, p, t.pole) > 0 ? t.to : []
}

/** Соперничество: другой игрок в твоей стране поднялся в классе — −1 псих., но +1 к следующему броску на карьеру. */
export function rivalry(g: G, p: Player, from: Cls, to: Cls): void {
  const t = T(g).rivalry
  if (g.c.tables.work.ladder[to] <= g.c.tables.work.ladder[from]) return
  for (const q of g.s.players) {
    if (q === p || !q.alive || q.finished || q.country !== p.country || charLean(q, t.pole) <= 0) continue
    say(g, q, `Соперничество: ${p.name} поднялся в классе`)
    addParam(g, q, 'псих', t.psy, newCtx('правило'))
    q.mods.push({ tag: '#карьера', add: t.career, until: 'проверка', seg: q.seg })
  }
}

/** Усердие: риск выгорания — Переработка стоит ещё −1 псих. (Беспечность выгорания не знает). */
export const burnout = (g: G, p: Player): number => (charLean(p, T(g).burnout.pole) > 0 ? T(g).burnout.psy : 0)
