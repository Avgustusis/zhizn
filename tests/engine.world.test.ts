import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { enterInst, gainItem } from '../src/engine/change.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { acculturate, decayStigmas, distance, emigrate, naturalize, penaltyOf } from '../src/engine/emigration.ts'
import { crisisCheck, powerChange, worldTurn } from '../src/engine/world.ts'
import type { Content, Player, Request } from '../src/engine/types.ts'

const real = loadContent()
function quiet(): Content {
  const decks: Content['decks'] = { ...real.decks }
  for (const deck of Object.keys(real.decks)) if (!['смута', 'мир'].includes(deck)) decks[deck] = [{ id: `тест.${deck}`, n: 1, title: deck, text: '', src: '', kind: 'Б', tags: [], effect: [] }]
  return { ...real, decks, actions: [], polar: [], subCodes: {} }
}
function lab(seed: number, over: Partial<Player> = {}, seats = 1): { e: Engine; p: Player } {
  const e = new Engine(quiet(), { mode: 'поколение', seed, seats: Array.from({ length: seats }, (_, i) => ({ name: `И${i + 1}` })) }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  const p = e.state.players[0]
  Object.assign(p, { seg: 3, cell: 5, phys: 3, psy: 3, vozm: 10, items: [], character: [0, 0, 0, 0, 0, 0, 0], fin: 0, pos: 0, coh: 0, mods: [], cls: 'Народ' }, over)
  return { e, p }
}
/** Ответы по ключевым словам вопроса: { 'сторона': 'за' }; иначе — первый открытый вариант. */
function drive<T>(flow: Flow<T>, by: Record<string, string> = {}): { value: T; asked: Request[] } {
  const asked: Request[] = []
  let r = flow.next()
  while (!r.done) {
    asked.push(r.value)
    const open = r.value.options.filter((o) => !o.off).map((o) => o.id)
    const key = Object.keys(by).find((k) => r.done ? false : (r.value as Request).text.includes(k))
    const want = key ? by[key] : undefined
    r = flow.next(want && open.includes(want) ? want : open[0])
  }
  return { value: r.value, asked }
}

describe('кризис и смена власти', () => {
  it('без кризиса стабильность растёт на 1 минус дестабилизирующие факторы', () => {
    const { e } = lab(1)
    const c = e.state.world.countries[0]
    Object.assign(c, { stability: 10, alienated: 'Народ' })
    drive(crisisCheck(e.g, c, false))
    expect(c.stability).toBeLessThanOrEqual(10)
    Object.assign(c, { stability: 9, alienated: 'Армия', ideology: 'Либеральная демократия' })
    drive(crisisCheck(e.g, c, false))
    expect(c.stability).toBe(10)
  })

  it('смена власти: идеология по отчуждённому классу, классы по таблицам, стабильность 4, «Смута» каждому в стране', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { e, p } = lab(seed)
      const c = e.state.world.countries[p.country]
      Object.assign(c, { ideology: 'Либеральная демократия', dominant: 'Олигархи', alienated: 'Народ', stability: 2 })
      drive(powerChange(e.g, c), { 'Твоя сторона': 'в стороне', 'Перейти': 'нет' })
      expect(['Госсоциализм', 'Социал-демократия', 'Национализм', 'Вольница', 'Теократия']).toContain(c.ideology)
      expect(c.dominant).not.toBe(c.alienated)
      if (real.tables.crisis.close[c.ideology].includes('Народ')) expect(c.dominant).toBe('Народ')
      expect(c.powerChanges).toBe(1)
      expect(p.counters['смена власти']).toBe(1)
      expect(e.state.log.some((x) => x.t === 'карта' && x.deck === 'смута')).toBe(true)
    }
  })

  it('суровая новая власть: проигравшие идут в тюрьму, если карта не отменила правило', () => {
    let jailed = 0, total = 0
    for (let seed = 1; seed <= 40; seed++) {
      const { e, p } = lab(seed)
      const c = e.state.world.countries[p.country]
      Object.assign(c, { ideology: 'Либеральная демократия', dominant: 'Олигархи', alienated: 'Армия', stability: 2 })
      drive(powerChange(e.g, c, new Map([[p.seat, 'против' as const]])), { 'Перейти': 'нет' })
      expect(c.ideology).toBe('Военная диктатура')
      total++
      if (p.inst?.kind === 'тюрьма' || p.counters['тюрьма']) jailed++
    }
    expect(jailed / total).toBeGreaterThan(0.6) // три карты из двадцати отменяют правило
  })

  it('подавленный кризис: поддержавшим −2 возм. и «Учёт»', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { e, p } = lab(seed, { vozm: 0 })
      const c = e.state.world.countries[p.country]
      Object.assign(c, { stability: 0, ideology: 'Либеральная демократия' })
      drive(crisisCheck(e.g, c, true), { 'Твоя сторона': 'за' })
      if (c.suppressed) {
        expect(p.vozm).toBe(-2)
        expect(p.items.some((h) => h.name === 'Учёт')).toBe(true)
        return
      }
    }
    throw new Error('ни один кризис не был подавлен')
  })
})

