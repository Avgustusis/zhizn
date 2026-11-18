import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { gainItem } from '../src/engine/change.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { run } from '../src/engine/exec.ts'
import { businessAtEntry, income, kontora, kontoraMenu, money, pension, rings, work } from '../src/engine/market.ts'
import { newCtx } from '../src/engine/cond.ts'
import { gateOf, playerTurn, priceOf } from '../src/engine/turn.ts'
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
    Object.assign(country(a.e, a.p), { pos: 'ядро', ideology: 'Теократия', dominant: 'Олигархи', alienated: 'Мафия' })
    a.p.stats = { ...a.p.stats, 'Интеллект': 8, 'Мудрость': 6 }
    expect(income(a.e.g, a.p)).toBe(5)
    const b = lab(2, { cls: 'Народ' })
    Object.assign(country(b.e, b.p), { pos: 'периферия', ideology: 'Теократия', dominant: 'Олигархи', alienated: 'Мафия' })
    b.p.stats = { ...b.p.stats, 'Выносливость': 2, 'Смекалка': 2 }
    expect(income(b.e.g, b.p)).toBe(1)
    country(b.e, b.p).ideology = 'Госсоциализм' // одинаковый доход: 2 + пригодность
    expect(income(b.e.g, b.p)).toBe(2)
    // 18.11: либеральная демократия — Интеллигенции и Олигархам +1, доход по найму не ниже 2; вольница — без +1.
    country(a.e, a.p).ideology = 'Либеральная демократия'
    expect(income(a.e.g, a.p)).toBe(6)
    country(b.e, b.p).ideology = 'Либеральная демократия'
    expect(income(b.e.g, b.p)).toBe(2)
    country(b.e, b.p).ideology = 'Вольница'
    expect(income(b.e.g, b.p)).toBe(1)
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
    c.ideology = 'Социал-демократия'
    expect(priceOf(e.g, p, act('больница-большой'))).toBe(3)
    c.ideology = 'Клептократия' // больница на 1 дороже (решено 17.11)
    expect(priceOf(e.g, p, act('больница-большой'))).toBe(4)
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

