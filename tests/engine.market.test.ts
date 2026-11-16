import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { gainItem } from '../src/engine/change.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { run } from '../src/engine/exec.ts'
import { businessAtEntry, income, money, pension, rings } from '../src/engine/market.ts'
import { newCtx } from '../src/engine/cond.ts'
import { playerTurn, priceOf } from '../src/engine/turn.ts'
import type { Action, Content, Player, Request } from '../src/engine/types.ts'

const real = loadContent()
const act = (id: string): Action => real.actions.find((a) => a.id === id)!

/** Карты событий пустые: в ходе работает только рынок. */
function quiet(): Content {
  const decks: Content['decks'] = {}
  for (const deck of Object.keys(real.decks)) decks[deck] = [{ id: `тест.${deck}`, n: 1, title: deck, text: '', src: '', kind: 'Б', tags: [], effect: [] }]
  decks['класс'] = (['Народ', 'Армия', 'Полиция', 'Интеллигенция', 'Мафия', 'Олигархи'] as const).map((cls) => ({ id: `тест.класс.${cls}`, n: 1, title: cls, text: '', src: '', kind: 'Б' as const, tags: [], effect: [], cls }))
  decks['развилка'] = ['Образование', 'Эмиграция', 'Партнёрство', 'Ребёнок'].map((title) => ({ id: `тест.р.${title}`, n: 1, title, text: '', src: '', kind: 'Р' as const, tags: [], effect: [], cell: 'на поле' }))
  return { ...real, decks, polar: [], subCodes: {} }
}

function lab(seed: number, over: Partial<Player> = {}): { e: Engine; p: Player } {
  const e = new Engine(quiet(), { mode: 'поколение', seed, seats: [{ name: 'Опыт' }] }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  const p = e.state.players[0]
  Object.assign(p, { seg: 3, cell: 5, phys: 0, psy: 0, vozm: 0, items: [], character: [0, 0, 0, 0, 0, 0, 0], fin: 0, pos: 0, coh: 0, mods: [], cls: 'Народ', stazh: 0, stazhHire: 0 }, over)
  return { e, p }
}
/** Ответы по списку; «*» — первый открытый вариант. Возвращает все заданные вопросы. */
function drive<T>(flow: Flow<T>, answers: string[] = []): { value: T; asked: Request[] } {
  const asked: Request[] = []
  let r = flow.next()
  while (!r.done) {
    asked.push(r.value)
    const open = r.value.options.filter((o) => !o.off).map((o) => o.id)
    const a = answers.shift()
    r = flow.next(a && open.includes(a) ? a : open.includes('конец') ? 'конец' : open[0])
  }
  return { value: r.value, asked }
}
const actionMenu = (asked: Request[]) => asked.find((q) => q.type === 'действие' && q.options.some((o) => o.id === 'конец'))
const country = (e: Engine, p: Player) => e.state.world.countries[p.country]

describe('работа', () => {
  it('доход по примерам концепции: интеллигент в ядре — 5, рабочий на периферии — минимум 1', () => {
    const a = lab(1, { cls: 'Интеллигенция' })
    Object.assign(country(a.e, a.p), { pos: 'ядро', ideology: 'Либеральная демократия', dominant: 'Олигархи', alienated: 'Мафия' })
    a.p.stats = { ...a.p.stats, 'Интеллект': 8, 'Мудрость': 6 }
    expect(income(a.e.g, a.p)).toBe(5)
    const b = lab(2, { cls: 'Народ' })
    Object.assign(country(b.e, b.p), { pos: 'периферия', ideology: 'Либеральная демократия', dominant: 'Олигархи', alienated: 'Мафия' })
    b.p.stats = { ...b.p.stats, 'Выносливость': 2, 'Смекалка': 2 }
    expect(income(b.e.g, b.p)).toBe(1)
    country(b.e, b.p).ideology = 'Госсоциализм' // одинаковый доход: 2 + пригодность
    expect(income(b.e.g, b.p)).toBe(2)
  })

  it('Работа: Д + 1, отметка Стажа найма; Подработка: Д ÷ 2 вверх, без Стажа; Дело — пустая отметка', () => {
    const { e, p } = lab(3, { cls: 'Интеллигенция', phys: 5, psy: 5 })
    const D = income(e.g, p)
    drive(run(e.g, p, [{ rule: 'работа', arg: 'работа' }], newCtx('действие')))
    expect([p.vozm, p.stazh, p.stazhHire]).toEqual([D + 1, 1, 1])
    p.vozm = 0
    drive(run(e.g, p, [{ rule: 'работа', arg: 'подработка' }], newCtx('действие')))
    expect([p.vozm, p.stazh]).toEqual([Math.ceil(D / 2), 1])
    drive(gainItem(e.g, p, 'Кафе на углу'))
    p.vozm = 0
    drive(run(e.g, p, [{ rule: 'работа', arg: 'дело' }], newCtx('действие')))
    expect(p.vozm).toBeGreaterThanOrEqual(1)
    expect([p.stazh, p.stazhHire]).toEqual([2, 1])
  })

  it('износ не трогает здоровье на −8 и ниже: потеря уходит в другое', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { e, p } = lab(seed, { cls: 'Народ', phys: -8, psy: 3 })
      drive(run(e.g, p, [{ rule: 'работа', arg: 'переработка' }], newCtx('действие')))
      expect(p.phys).toBe(-8)
    }
  })

  it('пороги здоровья: психика −5 закрывает переработку, −8 — любую работу (Усердие держится до −8)', () => {
    const open = (over: Partial<Player>) => {
      const { e, p } = lab(4, over)
      const { asked } = drive(playerTurn(e.g, p), ['бросок', 'конец'])
      return actionMenu(asked)?.options.filter((o) => !o.off).map((o) => o.id) ?? []
    }
    expect(open({ psy: 0 })).toContain('переработка')
    expect(open({ psy: -5 })).not.toContain('переработка')
    expect(open({ psy: -5 })).toContain('работа')
    expect(open({ psy: -8 })).not.toContain('работа')
    expect(open({ psy: -8, character: [0, 0, 0, 0, 0, 0, 1] })).toContain('работа')
  })
})