describe('карта «Мир»', () => {
  it('мировой ход: каждый ход тянется одна карта «Мира», колода не кончается', () => {
    const { e } = lab(5)
    for (let i = 0; i < 30; i++) drive(worldTurn(e.g), { 'Твоя сторона': 'в стороне', 'куда': 'нет', 'Куда': 'нет' })
    expect(e.state.log.filter((x) => x.t === 'мир' && x.text.startsWith('«Мир»')).length).toBe(30)
    expect(e.state.worldTurns).toBe(30)
  })
})

describe('эмиграция', () => {
  it('по своей воле: цена по позиции страны, штраф за культурную дистанцию, класс — Народ, «Присяга» гаснет', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { e, p } = lab(seed, { cls: 'Армия', vozm: 10, psy: 5 })
      const home = e.state.world.countries[p.country]
      home.ideology = 'Либеральная демократия'
      const dest = e.state.world.countries.find((c) => c.id !== p.country && e.state.world.relations[`${Math.min(c.id, p.country)}-${Math.max(c.id, p.country)}`] === 'союз')
      if (!dest) continue
      drive(gainItem(e.g, p, 'Присяга'))
      const pen = penaltyOf(e.g, distance(e.g, p, dest))
      const price = real.tables.emigration.price[dest.pos]
      const { value } = drive(emigrate(e.g, p, { dest: dest.id }), { 'Граница': 'назад' })
      if (!value) continue
      expect(p.country).toBe(dest.id)
      expect(p.vozm).toBe(10 - price)
      expect(p.psy).toBe(5 + pen)
      expect(p.cls).toBe('Народ')
      expect(p.items.some((h) => h.name === 'Присяга')).toBe(false)
      expect(p.counters['эмиграция']).toBe(1)
      return
    }
    throw new Error('не нашлось партии с союзной страной и пройденной границей')
  })

  it('во враждебную страну легально нельзя: только нелегально, «Без документов»', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { e, p } = lab(seed, { vozm: 10 })
      e.state.world.countries[p.country].ideology = 'Либеральная демократия'
      const dest = e.state.world.countries.find((c) => c.id !== p.country && e.state.world.relations[`${Math.min(c.id, p.country)}-${Math.max(c.id, p.country)}`] === 'вражда')
      if (!dest) continue
      drive(emigrate(e.g, p, { dest: dest.id }))
      expect(p.country).toBe(dest.id)
      expect(p.items.some((h) => h.name === 'Без документов')).toBe(true)
      return
    }
    throw new Error('не нашлось враждебной страны')
  })

  it('аккультурация: шаг 3 — бикультурность, личный профиль — среднее с округлением к родной', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { e, p } = lab(seed, { seg: 2, psy: 3 })
      const dest = e.state.world.countries.find((c) => c.id !== p.country && !c.mainCultures.includes(p.culture))
      if (!dest) continue
      p.country = dest.id
      p.counters['аккультурация'] = 2
      p.counters['штраф дистанции'] = 0
      p.stats = { ...p.stats, 'Интеллект': 10 }
      const before = [...e.state.world.cultures[p.culture]]
      drive(acculturate(e.g, p), { 'Аккультурация': 'да', 'Шаг 3': 'би' })
      if ((p.counters['аккультурация'] ?? 0) < 3) continue
      expect(p.culture2).toBe(dest.mainCultures[0])
      const other = e.state.world.cultures[dest.mainCultures[0]]
      p.ownProfile!.forEach((v, i) => {
        const avg = (before[i] + other[i]) / 2
        expect(v).toBe(Number.isInteger(avg) ? avg : before[i] < other[i] ? Math.floor(avg) : Math.ceil(avg))
      })
      return
    }
    throw new Error('аккультурация ни разу не удалась')
  })

  it('натурализация: шаг 2 и Стаж 5 в стране', () => {
    const { e, p } = lab(7)
    const dest = e.state.world.countries.find((c) => c.id !== p.country)!
    p.country = dest.id
    p.counters['аккультурация'] = 2
    p.counters['Стаж здесь'] = 5
    p.stats = { ...p.stats, 'Смекалка': 12 }
    naturalize(e.g, p)
    expect(p.citizenship).toContain(dest.id)
  })
})

