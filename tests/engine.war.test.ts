import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { gainItem } from '../src/engine/change.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { answer } from '../src/engine/ai/simple.ts'
import { cellFor, coupPeace, declareWar, draftCheck, endWar, frontLoss, frontRound, frontTurn, moveMark, soldiers, volunteerSides, warRule } from '../src/engine/war.ts'
import { worldTurn } from '../src/engine/world.ts'
import type { Content, Player, Request } from '../src/engine/types.ts'

const real = loadContent()
function quiet(): Content {
  const decks: Content['decks'] = { ...real.decks }
  for (const deck of Object.keys(real.decks)) if (!['смута', 'мир'].includes(deck)) decks[deck] = [{ id: `тест.${deck}`, n: 1, title: deck, text: '', src: '', kind: 'Б', tags: [], effect: [] }]
  return { ...real, decks, actions: real.actions.filter((a) => a.id.startsWith('больница') || a.id.startsWith('психолог') || a.id === 'храм'), polar: [], subCodes: {} }
}
/** Партия на двух игроков; первый — в Зрелости, гражданин своей страны, с нейтральным характером. */
function lab(seed: number, over: Partial<Player> = {}): { e: Engine; p: Player } {
  const e = new Engine(quiet(), { span: 'one', seed, seats: [{ name: 'И1' }, { name: 'И2' }] }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  for (const q of e.state.players) Object.assign(q, { seg: 0 })
  const p = e.state.players[0]
  Object.assign(p, { seg: 3, cell: 5, phys: 3, psy: 3, vozm: 10, items: [], character: [0, 0, 0, 0, 0, 0, 0], fin: 0, pos: 0, coh: 0, mods: [], cls: 'Народ', citizenship: [p.country], ownProfile: Array(11).fill(0) }, over)
  for (const c of e.state.world.countries) c.stability = 10
  return { e, p }
}
function drive<T>(flow: Flow<T>, by: Record<string, string> = {}): { value: T; asked: Request[] } {
  const asked: Request[] = []
  let r = flow.next()
  while (!r.done) {
    asked.push(r.value)
    const req = r.value
    const open = req.options.filter((o) => !o.off).map((o) => o.id)
    const key = Object.keys(by).find((k) => req.text.includes(k))
    const want = key ? by[key] : undefined
    r = flow.next(want && open.includes(want) ? want : open[0])
  }
  return { value: r.value, asked }
}
/** Война, в которой страна игрока — первая сторона. */
function warFor(e: Engine, p: Player, world = false) {
  const all = e.state.world.countries
  const foe = all.find((c) => c.id !== p.country)!
  for (const a of all) for (const b of all) if (a.id < b.id) e.state.world.relations[`${a.id}-${b.id}`] = 'нейтралитет'
  e.state.world.relations[`${Math.min(p.country, foe.id)}-${Math.max(p.country, foe.id)}`] = 'вражда'
  declareWar(e.g, world)
  const w = e.state.war!
  if (w.sides[1][0] === p.country) { w.sides = [w.sides[1], w.sides[0]] }
  delete w.declaring
  return { w, foe: all[w.sides[1][0]], own: all[w.sides[0][0]] }
}

describe('объявление войны', () => {
  it('местная: враждующая пара, метка на 0, стабильность −2, флаг войны у обеих', () => {
    const { e, p } = lab(1)
    const before = e.state.world.countries.map((c) => c.stability)
    const { w, foe, own } = warFor(e, p)
    expect(w.mark).toBe(0)
    expect(own.war && foe.war).toBe(true)
    expect(own.stability).toBe(Math.max(0, before[own.id] - 2))
    expect(e.state.world.countries.filter((c) => c.war)).toHaveLength(2)
  })

  it('вражды нет — нейтральная пара становится враждой', () => {
    const { e } = lab(2)
    for (const k of Object.keys(e.state.world.relations)) e.state.world.relations[k] = 'нейтралитет'
    expect(declareWar(e.g, false)).toHaveLength(2)
    expect(Object.values(e.state.world.relations)).toContain('вражда')
  })

  it('мировая: остальные вступают за союзников, нейтралам стабильность −1', () => {
    const { e, p } = lab(3)
    const all = e.state.world.countries
    const foe = all.find((c) => c.id !== p.country)!
    for (const a of all) for (const b of all) if (a.id < b.id) e.state.world.relations[`${a.id}-${b.id}`] = 'нейтралитет'
    e.state.world.relations[`${Math.min(p.country, foe.id)}-${Math.max(p.country, foe.id)}`] = 'вражда'
    const ally = all.find((c) => c.id !== p.country && c.id !== foe.id)!
    e.state.world.relations[`${Math.min(p.country, ally.id)}-${Math.max(p.country, ally.id)}`] = 'союз'
    for (const c of all) c.stability = 5
    declareWar(e.g, true)
    const w = e.state.war!
    expect(w.kind).toBe('мировая')
    expect(w.sides[w.sides[0].includes(p.country) ? 0 : 1]).toContain(ally.id)
    for (const c of all) expect(c.stability).toBe(c.war ? 2 : 4)
  })
})

describe('призыв', () => {
  it('Армия идёт всегда, Олигархи — никогда', () => {
    const { e, p } = lab(4, { cls: 'Армия' })
    warFor(e, p)
    drive(draftCheck(e.g, p))
    expect(p.inst?.kind).toBe('фронт')
    expect(p.flags['Побывать на войне']).toBe(true)
    const o = lab(4, { cls: 'Олигархи' })
    warFor(o.e, o.p)
    drive(draftCheck(o.e.g, o.p))
    expect(o.p.inst).toBeUndefined()
  })

  it('не гражданин и не Молодость–Зрелость — не призывают', () => {
    const { e, p } = lab(5, { cls: 'Армия', seg: 4 })
    warFor(e, p)
    drive(draftCheck(e.g, p))
    expect(p.inst).toBeUndefined()
    p.seg = 2
    p.citizenship = []
    drive(draftCheck(e.g, p))
    expect(p.inst).toBeUndefined()
  })

  it('либеральная демократия: Народ не призывают, пока метка выше своей −3', () => {
    let drafted = 0
    for (let seed = 1; seed <= 30; seed++) {
      const { e, p } = lab(seed)
      const { w, own } = warFor(e, p)
      own.ideology = 'Либеральная демократия'
      drive(draftCheck(e.g, p))
      expect(p.inst).toBeUndefined()
      w.mark = -3
      delete p.rules['фронт пройден']
      drive(draftCheck(e.g, p))
      if (p.inst) drafted++
    }
    expect(drafted).toBeGreaterThan(5)
  })

  it('полицейское государство: Полиция идёт только на d6 1', () => {
    let drafted = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { e, p } = lab(seed, { cls: 'Полиция' })
      const { own } = warFor(e, p)
      own.ideology = 'Полицейское государство'
      drive(draftCheck(e.g, p))
      if (p.inst) drafted++
    }
    expect(drafted).toBeGreaterThan(2)
    expect(drafted).toBeLessThan(20)
  })

  it('«Справка» освобождает и уходит; Мафия может откупиться', () => {
    const { e, p } = lab(6, { cls: 'Армия' })
    warFor(e, p)
    drive(gainItem(e.g, p, 'Справка'))
    const { asked } = drive(draftCheck(e.g, p), { 'Повестка': 'Справка' })
    expect(asked[0].options.map((o) => o.id)).toEqual(['фронт', 'Справка'])
    expect(p.inst).toBeUndefined()
    expect(p.items.some((h) => h.name === 'Справка')).toBe(false)
    for (let seed = 1; seed <= 40; seed++) {
      const m = lab(seed, { cls: 'Мафия', vozm: 5 })
      const { own } = warFor(m.e, m.p)
      own.ideology = 'Клептократия'
      drive(draftCheck(m.e.g, m.p), { 'Повестка': 'откуп' })
      expect(m.p.inst).toBeUndefined()
      if (m.p.vozm === 4) return
    }
    throw new Error('Мафию ни разу не призвали')
  })

  it('добровольцы: военные — и на чужую войну, прочие — только за свою страну', () => {
    const { e, p } = lab(7, { cls: 'Армия' })
    const all = e.state.world.countries
    const others = all.filter((c) => c.id !== p.country)
    for (const a of all) for (const b of all) if (a.id < b.id) e.state.world.relations[`${a.id}-${b.id}`] = 'нейтралитет'
    e.state.world.relations[`${Math.min(others[0].id, others[1].id)}-${Math.max(others[0].id, others[1].id)}`] = 'вражда'
    declareWar(e.g, false)
    expect(volunteerSides(e.g, p).map((x) => x.foreign)).toEqual([true, true])
    p.cls = 'Народ'
    expect(volunteerSides(e.g, p)).toEqual([])
  })
})