describe('деньги каждый ход', () => {
  it('траты: Молодость −1; Мафия и Олигархи −2; пенсия по Стажу найма в Старости, не больше дохода', () => {
    const young = lab(5, { seg: 2, cls: 'Олигархи', vozm: 5 })
    money(young.e.g, young.p)
    expect(young.p.vozm).toBe(4)
    const rich = lab(5, { seg: 3, cls: 'Мафия', vozm: 5 })
    money(rich.e.g, rich.p)
    expect(rich.p.vozm).toBe(3)
    const old = lab(6, { seg: 4, cls: 'Интеллигенция', vozm: 0, stazhHire: 7 })
    old.p.citizenship = [old.p.country]
    expect(pension(old.e.g, old.p)).toBe(Math.min(2, income(old.e.g, old.p)))
    old.p.stazhHire = 4
    expect(pension(old.e.g, old.p)).toBe(0)
  })
})

describe('цены по стране и идеологии', () => {
  it('психолог на периферии 2, при либеральной демократии +1; большого обмена в больнице на периферии нет', () => {
    const { e, p } = lab(7)
    const c = country(e, p)
    Object.assign(c, { pos: 'периферия', ideology: 'Клептократия' })
    expect(priceOf(e.g, p, act('психолог'))).toBe(2)
    c.ideology = 'Либеральная демократия'
    expect(priceOf(e.g, p, act('психолог'))).toBe(3)
    Object.assign(c, { pos: 'ядро' })
    expect(priceOf(e.g, p, act('больница-большой'))).toBe(4)
    c.ideology = 'Клептократия'
    expect(priceOf(e.g, p, act('больница-большой'))).toBe(3)
  })

  it('без денег действие закрыто: в минус платить нельзя', () => {
    const { e, p } = lab(8, { vozm: 1 })
    const { asked } = drive(playerTurn(e.g, p), ['бросок', 'конец'])
    const menu = actionMenu(asked)!
    expect(menu.options.find((o) => o.id === 'путешествие')?.off).toBe('нет денег')
  })
})

describe('ловушки', () => {
  it('бар: третье посещение за отрезок — «Привычка»; притон — сразу «Тяжёлая привычка»', () => {
    const { e, p } = lab(9, { vozm: 10 })
    for (let i = 0; i < 3; i++) {
      p.counters[`действие:бар:${p.seg}`] = i + 1
      drive(run(e.g, p, act('бар').effect, newCtx('действие')))
    }
    expect(p.items.filter((h) => h.name === 'Привычка').length).toBe(1)
    const den = lab(10, { vozm: 10 })
    drive(run(den.e.g, den.p, act('притон').effect, newCtx('действие')))
    expect(den.p.items.filter((h) => h.name === 'Привычка').length).toBe(2)
  })

  it('незаконная ловушка: на d6 = 3 штраф −3; второй раз за отрезок — тюрьма', () => {
    let fines = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { e, p } = lab(seed, { vozm: 10 })
      Object.assign(country(e, p), { pos: 'ядро', ideology: 'Теократия' })
      p.counters[`закон ловушки:${p.seg}`] = 1
      drive(run(e.g, p, act('бар').effect, newCtx('действие')))
      if (p.inst?.kind === 'тюрьма') fines++
    }
    expect(fines).toBeGreaterThan(3)
    expect(fines).toBeLessThan(25)
  })
})

