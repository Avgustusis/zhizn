import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { newCtx } from '../src/engine/cond.ts'
import { gainItem } from '../src/engine/change.ts'
import { run } from '../src/engine/exec.ts'
import { classByRow, familyClass, familyRoll, gsClass, nationalize, suitcases } from '../src/engine/family.ts'
import { enterSegment } from '../src/engine/turn.ts'
import { grewUpCitizen } from '../src/engine/emigration.ts'
import { CULTURE_AXES } from '../src/data/schema.ts'
import type { Player, Request } from '../src/engine/types.ts'

const real = loadContent()
function lab(seed: number, patch: Partial<Player> = {}): { e: Engine; p: Player } {
  const e = new Engine(real, { span: 'one', seed, seats: [{ name: 'И1' }, { name: 'И2' }] }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  const p = e.state.players[0]
  Object.assign(p, { seg: 0, psy: 3, vozm: 3, items: [], fin: 0, coh: 0 }, patch)
  return { e, p }
}
function drive<T>(flow: Flow<T>): T {
  let r = flow.next()
  while (!r.done) r = flow.next((r.value as Request).options.find((o) => !o.off)!.id)
  return r.value
}
const card = (id: string) => Object.values(real.decks).flat().find((c) => c.id === id)!

describe('Перемены в семье (24.11)', () => {
  it('в Детстве и Юности класс игрока — класс семьи; ключи старого класса гаснут; позже меняется только класс семьи', () => {
    const { e, p } = lab(1, { cls: 'Армия', familyCls: 'Армия', seg: 1 })
    drive(gainItem(e.g, p, 'Присяга'))
    familyClass(e.g, p, 'Народ')
    expect([p.familyCls, p.cls]).toEqual(['Народ', 'Народ'])
    expect(p.items.some((h) => h.name === 'Присяга')).toBe(false)
    expect(p.psy).toBe(2) // понижение
    p.seg = 2
    familyClass(e.g, p, 'Мафия')
    expect([p.familyCls, p.cls]).toEqual(['Мафия', 'Народ'])
  })

  it('госсоциализм — без Олигархов: карта даёт Полицию', () => {
    const { e, p } = lab(2, { cls: 'Народ', familyCls: 'Народ' })
    e.state.world.countries[p.country].ideology = 'Госсоциализм'
    familyClass(e.g, p, 'Олигархи')
    expect(p.cls).toBe('Полиция')
  })

  it('класс по новой строке Финансов: есть в строке — остаётся, иначе d6 по строке', () => {
    const { e, p } = lab(3, { cls: 'Мафия', familyCls: 'Мафия', fin: 1 })
    classByRow(e.g, p)
    expect(p.cls).toBe('Мафия')
    p.fin = -3
    classByRow(e.g, p)
    expect(p.cls).toBe('Народ')
  })

  it('броски d10: удар по Финансам — от −2 до 0, перемена — Сплочённость от −1 до +1; шкалы в −3…+3', () => {
    const seen = new Set<number>()
    for (let seed = 1; seed <= 40; seed++) {
      const { e, p } = lab(seed, { fin: -3, coh: 3 })
      familyRoll(e.g, p, 'удар', 'Финансы')
      expect(p.fin).toBe(-3)
      p.fin = 0
      familyRoll(e.g, p, 'удар', 'Финансы')
      seen.add(p.fin)
      familyRoll(e.g, p, 'перемена')
      expect(p.coh).toBeGreaterThanOrEqual(2)
    }
    expect([...seen].sort()).toEqual([-1, -2, 0])
  })

  it('«Чемоданы»: из ядра — в полупериферию, класс сохраняется, Финансы +1; не из ядра — выше по позиции, Народ, Финансы −1', () => {
    let core = false, other = false
    for (let seed = 1; seed <= 40 && !(core && other); seed++) {
      const { e, p } = lab(seed, { cls: 'Интеллигенция', familyCls: 'Интеллигенция', fin: 0 })
      const from = e.state.world.countries[p.country]
      drive(suitcases(e.g, p))
      const to = e.state.world.countries[p.country]
      if (from.pos === 'ядро') { core = true; expect(to.pos).toBe('полупериферия'); expect(p.cls).toBe('Интеллигенция'); expect(p.fin).toBe(1) }
      else { other = true; expect(['ядро', 'полупериферия']).toContain(to.pos); expect(to.pos).not.toBe(from.pos); expect(p.cls).toBe('Народ'); expect(p.fin).toBe(-1) }
      expect(p.counters['аккультурация']).toBe(0)
    }
    expect(core && other).toBe(true)
    expect(JSON.stringify(card('возраст.детство.46').requires)).toContain('Госсоциализм')
  })

  it('восемь новых карт в колодах: Детство 46, Юность 47', () => {
    expect(real.decks['возраст.детство']).toHaveLength(46)
    expect(real.decks['возраст.юность']).toHaveLength(47)
    for (const id of ['возраст.детство.43', 'возраст.детство.44', 'возраст.детство.45', 'возраст.юность.44', 'возраст.юность.45', 'возраст.юность.46', 'возраст.юность.47'])
      expect(JSON.stringify(card(id).effect)).toMatch(/класс семьи|удар по семье|перемена в семье|класс по строке/)
  })
})

describe('«Великий крах», «Итог жизни», «Потери» (24.11)', () => {
  it('крах: Олигарху в ядре и при ЛД, СД, технократии −1; ниже нуля — «Долг», на входе в следующий отрезок одна проверка', () => {
    const crash = card('мир.20')
    const play = (seed: number, ideology: string, vozm: number) => {
      const r = lab(seed, { cls: 'Олигархи', familyCls: 'Олигархи', vozm, seg: 3, cell: 0 })
      const c = r.e.state.world.countries[r.p.country]
      Object.assign(c, { ideology, pos: 'полупериферия' })
      drive(run(r.e.g, r.p, crash.effect, newCtx('карта', { card: crash.id })))
      return r
    }
    const ld = play(5, 'Либеральная демократия', 2)
    expect([ld.p.vozm, ld.p.cls, ld.p.items.some((h) => h.name === 'Долг')]).toEqual([1, 'Олигархи', false])
    const nat = play(6, 'Национализм', 1)
    expect([nat.p.vozm, nat.p.cls, nat.p.items.some((h) => h.name === 'Долг')]).toEqual([-2, 'Олигархи', true])
    // Следующий отрезок: всё ещё ниже нуля — Народ, «Долг» остаётся.
    nat.p.seg = 4; nat.p.psy = 3
    drive(enterSegment(nat.e.g, nat.p))
    expect(nat.p.cls).toBe('Народ')
    expect(nat.p.items.some((h) => h.name === 'Долг')).toBe(true)
    // Выкарабкался: «Долг» снят, класс сохранён.
    const ok = play(7, 'Национализм', 1)
    ok.p.vozm = 2; ok.p.seg = 4
    drive(enterSegment(ok.e.g, ok.p))
    expect([ok.p.cls, ok.p.items.some((h) => h.name === 'Долг')]).toEqual(['Олигархи', false])
  })


  it('«Итог жизни»: на входе в Старость — смысла нет: −1; выполнен меньше чем наполовину: −2; иначе — ничего', () => {
    const r = real.tables.lifeReview
    const a = lab(7, { seg: 4, cell: 0, psy: 0 })
    delete a.p.meaning
    drive(enterSegment(a.e.g, a.p))
    expect(a.p.psy).toBe(r.none)
    const b = lab(8, { seg: 4, cell: 0, psy: 0 })
    b.p.meaning = { id: 'смысл.03', from: 'поиск', verdict: 0 }
    b.p.cls = 'Народ'
    b.p.stats['Харизма'] = 1
    drive(enterSegment(b.e.g, b.p))
    expect(b.p.psy).toBe(r.half)
  })

  it('«Потери»: по полюсу Влюбчивость ↔ Верность; смерть партнёра Влюбчивость не смягчает', async () => {
    const { dropHeld } = await import('../src/engine/change.ts')
    const loss = (axis: number, name: string, opts: { spouse?: boolean; death?: boolean } = {}) => {
      const { e, p } = lab(9, { seg: 3, psy: 0 })
      p.character = [0, 0, axis, 0, 0, 0, 0]
      const h = { uid: 7001, name, ...(opts.spouse ? { spouse: true as const } : {}) }
      p.items.push(h)
      drive(dropHeld(e.g, p, h, false, !!opts.death))
      return p.psy
    }
    const partner = real.items.find((i) => i.group === 'Партнёр')!.name
    const friend = real.items.find((i) => i.group === 'Друг')!.name
    const acq = real.items.find((i) => i.kind === 'знакомый')!.name
    expect(loss(1, partner)).toBe(-5)
    expect(loss(0, partner)).toBe(-3)
    expect(loss(-1, partner)).toBe(-1)
    expect(loss(-1, partner, { death: true })).toBe(-3)
    expect(loss(1, friend)).toBe(-3)
    expect(loss(0, friend)).toBe(-2)
    expect(loss(-2, acq)).toBe(-1)
  })

})

describe('Олигархи при госсоциализме (24.11)', () => {
  it('страна стала госсоциализмом: Олигарх — d8 1: Полиция или Мафия, 2–8: Народ; «Офшор» сохраняет возможности', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const { e, p } = lab(seed, { cls: 'Олигархи', familyCls: 'Олигархи', seg: 3, vozm: 12 })
      p.items.push({ uid: 8001, name: 'Офшор' })
      e.state.world.countries[p.country].ideology = 'Госсоциализм'
      drive(nationalize(e.g, p.country))
      expect(['Народ', 'Полиция', 'Мафия']).toContain(p.cls)
      expect(p.vozm).toBe(12)
      seen.add(p.cls)
    }
    expect(seen.has('Народ')).toBe(true)
  })

  it('карта даёт Олигархов при госсоциализме — Полиция; иначе — Олигархи', () => {
    const { e, p } = lab(3)
    e.state.world.countries[p.country].ideology = 'Госсоциализм'
    expect(gsClass(e.g, p, 'Олигархи')).toBe('Полиция')
    e.state.world.countries[p.country].ideology = 'Клептократия'
    expect(gsClass(e.g, p, 'Олигархи')).toBe('Олигархи')
  })

  it('переход по выбору Олигарху открыт; ИИ-Олигарх уходит только при сильной черте и на d6 1–3', async () => {
    const { oligarchOffer } = await import('../src/engine/ai/index.ts')
    const { e, p } = lab(5, { cls: 'Олигархи', seg: 3 })
    const asked: import('../src/engine/types.ts').Request[] = []
    const flow = run(e.g, p, [{ allowCls: 'Интеллигенция' }], newCtx('карта'))
    for (let r = flow.next(); !r.done; r = flow.next('нет')) asked.push(r.value)
    expect(asked).toHaveLength(1)
    const req = asked[0]
    p.character = [0, 0, 0, 0, 0, 0, 0]
    expect(oligarchOffer(e.g, req)).toBe('нет')
    p.character = [2, 0, 0, 0, 0, 0, 0] // сильная Скромность
    let left = 0
    for (let n = 0; n < 60; n++) if (oligarchOffer(e.g, { ...req, n }) === 'да') left++
    expect(left).toBeGreaterThan(15); expect(left).toBeLessThan(45)
  })


  it('«Наследство незнакомца» при госсоциализме — +3 возм., класс не меняется', () => {
    const c = card('судьба.24')
    const { e, p } = lab(4, { cls: 'Народ', seg: 3, vozm: 5 })
    e.state.world.countries[p.country].ideology = 'Госсоциализм'
    drive(run(e.g, p, c.effect, newCtx('карта', { card: c.id })))
    expect([p.vozm, p.cls]).toEqual([8, 'Народ'])
  })

  it('выросшие в стране (25.11): гражданство на входе в Молодость, своё остаётся; сильный Этноцентризм — шаг 2+ или Смекалка 10', () => {
    const ax = CULTURE_AXES.findIndex(([a]) => a === 'Этноцентризм')
    const setup = (seed: number, ethno: number) => {
      const r = lab(seed, { seg: 2, cls: 'Народ', familyCls: 'Народ' })
      const dest = r.e.state.world.countries.find((c) => c.id !== r.p.birthCountry && !['Национализм', 'Военная диктатура'].includes(c.ideology))!
      r.p.country = dest.id
      r.p.counters['аккультурация'] = 0
      r.e.state.world.cultures[dest.mainCultures[0]][ax] = ethno
      r.e.state.world.relations = {}
      return { ...r, dest }
    }
    const a = setup(1, 0)
    grewUpCitizen(a.e.g, a.p)
    expect(a.p.citizenship).toEqual([a.p.birthCountry, a.dest.id])
    // Сильный Этноцентризм, шаг 2 — без проверки.
    const b = setup(2, -2); b.p.counters['аккультурация'] = 2
    grewUpCitizen(b.e.g, b.p)
    expect(b.p.citizenship).toContain(b.dest.id)
    // Сильный Этноцентризм, шаг 0: проверка Смекалки 10 — с −20 не пройти, с +20 не провалить.
    const c = setup(3, -2); c.p.stats['Смекалка'] = -20
    grewUpCitizen(c.e.g, c.p)
    expect(c.p.citizenship).toEqual([c.p.birthCountry])
    const d = setup(4, -2); d.p.stats['Смекалка'] = 20
    grewUpCitizen(d.e.g, d.p)
    expect(d.p.citizenship).toContain(d.dest.id)
    // Вход в Молодость: гражданство — до «Присяги» (армейская семья получает вопрос).
    const e = setup(5, 0); Object.assign(e.p, { cls: 'Армия', familyCls: 'Армия' })
    let asked = false
    const flow = enterSegment(e.e.g, e.p)
    let r = flow.next()
    while (!r.done) { const q = r.value as Request; if (q.text.startsWith('Присяга')) asked = true; r = flow.next(q.options.find((o) => !o.off)!.id) }
    expect(e.p.citizenship).toContain(e.dest.id)
    expect(asked).toBe(true)
  })
})
