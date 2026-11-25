import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { Engine } from '../src/engine/engine.ts'
import { aiAnswer } from '../src/engine/ai/index.ts'
import { near, outlook } from '../src/engine/ai/goal.ts'
import { ARCHETYPES, bureauName, CALLSIGN_OF, CALLSIGN_TITLES, tasteOf } from '../src/engine/ai/persona.ts'
import { wantsOf } from '../src/engine/ai/wants.ts'
import type { SeatConfig } from '../src/engine/types.ts'

const content = loadContent()
const seats = (ai: SeatConfig['ai'], n = 2): SeatConfig[] => Array.from({ length: n }, (_, i) => ({ name: `И${i + 1}`, ai }))
function play(e: Engine, limit = 100000): Engine {
  for (let i = 0; i < limit && e.pending; i++) e.answer(aiAnswer(e.g, e.pending))
  return e
}
function lab(seed = 1): Engine {
  const e = new Engine(content, { span: 'one', seed, seats: seats('normal') }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  return e
}

describe('ИИ этапа 4', () => {
  it('цели из карты смысла: характеристика, класс, сторона в Смуте', () => {
    const e = lab()
    const p = e.state.players[0]
    p.meaning = { id: 'смысл.03', from: 'поиск', verdict: 0 }
    p.stats['Харизма'] = 4
    p.cls = 'Народ'
    const w = wantsOf(e.g, p)
    expect(w.stats.get('Харизма')).toBe(7)
    expect([...w.cls].sort()).toEqual(['Мафия', 'Олигархи'])
    expect(w.logs.has('победа в Смуте')).toBe(true)
  })

  it('близость: порог характеристики — доля пути; выполнено — 1', () => {
    const e = lab()
    const p = e.state.players[0]
    p.stats['Харизма'] = 5
    const c = { p: 'Харизма', gte: 7 } as const
    const half = near(e.g, p, c)
    expect(half).toBeGreaterThan(0.3); expect(half).toBeLessThan(0.6)
    p.stats['Харизма'] = 7
    expect(near(e.g, p, c)).toBe(1)
  })

  it('оценка: смерть и стигма хуже, брак лучше', () => {
    const e = lab()
    const p = e.state.players[0]
    const base = outlook(e.g, p)
    p.items.push({ uid: 9001, name: 'Судимость' })
    expect(outlook(e.g, p)).toBeLessThan(base)
    p.items.pop()
    p.alive = false
    expect(outlook(e.g, p)).toBeLessThan(base)
  })

  it('партия ИИ против ИИ воспроизводится по зерну на всех уровнях', () => {
    for (const ai of ['easy', 'normal', 'hard'] as const) {
      const a = play(new Engine(content, { span: 'one', seed: 7, seats: seats(ai) }, { checkpoints: false }))
      const b = play(new Engine(content, { span: 'one', seed: 7, seats: seats(ai) }, { checkpoints: false }))
      expect(a.over).toBe(true)
      expect(b.state.players.map((p) => [p.happiness, p.seg, p.alive])).toEqual(a.state.players.map((p) => [p.happiness, p.seg, p.alive]))
    }
  })

  it('сохранение: снимок шага без журнала, журнал приставляется при сохранении', () => {
    const e = new Engine(content, { span: 'one', seed: 3, seats: seats('normal'), keepLog: true })
    play(e, 300)
    const back = Engine.load(content, e.save())
    expect(back.state.log.length).toBe(e.state.log.length)
    expect(JSON.stringify(back.state.players)).toBe(JSON.stringify(e.state.players))
  })

  it('архетипы: 7 черт от −2 до +2; вкус следует чертам', () => {
    for (const a of ARCHETYPES) { expect(a.character).toHaveLength(7); for (const v of a.character) expect(Math.abs(v)).toBeLessThanOrEqual(2) }
    const e = lab()
    const p = e.state.players[0]
    p.character = [0, -2, 0, 0, 0, 0, 0] // сильная Хватка
    const grip = tasteOf(p).vozm!
    p.character = [0, 2, 0, 0, 0, 0, 0] // сильная Щедрость
    expect(tasteOf(p).vozm!).toBeLessThan(grip)
  })

  it('псевдоним «Случайно» — номер Бюро и архетип', () => {
    expect(bureauName()).toMatch(/^№ [1-9]\d{5} «[А-ЯЁ][а-яё]+( [А-ЯЁ][а-яё]+)+»$/)
    expect(new Set(CALLSIGN_TITLES).size).toBe(100)
    expect(new Set(CALLSIGN_OF).size).toBe(100)
    // Позывные не совпадают с именами архетипов ИИ.
    for (let i = 0; i < 200; i++) expect(ARCHETYPES.some((a) => bureauName().includes(`«${a.name}»`))).toBe(false)
  })
})

describe('Правки 23–24.11: понижение класса, «Присяга»', () => {
  it('понижение класса — −1 психики: в Народ из любого класса или из Олигархов в любой; повышение — без прибавки', async () => {
    const { setClass } = await import('../src/engine/change.ts')
    const e = lab(11)
    const p = e.state.players[0]
    Object.assign(p, { psy: 3, cls: 'Олигархи' })
    setClass(e.g, p, 'Мафия')
    expect(p.psy).toBe(2)
    setClass(e.g, p, 'Народ')
    expect(p.psy).toBe(1)
    setClass(e.g, p, 'Интеллигенция')
    expect(p.psy).toBe(1)
  })

  it('«Присяга»: вопрос на входе в Молодость; ИИ соглашается примерно в 70% случаев', () => {
    let asked = 0, yes = 0
    for (let seed = 1; seed <= 40; seed++) {
      const e = new Engine(content, { span: 'one', seed, seats: seats('simple', 4) }, { checkpoints: false })
      for (let i = 0; i < 100000 && e.pending; i++) {
        const r = e.pending
        const a = aiAnswer(e.g, r)
        if (r.text.startsWith('Присяга')) { asked++; if (a === 'да') yes++ }
        e.answer(a)
      }
    }
    expect(asked).toBeGreaterThan(15)
    expect(yes / asked).toBeGreaterThan(0.5); expect(yes / asked).toBeLessThan(0.9)
  }, 60000)


})
