import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { setClass } from '../src/engine/change.ts'
import { newCtx } from '../src/engine/cond.ts'
import { Engine } from '../src/engine/engine.ts'
import { afterCardPoles, burnout, dignityStats, dynastyRefusal, familismPrice, freeDivorce, greyPsy, poleDelta } from '../src/engine/poles.ts'
import type { Player } from '../src/engine/types.ts'

const real = loadContent()
function lab(seed: number, seats = 1): { e: Engine; ps: Player[] } {
  const e = new Engine(real, { mode: 'поколение', seed, seats: Array.from({ length: seats }, (_, i) => ({ name: `И${i + 1}` })) }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  for (const p of e.state.players) Object.assign(p, { seg: 3, country: 0, citizenship: [0], character: [0, 0, 0, 0, 0, 0, 0], ownProfile: Array(11).fill(0), mods: [], psy: 3 })
  return { e, ps: e.state.players }
}
/** Положение личной культуры на полюсе: ось и знак (минус — первый полюс). */
const AX: Record<string, [number, number]> = { 'Коллективизм': [0, -1], 'Индивидуализм': [0, 1], 'Порядок': [3, -1], 'Риск': [3, 1], 'Секуляризм': [4, 1], 'Традиция': [5, -1], 'Самовыражение': [5, 1], 'Фамилизм': [6, -1], 'Институции': [6, 1], 'Доверие': [7, -1], 'Цинизм': [7, 1], 'Достоинство': [8, 1] }
const lean = (p: Player, pole: string, n = 1) => { const [a, s] = AX[pole]; p.ownProfile![a] = s * n }
const card = (deck: string, tags: string[] = []) => newCtx('карта', { deck, tags: tags as never })

describe('механики полюсов', () => {
  it('Порядок: катастрофы («Судьба») мягче на 1; Риск: Возможности на картах крупнее на 1', () => {
    const { e, ps: [p] } = lab(1)
    expect(poleDelta(e.g, p, 'физ', -3, card('судьба'))).toBe(-3)
    lean(p, 'Порядок')
    expect(poleDelta(e.g, p, 'физ', -3, card('судьба'))).toBe(-2)
    expect(poleDelta(e.g, p, 'физ', -3, card('страна'))).toBe(-3)
    lean(p, 'Риск')
    expect(poleDelta(e.g, p, 'возм', 2, card('страна'))).toBe(3)
    expect(poleDelta(e.g, p, 'возм', -2, card('страна'))).toBe(-3)
  })

  it('Доверие: провал на #мошенничество — ещё −1 возм. и −1 псих.; Цинизм — потеря на 1 меньше', () => {
    const { e, ps: [p] } = lab(2)
    lean(p, 'Доверие')
    expect(afterCardPoles(e.g, p, ['#мошенничество'], true)).toEqual([['возм', -1], ['псих', -1]])
    expect(afterCardPoles(e.g, p, ['#мошенничество'], false)).toEqual([])
    lean(p, 'Цинизм')
    expect(poleDelta(e.g, p, 'возм', -2, card('страна', ['#мошенничество']))).toBe(-1)
  })

  it('Секуляризм — развод без штрафа; Серость: Традиция мягче, Самовыражение жёстче; Династия: Индивидуализм легче', () => {
    const { e, ps: [p] } = lab(3)
    lean(p, 'Секуляризм')
    expect(freeDivorce(e.g, p)).toBe(true)
    lean(p, 'Традиция')
    expect(greyPsy(e.g, p)).toBe(1)
    lean(p, 'Самовыражение', 2)
    expect(greyPsy(e.g, p)).toBe(-1)
    lean(p, 'Индивидуализм', 2)
    expect(dynastyRefusal(e.g, p)).toBe(2)
  })

  it('Фамилизм — психолог дороже; Достоинство — к Силе в #конфликт можно Харизму и Интеллект', () => {
    const { e, ps: [p] } = lab(4)
    lean(p, 'Фамилизм')
    expect(familismPrice(e.g, p, 'Психолог')).toBe(1)
    lean(p, 'Институции')
    expect(familismPrice(e.g, p, 'Психолог')).toBe(-1)
    lean(p, 'Достоинство')
    expect(dignityStats(e.g, p, 'Сила', ['#конфликт'])).toEqual(['Харизма', 'Интеллект'])
    expect(dignityStats(e.g, p, 'Сила', ['#работа'])).toEqual([])
  })

  it('Соперничество: другой игрок поднялся в классе — −1 псих. и +1 к карьере; Усердие — выгорание', () => {
    const { e, ps: [p, q] } = lab(5, 2)
    q.character = [0, 0, 0, -1, 0, 0, 0] // Соперничество — первый полюс оси
    Object.assign(p, { cls: 'Народ' })
    setClass(e.g, p, 'Интеллигенция')
    expect(q.psy).toBe(2)
    expect(q.mods.some((m) => m.tag === '#карьера' && m.add === 1)).toBe(true)
    q.character = [0, 0, 0, 0, 0, 0, 1]
    expect(burnout(e.g, q)).toBe(-1)
  })
})