describe('правила хода 17.11', () => {
  const menu = (over: Partial<Player>, setup?: (e: Engine, p: Player) => void, answers: string[] = ['бросок', 'конец']) => {
    const { e, p } = lab(31, over)
    setup?.(e, p)
    const { asked } = drive(playerTurn(e.g, p), answers)
    return { e, p, asked, menu: actionMenu(asked)! }
  }

  it('два действия за ход: работа не больше одной; большой обмен — оба действия', () => {
    const { asked, p } = menu({ vozm: 20, phys: 3, psy: 3 }, undefined, ['бросок', 'работа', 'больница', 'конец'])
    const menus = asked.filter((q) => q.type === 'действие' && q.options.some((o) => o.id === 'конец'))
    expect(menus.length).toBe(2) // после двух действий ход окончен
    expect(menus[1].options.some((o) => o.id === 'работа')).toBe(false) // работа уже была
    expect(menus[1].options.some((o) => o.id === 'больница-большой')).toBe(false) // на одно действие большой обмен не влезает
    expect(p.counters['действие:работа']).toBe(1)
    const twoSmall = menu({ vozm: 20, phys: 3, psy: 3 }, undefined, ['бросок', 'хобби', 'больница', 'конец'])
    expect(twoSmall.p.counters['действие:больница']).toBe(1)
  })

  it('больница по идеологии: база +2, лучше +3; теократия без большого обмена', () => {
    const heal = (ideology: string, cls: Player['cls']) => {
      const { e, p } = lab(32, { cls, phys: 0 })
      Object.assign(country(e, p), { ideology, pos: 'ядро' })
      drive(run(e.g, p, act('больница').effect, newCtx('действие')))
      return p.phys
    }
    expect(heal('Либеральная демократия', 'Народ')).toBe(3)
    expect(heal('Госсоциализм', 'Народ')).toBe(2)
    expect(heal('Госсоциализм', 'Армия')).toBe(3)
    expect(heal('Клептократия', 'Олигархи')).toBe(3)
    expect(heal('Теократия', 'Народ')).toBe(2)
    const { e, p } = lab(33)
    Object.assign(country(e, p), { ideology: 'Теократия', pos: 'ядро' })
    const { asked } = drive(playerTurn(e.g, p), ['бросок', 'конец'])
    expect(actionMenu(asked)!.options.find((o) => o.id === 'больница-большой')?.off).toMatch(/нельзя/)
  })

  it('характер: сильная Мера закрывает бар; сильная Беспечность — больница по проверке d6 4–6; закрытое объясняет почему', () => {
    const { menu: m } = menu({ vozm: 10, character: [0, 0, 0, 0, 2, 0, -2] }, (e, p) => { country(e, p).ideology = 'Либеральная демократия' })
    expect(m.options.find((o) => o.id === 'бар')?.off).toMatch(/Мера/)
    expect(m.options.find((o) => o.id === 'больница')?.note).toMatch(/d6 4–6/)
    expect(m.options.find((o) => o.id === 'больница')?.off).toBeUndefined()
  })

  it('тяга: в стрессе сильный Аппетит уводит действие в ресторан', () => {
    let pulled = 0
    for (let seed = 1; seed <= 30; seed++) {
      const { e, p } = lab(seed, { vozm: 20, psy: -3, phys: 3, character: [0, 0, 0, 0, -2, 0, 0] })
      drive(playerTurn(e.g, p), ['бросок', 'конец'])
      if (p.counters['действие:обжорство']) pulled++
    }
    expect(pulled).toBeGreaterThan(10) // d6 ≤ 2 на каждое из двух действий
  })

  it('большая благотворительность ставит одну отметку «Пожертвование»', () => {
    const { e, p } = lab(34, { donations: 0 })
    drive(run(e.g, p, act('благотворительность-большая').effect, newCtx('действие')))
    expect(p.donations).toBe(1)
  })

  it('у варианта выбора на карте видно проверку: характеристика, сложность, поправки, шанс', () => {
    const { e, p } = lab(35)
    const flow = run(e.g, p, [{ choose: [{ label: 'рискнуть', then: [{ check: { stat: 'Харизма', dc: 15 }, success: [{ add: { 'возм': 3 } }], failure: [{ add: { 'псих': -1 } }] }] }, { label: 'нет', then: [] }] }], newCtx('карта', { tags: ['#карьера'] }))
    const q = flow.next().value as Request
    expect(q.options[0].check).toMatchObject({ stat: 'Харизма', dc: 15 })
    expect(q.options[0].check!.chance).toBeGreaterThan(0)
    expect(q.options[1].check).toBeUndefined()
  })
})