describe('стигмы гаснут', () => {
  it('«Судимость» — после целого отрезка без нарушений', () => {
    const { e, p } = lab(8, { seg: 2 })
    drive(gainItem(e.g, p, 'Судимость'))
    p.seg = 3
    decayStigmas(e.g, p)
    expect(p.items.some((h) => h.name === 'Судимость')).toBe(true) // отрезок ещё не прошёл целиком
    p.seg = 4
    decayStigmas(e.g, p)
    expect(p.items.some((h) => h.name === 'Судимость')).toBe(false)
  })

  it('«Судимость» не гаснет, если в прошлом отрезке была тюрьма', () => {
    const { e, p } = lab(9, { seg: 2 })
    drive(gainItem(e.g, p, 'Судимость'))
    p.seg = 3
    enterInst(e.g, p, 'тюрьма', 1)
    delete p.inst
    p.seg = 4
    decayStigmas(e.g, p)
    expect(p.items.some((h) => h.name === 'Судимость')).toBe(true)
  })
})

describe('партии с мировым ходом', () => {
  it('100 партий с простым ИИ: около 10 мировых ходов, кризисы и смены власти случаются', async () => {
    const { answer } = await import('../src/engine/ai/simple.ts')
    let changes = 0, turmoil = 0, lives = 0, emig = 0, wt = 0
    for (let seed = 1; seed <= 100; seed++) {
      const e = new Engine(real, { mode: 'поколение', seed, seats: [1, 2, 3, 4].map((i) => ({ name: `И${i}` })), keepLog: false }, { checkpoints: false })
      let guard = 0
      while (e.pending && guard++ < 100000) e.answer(answer(e.g, e.pending))
      expect(e.over).toBe(true)
      expect(e.state.worldTurns).toBeLessThanOrEqual(10) // партия кончается раньше, если живых не осталось
      wt += e.state.worldTurns
      changes += e.state.world.countries.reduce((s, c) => s + c.powerChanges, 0)
      for (const p of e.state.players) { lives++; turmoil += p.counters['смена власти'] ?? 0; emig += p.counters['эмиграция'] ?? 0 }
    }
    expect(wt / 100).toBeGreaterThan(9)
    expect(changes / 100).toBeGreaterThan(1)
    expect(turmoil).toBeGreaterThan(0)
    console.log(`смен власти на партию ${(changes / 100).toFixed(1)}; Смут на жизнь ${(turmoil / lives).toFixed(2)}; эмиграций на жизнь ${(emig / lives).toFixed(2)}`)
  }, 300000)
})

describe('десять идеологий (17.11)', () => {
  it('идеология против культуры — только при сильном положении культуры на полюсе из таблицы', async () => {
    const { againstCulture } = await import('../src/engine/setup.ts')
    const { e } = lab(40)
    const cult = 'Карвенцы' as const
    e.state.world.cultures[cult] = [0, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0] // сильная Иерархия
    expect(againstCulture(e.g, 'Либеральная демократия', cult)).toBe(true)
    e.state.world.cultures[cult] = [0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0] // умеренная — не против
    expect(againstCulture(e.g, 'Либеральная демократия', cult)).toBe(false)
    e.state.world.cultures[cult] = [0, 0, 0, -2, 0, 0, 0, 0, 0, 0, 0] // сильный Порядок
    expect(againstCulture(e.g, 'Вольница', cult)).toBe(true)
  })

  it('вольница: тюрем нет — «суд круга»; стабильность не выше 6', () => {
    const { e, p } = lab(41, { phys: 3, vozm: 5 })
    const c = e.state.world.countries[p.country]
    c.ideology = 'Вольница'
    enterInst(e.g, p, 'тюрьма', 3)
    expect(p.inst).toBeUndefined()
    expect([p.phys, p.vozm]).toEqual([1, 3])
    c.stability = 5
    drive(crisisCheck(e.g, { ...c, stability: 5 }, false))
    for (let i = 0; i < 10; i++) drive(crisisCheck(e.g, c, false))
    expect(c.stability).toBeLessThanOrEqual(6)
  })

  it('при подготовке у каждой страны одна из десяти идеологий, классы по её таблице', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) {
      const { e } = lab(seed)
      for (const c of e.state.world.countries) {
        seen.add(c.ideology)
        const row = real.tables.world.ideologyClasses[c.ideology]
        expect(row.dom.map(([, k]) => k)).toContain(c.dominant)
        if (c.ideology === 'Вольница') expect(c.stability).toBeLessThanOrEqual(6)
      }
    }
    expect(seen.size).toBe(10)
  })
})