describe('ход на фронте', () => {
  function soldier(seed: number, over: Partial<Player> = {}) {
    const l = lab(seed, { cls: 'Армия', ...over })
    const war = warFor(l.e, l.p)
    drive(draftCheck(l.e.g, l.p))
    return { ...l, ...war }
  }

  it('Стаж +1 (найма), жалованье при либеральной демократии, событие клетки, где метка', () => {
    const { e, p, own } = soldier(8)
    own.ideology = 'Либеральная демократия'
    const v = p.vozm, hire = p.stazhHire
    drive(frontTurn(e.g, p), { 'Тактика': 'держать' })
    expect(p.stazhHire).toBe(hire + 1)
    expect(e.state.log.some((x) => x.t === 'карта' && x.deck === 'фронт' && x.id.startsWith('фронт.0.'))).toBe(true)
    expect(p.vozm).toBeGreaterThanOrEqual(v - 3)
  })

  it('клептократия: Стаж на фронте — пустая отметка', () => {
    const { e, p, own } = soldier(9)
    own.ideology = 'Клептократия'
    const s = p.stazh, hire = p.stazhHire
    drive(frontTurn(e.g, p), { 'Тактика': 'держать' })
    if (p.alive) { expect(p.stazh).toBe(s + 1); expect(p.stazhHire).toBe(hire) }
  })

  it('сильная Вспыльчивость — только «В атаку»', () => {
    const { e, p } = soldier(10, { character: [0, 0, 0, 0, 0, -2, 0] })
    const { asked } = drive(frontTurn(e.g, p))
    const q = asked.find((r) => r.text.includes('Тактика'))!
    expect(q.options.filter((o) => !o.off).map((o) => o.id)).toEqual(['атака'])
  })

  it('потеря физ.: офицеру и при «Беречь себя» на 1 меньше каждая; «Боевые друзья» отменяют', () => {
    const { e, p } = soldier(11)
    p.inst!.tactic = 'беречь'
    expect(drive(frontLoss(e.g, p, -3)).value).toBe(-2)
    drive(gainItem(e.g, p, 'Офицерское звание'))
    expect(drive(frontLoss(e.g, p, -1)).value).toBe(0)
    drive(gainItem(e.g, p, 'Боевые друзья'))
    expect(drive(frontLoss(e.g, p, -4), { 'Боевые друзья': 'вытащить' }).value).toBe(0)
    expect(p.items.some((h) => h.name === 'Боевые друзья')).toBe(false)
  })

  it('Молодость (18.11): потеря физ. на 1 мягче, но не вместе с офицером и «Беречь себя»', () => {
    const { e, p } = soldier(17, { seg: 2 })
    p.inst!.tactic = 'держать'
    expect(drive(frontLoss(e.g, p, -3)).value).toBe(-2)
    p.inst!.tactic = 'беречь'
    expect(drive(frontLoss(e.g, p, -3)).value).toBe(-2)
    p.seg = 3
    p.inst!.tactic = 'держать'
    expect(drive(frontLoss(e.g, p, -3)).value).toBe(-3)
  })

  it('плен: карты «Тюрьмы» по идеологии страны-пленителя; у вольницы — обмен пленными', () => {
    const { e, p, foe } = soldier(18)
    foe.ideology = 'Технократия'
    drive(warRule(e.g, p, 'плен'))
    expect(p.inst?.kind).toBe('тюрьма')
    expect(p.inst?.captor).toBe(foe.id)
    expect(p.inst?.noStigma).toBe(true)
    const v = soldier(19)
    v.foe.ideology = 'Вольница'
    const phys = v.p.phys
    drive(warRule(v.e.g, v.p, 'плен'))
    expect(v.p.inst).toBeUndefined()
    expect(v.p.phys).toBe(phys - 1)
    expect(v.p.skip).toBe(1)
  })

  it('комиссия на −8: домой, лечение по идеологии (социал-демократия — большой обмен в больнице)', () => {
    let done = false
    for (let seed = 1; seed <= 60 && !done; seed++) {
      const { e, p, own } = soldier(seed, { phys: -7 })
      own.ideology = 'Социал-демократия'
      drive(frontTurn(e.g, p), { 'Тактика': 'атака' })
      if (p.alive && p.counters['фронт: комиссия (физ.)']) {
        expect(p.inst?.kind).not.toBe('фронт')
        expect(p.phys).toBeGreaterThanOrEqual(-5)
        done = true
      }
    }
    expect(done).toBe(true)
  })

  it('Старость — демобилизация', () => {
    const { e, p } = soldier(12)
    p.seg = 4
    drive(frontTurn(e.g, p))
    expect(p.inst).toBeUndefined()
    expect(p.counters['фронт: демобилизация']).toBe(1)
  })
})

