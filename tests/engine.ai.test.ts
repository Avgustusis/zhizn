import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { Engine } from '../src/engine/engine.ts'
import { aiAnswer } from '../src/engine/ai/index.ts'
import { near, outlook } from '../src/engine/ai/goal.ts'
import { ARCHETYPES, bureauName, tasteOf } from '../src/engine/ai/persona.ts'
import { wantsOf } from '../src/engine/ai/wants.ts'
import type { SeatConfig } from '../src/engine/types.ts'

const content = loadContent()
const seats = (ai: SeatConfig['ai'], n = 2): SeatConfig[] => Array.from({ length: n }, (_, i) => ({ name: `И${i + 1}`, ai }))
function play(e: Engine, limit = 100000): Engine {
  for (let i = 0; i < limit && e.pending; i++) e.answer(aiAnswer(e.g, e.pending, undefined, e))
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

  it('«Нечестно»: копия партии не меняет саму партию; сохранение по-прежнему с журналом', () => {
    const e = new Engine(content, { span: 'one', seed: 3, seats: seats('unfair'), keepLog: true })
    play(e, 300)
    const before = JSON.stringify(e.state)
    const f = e.fork()
    for (let i = 0; i < 30 && f.pending; i++) f.answer(f.pending.options.find((o) => !o.off)!.id)
    expect(JSON.stringify(e.state)).toBe(before)
    const save = e.save()
    const back = Engine.load(content, save)
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
    expect(bureauName()).toMatch(/^№ [1-9]\d{11} «[А-ЯЁ][а-яё]+»$/)
  })
})
