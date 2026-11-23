import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { income } from '../src/engine/market.ts'
import { nearMiss, placeTrace, policyIncome, socialWorld, traceRule } from '../src/engine/social.ts'
import type { Player, Request } from '../src/engine/types.ts'

const real = loadContent()
function lab(seed: number, seats = 2): { e: Engine; ps: Player[] } {
  const e = new Engine(real, { span: 'one', seed, seats: Array.from({ length: seats }, (_, i) => ({ name: `И${i + 1}` })) }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  const ps = e.state.players
  for (const p of ps) Object.assign(p, { seg: 3, country: 0, vozm: 5, items: [], cls: 'Народ' })
  return { e, ps }
}
function drive<T>(flow: Flow<T>): { value: T; asked: Request[] } {
  const asked: Request[] = []
  let r = flow.next()
  while (!r.done) { asked.push(r.value); r = flow.next(r.value.options.find((o) => !o.off)!.id) }
  return { value: r.value, asked }
}

describe('Общественный след', () => {
  it('карты: 58 карт с ✊, в каждой шаг «след» и строка «ветка → канал»', () => {
    const cards = Object.values(real.decks).flat().filter((c) => c.trace)
    expect(cards).toHaveLength(58)
    for (const c of cards) expect(JSON.stringify([c.effect, c.sides ?? null])).toContain('"rule":"след"')
  })

  it('шаг «след»: «свой» — канал класса игрока; жетонов канала 6 на весь мир', () => {
    const { e, ps } = lab(1)
    const p = ps[0]
    p.cls = 'Интеллигенция'
    traceRule(e.g, p, 'свой')
    const c = e.state.world.countries[0]
    expect(c.trace).toEqual({ 'Гласность': 1 })
    expect(c.traceWho?.['Гласность']).toEqual([p.seat])
    for (let i = 0; i < 10; i++) placeTrace(e.g, e.state.world.countries[i % 5], 'Тень')
    expect(e.state.world.countries.reduce((s, x) => s + (x.trace?.['Тень'] ?? 0), 0)).toBe(6)
  })

  it('фон: бросок кризиса не дотянул на 1–3 — жетон канала отчуждённого класса', () => {
    const { e } = lab(2)
    const c = e.state.world.countries[1]
    c.alienated = 'Армия'
    nearMiss(e.g, c, 10, 13)
    expect(c.trace?.['Долг']).toBe(1)
    nearMiss(e.g, c, 9, 13)
    expect(c.trace?.['Долг']).toBe(1)
  })

  it('два жетона — исход; уступка: классу канала доход +1 на 5 мировых ходов, остальным жителям −1 возм.', () => {
    let concession = 0, suppression = 0
    for (let seed = 1; seed <= 40; seed++) {
      const { e, ps } = lab(seed)
      const [a, b] = ps
      b.cls = 'Армия'
      const c = e.state.world.countries[0]
      Object.assign(c, { ideology: 'Социал-демократия', dominant: 'Народ', alienated: 'Олигархи', stability: 5 })
      traceRule(e.g, a, 'Труд'); traceRule(e.g, a, 'Труд')
      const before = { a: income(e.g, a), vb: b.vozm }
      drive(socialWorld(e.g))
      expect(c.trace?.['Труд']).toBe(0)
      const pol = c.policies?.[0]
      if (pol?.kind === 'уступка') {
        concession++
        expect(pol.title).toBe('Трудовой кодекс')
        expect(policyIncome(e.g, a)).toBe(1)
        expect(income(e.g, a)).toBe(before.a + 1)
        expect(b.vozm).toBe(before.vb - 1)
        expect(pol.until).toBe(e.state.worldTurns + 5)
        expect(e.state.chronicle?.[0].text).toContain('Трудовой кодекс')
      }
      if (pol?.kind === 'подавление') { suppression++; expect(c.stability).toBe(4) }
    }
    // Народ доминирует (+1) и Труд в демократии (+1): уступка частая, подавления нет.
    expect(concession).toBeGreaterThan(15)
    expect(suppression).toBe(0)
  })

  it('затухание: со страны, куда за мировой ход ничего не легло, снимают один жетон', () => {
    const { e } = lab(3)
    const c = e.state.world.countries[2]
    placeTrace(e.g, c, 'Капитал')
    drive(socialWorld(e.g)) // жетон лёг в этот ход — не гаснет
    expect(c.trace?.['Капитал']).toBe(1)
    drive(socialWorld(e.g))
    expect(c.trace?.['Капитал']).toBe(0)
  })
})
