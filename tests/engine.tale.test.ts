import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { CULTURES, RACES } from '../src/data/schema.ts'
import { Engine } from '../src/engine/engine.ts'
import { aiAnswer } from '../src/engine/ai/index.ts'
import { ARCHETYPES } from '../src/engine/ai/persona.ts'
import { builders, SHARE } from '../src/engine/tale.ts'
import type { GameState, Request, SeatConfig } from '../src/engine/types.ts'

const content = loadContent()
const OWN = ['Сила', 'Выносливость', 'Ловкость', 'Интеллект', 'Мудрость', 'Харизма', 'Красота'] as const
const POS: Record<string, number> = { 'ядро': 1, 'полупериферия': 0, 'периферия': -1 }

/** Подготовка «Сказки» до первого хода; как отвечает человек — answer. */
function prepare(seed: number, seats: SeatConfig[], answer: (r: Request, e: Engine) => string): Engine {
  const e = new Engine(content, { span: 'one', start: 'tale', seed, seats }, { checkpoints: false })
  for (let i = 0; i < 5000 && e.pending && e.state.phase === 'подготовка'; i++) {
    const r = e.pending
    e.answer(e.state.config.seats[r.player]?.ai ? aiAnswer(e.g, r) : answer(r, e))
  }
  expect(e.state.phase).toBe('игра')
  return e
}

/** Мир собран по правилам «Сказки». */
function checkWorld(s: GameState): void {
  const cs = s.world.countries
  expect(cs.map((c) => c.pos).sort()).toEqual(['периферия', 'периферия', 'полупериферия', 'полупериферия', 'ядро'])
  for (const r of RACES) expect(cs.some((c) => c.mainRaces.includes(r) || c.minorityRaces.includes(r))).toBe(true)
  for (const k of CULTURES) expect(cs.some((c) => c.mainCultures.includes(k) || c.minorityCultures.includes(k))).toBe(true)
  for (const c of cs) {
    expect(c.minorityRaces.length + c.minorityCultures.length).toBeLessThanOrEqual(3)
    if (c.multicultural) expect(c.minorityRaces).toEqual([])
    else expect([c.mainRaces.length, c.mainCultures.length]).toEqual([1, 1])
    const row = content.tables.world.ideologyClasses[c.ideology]
    expect(row.dom.map(([, x]) => x)).toContain(c.dominant)
    expect(row.ali.map(([, x]) => x)).toContain(c.alienated)
    expect(c.alienated).not.toBe(c.dominant)
  }
  for (const k of CULTURES) {
    const p = s.world.cultures[k]
    expect(p.filter((v) => Math.abs(v) === 2)).toHaveLength(3)
    expect(p.filter((v) => Math.abs(v) === 1)).toHaveLength(3)
  }
  expect(Object.keys(s.world.relations)).toHaveLength(10)
}