describe('рынок молодости', () => {
  it('каждое решение один раз, не больше одного за ход, три жетона на Молодость', () => {
    const { e, p } = lab(11, { seg: 2, cell: 3, vozm: 30, phys: 8, psy: 8, youthTokens: 3 })
    const youthOpen = () => {
      const { asked } = drive(playerTurn(e.g, p), ['бросок', 'молодость-стартап', 'конец'])
      return actionMenu(asked)
    }
    const first = youthOpen()!
    expect(first.options.some((o) => o.id === 'молодость-стартап')).toBe(true)
    expect(p.youthTokens).toBe(2)
    const second = youthOpen()!
    expect(second.options.some((o) => o.id === 'молодость-стартап')).toBe(false) // один раз за жизнь
  })
})

describe('город', () => {
  it('кольца знакомств: периферия — Окраина; ядро — все; Олигархи — все; Мафия — на кольцо глубже', () => {
    const { e, p } = lab(12, { cls: 'Народ' })
    const c = country(e, p)
    c.pos = 'периферия'
    expect(rings(e.g, p)).toEqual(['окраина'])
    p.cls = 'Мафия'
    expect(rings(e.g, p)).toEqual(['окраина', 'середина'])
    p.cls = 'Олигархи'
    expect(rings(e.g, p)).toEqual(['окраина', 'середина', 'центр'])
    p.cls = 'Народ'; c.pos = 'ядро'
    expect(rings(e.g, p)).toEqual(['окраина', 'середина', 'центр'])
  })

  it('знакомство: здание раз в отрезок, шаг характера к полюсу встречи', () => {
    const { e, p } = lab(13)
    country(e, p).pos = 'периферия'
    const { asked } = drive(run(e.g, p, act('знакомство').effect, newCtx('действие')), ['Завод'])
    const where = asked.find((q) => q.text.startsWith('Куда'))!
    expect(where.options.every((o) => /окраина/.test(o.label))).toBe(true)
    expect(p.character.some((v) => v !== 0)).toBe(true)
    const again = drive(run(e.g, p, act('знакомство').effect, newCtx('действие')))
    expect(again.asked.find((q) => q.text.startsWith('Куда'))!.options.find((o) => o.id === 'Завод')?.off).toBeTruthy()
  })
})

describe('своё дело', () => {
  it('на входе в Древность дело продаётся: +3 возм. за каждый +1 бонуса', () => {
    const { e, p } = lab(14, { seg: 5, vozm: 0 })
    drive(gainItem(e.g, p, 'Мастерская'))
    drive(businessAtEntry(e.g, p))
    expect(p.items.some((h) => h.name === 'Мастерская')).toBe(false)
    expect(p.vozm).toBe(6)
  })
})

describe('все действия', () => {
  it('каждое действие исполняется при любых ответах', () => {
    for (const a of real.actions) {
      for (let seed = 1; seed <= 4; seed++) {
        const { e, p } = lab(seed, { seg: a.slots.includes('◆') ? 2 : 3, vozm: 12, phys: 3, psy: 3 })
        if (seed % 2) drive(gainItem(e.g, p, 'Партнёр'))
        if (a.id === 'дело' || seed === 3) drive(gainItem(e.g, p, 'Серый импорт'))
        let r = 7 * seed
        const flow = run(e.g, p, a.effect, newCtx('действие', { card: a.id }))
        let step = flow.next()
        while (!step.done) {
          const open = step.value.options.filter((o) => !o.off)
          expect(open.length, `${a.id}: вопрос без открытых вариантов`).toBeGreaterThan(0)
          step = flow.next(open[(r++) % open.length].id)
        }
      }
    }
  })
})

describe('партии с простым ИИ', () => {
  it('100 партий доходят до конца; до Зрелости доживает больше 90%; деньги и Стаж идут', async () => {
    const { answer } = await import('../src/engine/ai/simple.ts')
    let lives = 0, mature = 0, stazh = 0, worked = 0
    for (let seed = 1; seed <= 100; seed++) {
      const e = new Engine(real, { mode: 'поколение', seed, seats: [1, 2, 3, 4].map((i) => ({ name: `И${i}` })), keepLog: false }, { checkpoints: false })
      let guard = 0
      while (e.pending && guard++ < 100000) e.answer(answer(e.g, e.pending))
      expect(e.over, `партия ${seed}`).toBe(true)
      for (const p of e.state.players) {
        lives++
        if (p.seg >= 3) mature++
        stazh += p.stazh
        if (p.counters['действие:работа'] || p.counters['действие:дело']) worked++
        expect(p.vozm).toBeGreaterThanOrEqual(-15)
      }
    }
    expect(mature / lives).toBeGreaterThan(0.9)
    expect(worked / lives).toBeGreaterThan(0.9)
    expect(stazh / lives).toBeGreaterThan(5)
  }, 120000)
})