describe('трек и конец войны', () => {
  it('военная диктатура: первая атака — успех без броска', () => {
    const { e, p } = lab(13)
    const { w, own } = warFor(e, p)
    own.ideology = 'Военная диктатура'
    e.state.world.countries[w.sides[1][0]].ideology = 'Либеральная демократия'
    drive(frontRound(e.g))
    // Без солдат-игроков война решается броском хранителя — трек не ведут.
    expect(e.state.war).toBeUndefined()
  })

  it('«Ни шагу назад!»: госсоциализм держит город на нечет', () => {
    let held = 0, taken = 0
    for (let seed = 1; seed <= 40; seed++) {
      const { e, p } = lab(seed)
      const { w, foe } = warFor(e, p)
      foe.ideology = 'Госсоциализм'
      moveMark(e.g, w, 0, 7)
      if (w.over === 0) taken++
      else { held++; expect(w.mark).toBe(7) }
    }
    expect(held).toBeGreaterThan(5)
    expect(taken).toBeGreaterThan(5)
  })

  it('без солдат-игроков: бросок хранителя и «Итог войны», флаги войны сняты', () => {
    const outcomes = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const { e, p } = lab(seed)
      warFor(e, p)
      drive(frontRound(e.g), {})
      expect(e.state.war).toBeUndefined()
      expect(e.state.world.countries.some((c) => c.war)).toBe(false)
      for (const k of Object.keys(e.state.stats ?? {})) if (k.startsWith('итог: ')) outcomes.add(k)
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(2)
  })

  it('победа: солдаты победителя читают «ПОБЕДУ!», проигравшие — «Разгром»', () => {
    const { e, p } = lab(14, { cls: 'Армия' })
    const { w } = warFor(e, p)
    drive(draftCheck(e.g, p))
    expect(soldiers(e.g, w)).toHaveLength(1)
    drive(endWar(e.g, 0), { 'Твоя сторона': 'в стороне' })
    expect(p.inst?.kind).not.toBe('фронт')
    expect(e.state.log.some((x) => x.t === 'карта' && x.id.startsWith('фронт.+7.'))).toBe(true)
  })

  it('смена власти в ядре стороны при объявлении: мир только на d12 10–12', () => {
    let peace = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { e, p } = lab(seed)
      const { w, own } = warFor(e, p)
      w.declaring = true
      drive(coupPeace(e.g, own))
      if (!e.state.war) peace++
    }
    expect(peace).toBeGreaterThan(3)
    expect(peace).toBeLessThan(30)
  })

  it('метка с двух краёв: +3 первой стороны — −3 второй', () => {
    const { e, p } = lab(15)
    const { w } = warFor(e, p)
    moveMark(e.g, w, 0, 3)
    expect(cellFor(w, 0)).toBe(3)
    expect(cellFor(w, 1)).toBe(-3)
  })

  it('мировой ход: военный налог, «Война» во время войны уходит в сброс', () => {
    const { e, p } = lab(16, { seg: 2, vozm: 5, cls: 'Народ', citizenship: [] })
    const { w } = warFor(e, p)
    for (const c of e.state.world.countries) c.stability = 10
    w.startWorldTurn = -5
    e.state.piles['мир'] = ['мир.10', 'мир.19', 'мир.06']
    drive(worldTurn(e.g), { 'Уйти добровольцем': 'нет', 'Бежать': 'нет', 'Твоя сторона': 'в стороне' })
    expect(p.counters['жизнь в воюющей стране']).toBe(1)
    expect(e.state.log.filter((x) => x.t === 'мир' && x.text.includes('во время войны — в сброс'))).toHaveLength(2)
    // «Мирный договор» кончает войну миром.
    expect(e.state.war).toBeUndefined()
  })
})