describe('«Сказка» (Легенда, Сага)', () => {
  it('одни ИИ: мир случайный, но по правилам «Сказки»; герои ИИ — по архетипу в пределах «Доли»', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const seats = [0, 1, 2, 3].map((i) => ({ name: `И${i}`, ai: 'normal' as const, archetype: ARCHETYPES[(seed + i) % ARCHETYPES.length].id }))
      const e = prepare(seed, seats, () => { throw new Error('людей нет') })
      checkWorld(e.state)
      for (const p of e.state.players) {
        const sum = OWN.reduce((a, s) => a + p.stats[s], 0)
        expect(sum).toBeLessThanOrEqual(SHARE.stats)
        for (const s of OWN) { expect(p.stats[s]).toBeGreaterThanOrEqual(1); expect(p.stats[s]).toBeLessThanOrEqual(4) }
        expect(p.fin + p.pos + p.coh + POS[e.state.world.countries[p.birthCountry].pos]).toBeLessThanOrEqual(SHARE.family)
        expect(p.character).toEqual(ARCHETYPES.find((a) => a.id === seats[p.seat].archetype)!.character)
        expect(p.meaning).toBeDefined()
        if (e.state.world.countries[p.birthCountry].ideology === 'Госсоциализм') expect(p.cls).not.toBe('Олигархи')
      }
    }
  })

  it('человек собирает всё сам (худший случай — всегда первый вариант): мир всё равно собран, «Доля» соблюдена', () => {
    const own = (r: Request) => r.options.find((o) => !o.off && !['случайно', 'шаг случайно', 'всё', 'по кубикам'].includes(o.id))!.id
    for (const seed of [3, 9, 17]) {
      const e = prepare(seed, [{ name: 'Человек', born: 1990 }], own)
      checkWorld(e.state)
      const p = e.state.players[0]
      expect(OWN.reduce((a, s) => a + p.stats[s], 0)).toBeLessThanOrEqual(SHARE.stats)
      expect(p.fin + p.pos + p.coh + POS[e.state.world.countries[p.birthCountry].pos]).toBeLessThanOrEqual(SHARE.family)
      expect(p.meaning?.from).toBe('рождение')
    }
  })

  it('человек на каждом вопросе выбирает «случайно»: правила те же', () => {
    const rnd = (r: Request) => (r.options.some((o) => o.id === 'случайно') ? 'случайно' : r.options.find((o) => !o.off)!.id)
    for (const seed of [4, 8, 15, 16]) checkWorld(prepare(seed, [{ name: 'А', born: 1980 }, { name: 'Б', born: 2001 }], rnd).state)
  })

  it('мир собирают по очереди, начиная с младшего; ИИ в сборке мира не участвует', () => {
    const e = new Engine(content, { span: 'one', start: 'tale', seed: 2, seats: [{ name: 'Старший', born: 1970 }, { name: 'ИИ', ai: 'normal' }, { name: 'Младший', born: 2005 }] }, { checkpoints: false })
    expect(builders(e.g)).toEqual([2, 0])
    e.answer('сами')
    const who: number[] = []
    for (let i = 0; i < 6 && e.pending; i++) { who.push(e.pending.player); e.answer(e.pending.options.find((o) => !o.off)!.id) }
    expect(who).toEqual([2, 0, 2, 0, 2, 0])
  })

  it('Положение +2 и выше открывает выбор из Династий; смысл выбран без броска', () => {
    const answer = (r: Request) => {
      if (r.text.startsWith('Положение семьи')) return r.options.find((o) => o.id === '2' && !o.off)?.id ?? r.options.find((o) => !o.off)!.id
      if (r.text.startsWith('Финансы семьи')) return '-3'
      if (r.text.startsWith('Сплочённость')) return '-3'
      if (r.type === 'смысл') return r.options.find((o) => o.label.includes('(Династия)'))?.id ?? r.options[0].id
      return r.options.some((o) => o.id === 'случайно') && r.type === 'сборка' && !r.text.includes(':') ? 'случайно' : r.options.find((o) => !o.off && o.id !== 'случайно' && o.id !== 'шаг случайно' && o.id !== 'всё')!.id
    }
    const e = prepare(21, [{ name: 'Наследник', born: 1999 }], answer)
    const p = e.state.players[0]
    expect(p.pos).toBe(2)
    expect(p.meaning?.from).toBe('династия')
    expect(p.meaning?.locked).toBe(true)
  })

  it('партия «Легенда» с ИИ доигрывается до конца', () => {
    const e = new Engine(content, { span: 'one', start: 'tale', seed: 31, seats: [0, 1, 2].map((i) => ({ name: `И${i}`, ai: 'normal' as const, archetype: ARCHETYPES[i].id })) }, { checkpoints: false })
    for (let i = 0; i < 100000 && e.pending; i++) e.answer(aiAnswer(e.g, e.pending))
    expect(e.over).toBe(true)
  }, 60000)
})