describe('новые дела и Контора (18.11)', () => {
  const turnOf = (e: Engine, p: Player, answers: string[] = []) => drive(work(e.g, p, 'дело'), answers)

  it('незаконное дело: можно закрыть до облавы; работа — облава d10 1–3 (клептократия d6 1)', () => {
    let raids = 0, runs = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { e, p } = lab(seed, { vozm: 5, psy: 3 })
      country(e, p).ideology = 'Либеральная демократия'
      drive(gainItem(e.g, p, 'Незаконные препараты'))
      if (seed === 1) {
        turnOf(e, p, ['закрыть'])
        expect(p.items.some((h) => h.name === 'Незаконные препараты')).toBe(false)
        continue
      }
      runs++
      turnOf(e, p, ['работать'])
      if (p.counters['облава']) { raids++; expect(p.inst?.kind).toBe('тюрьма'); expect(p.items.some((h) => h.name === 'Судимость')).toBe(true) }
    }
    expect(raids / runs).toBeGreaterThan(0.12)
    expect(raids / runs).toBeLessThan(0.5)
  })

  it('законное дело облаве не подлежит; при вольнице невольничий рынок даёт Д + 3 и −1 псих. каждый ход', () => {
    const { e, p } = lab(2, { vozm: 0, psy: 3 })
    Object.assign(country(e, p), { ideology: 'Вольница' })
    drive(gainItem(e.g, p, 'Невольничий рынок'))
    const D = income(e.g, p)
    turnOf(e, p)
    expect(p.vozm).toBe(D + 3 + 1) // вольница: делу +1
    expect(p.psy).toBe(2)
  })

  it('ЧВК: в войну Д + 3 вместо Д + 1; владельца не призывают', () => {
    const { e, p } = lab(3, { vozm: 0, psy: 3 })
    Object.assign(country(e, p), { ideology: 'Клептократия', war: true })
    drive(gainItem(e.g, p, 'ЧВК'))
    const D = income(e.g, p)
    turnOf(e, p)
    expect(p.vozm).toBeGreaterThanOrEqual(D + 3 - 1 - 2)
    expect(p.counters['облава']).toBeUndefined()
  })

  it('венчурная фирма: риск 1–2, на 5 растёт до +2, на 6 — до +3', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 80; seed++) {
      const { e, p } = lab(seed, { seg: 4 })
      country(e, p).ideology = 'Либеральная демократия'
      drive(gainItem(e.g, p, 'Венчурная фирма'))
      drive(businessAtEntry(e.g, p))
      const h = p.items.find((x) => x.name === 'Венчурная фирма')
      seen.add(!h ? 'прогорело' : String(h.bonus ?? 1))
    }
    expect([...seen].sort()).toEqual(['1', '2', '3', 'прогорело'])
  })

  it('Контора: дела по классу и закону страны; цена и сложность с поправками; провал — половина цены и −1 псих.', () => {
    const { e, p } = lab(4, { cls: 'Народ', vozm: 20, psy: 3 })
    country(e, p).ideology = 'Госсоциализм'
    expect(kontoraMenu(e.g, p).map((m) => m.name)).toEqual(['Кооператив', 'Фермерское хозяйство', 'Точка на рынке'])
    country(e, p).ideology = 'Вольница'
    const v = kontoraMenu(e.g, p)
    expect(v.find((m) => m.name === 'Точка на рынке')).toEqual({ name: 'Точка на рынке', price: 4, check: { stat: 'Смекалка', dc: 9 } })
    country(e, p).ideology = 'Клептократия'
    expect(kontoraMenu(e.g, p).find((m) => m.name === 'Точка на рынке')!.price).toBe(7)
    p.cls = 'Олигархи'
    country(e, p).ideology = 'Либеральная демократия'
    const names = kontoraMenu(e.g, p).map((m) => m.name)
    expect(names).toContain('Крупное предприятие')
    expect(names).toContain('Венчурная фирма')
    expect(names).not.toContain('Невольничий рынок')
    // Провал: Крупное предприятие, Смекалка 18 при Смекалке 0 — почти всегда провал.
    p.stats = { ...p.stats, 'Смекалка': 0 }
    const before = p.vozm
    drive(kontora(e.g, p), ['Крупное предприятие'])
    if (!p.items.some((h) => h.name === 'Крупное предприятие')) { expect(p.vozm).toBe(before - 11 + 5); expect(p.psy).toBe(2) }
  })

  it('Контора: одна попытка за отрезок, и черты Беспечность, Мера, Выдержка (±2) её закрывают', () => {
    const a = act('контора')
    const { e, p } = lab(5, { vozm: 20 })
    expect(gateOf(e.g, p, a)).toEqual({})
    p.character = [0, 0, 0, 0, 1, 0, 0] // Мера умеренно
    expect(gateOf(e.g, p, a)).toMatchObject({ need: 4, rolls: 1 })
    p.character = [0, 0, 0, 0, 1, 1, -1] // Мера, Выдержка, Беспечность — три проверки
    expect(gateOf(e.g, p, a)).toMatchObject({ need: 4, rolls: 3 })
    p.character = [0, 0, 0, 0, 0, 2, 0]
    expect(gateOf(e.g, p, a).closed).toContain('Выдержка')
    expect(a.perSeg).toBe(1)
  })
})