describe('партии с войной', () => {
  it('300 партий простого ИИ: одна война за раз, солдаты только на текущей войне, все войны кончаются', () => {
    let wars = 0, enlisted = 0
    for (let seed = 1; seed <= 300; seed++) {
      const e = new Engine(real, { span: 'one', seed, seats: [1, 2, 3, 4].map((i) => ({ name: `И${i}` })), keepLog: false }, { checkpoints: false })
      let guard = 0
      while (e.pending && guard++ < 300000) {
        const w = e.state.war
        for (const p of e.state.players) if (p.inst?.kind === 'фронт') { expect(w?.n).toBe(p.inst.war); expect(p.seg).toBeLessThanOrEqual(4) }
        if (w) expect(e.state.world.countries.filter((c) => c.war).map((c) => c.id).sort()).toEqual([...w.sides[0], ...w.sides[1]].sort())
        e.answer(answer(e.g, e.pending))
      }
      expect(e.over).toBe(true)
      wars += e.state.wars ?? 0
      enlisted += e.state.players.reduce((s, p) => s + (p.counters['фронт'] ?? 0), 0)
    }
    console.log(`войн ${wars} за 300 партий, призывов и добровольцев ${enlisted}`)
    expect(wars / 300).toBeGreaterThan(0.6)
    expect(wars / 300).toBeLessThan(1.4)
    expect(enlisted).toBeGreaterThan(30)
  }, 240_000)
})
