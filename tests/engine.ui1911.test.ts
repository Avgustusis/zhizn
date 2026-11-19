import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { gainItem } from '../src/engine/change.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { answer } from '../src/engine/ai/simple.ts'
import { destCard, emigrate } from '../src/engine/emigration.ts'
import { gateNote, gateOf } from '../src/engine/turn.ts'
import { crisisCheck, powerChange, tooYoung } from '../src/engine/world.ts'
import type { Content, Player, Request } from '../src/engine/types.ts'

const real = loadContent()
function quiet(): Content {
  const decks: Content['decks'] = { ...real.decks }
  for (const deck of Object.keys(real.decks)) if (!['смута', 'мир'].includes(deck)) decks[deck] = [{ id: `тест.${deck}`, n: 1, title: deck, text: '', src: '', kind: 'Б', tags: [], effect: [] }]
  return { ...real, decks, polar: [], subCodes: {} }
}
function lab(seed: number, over: Partial<Player> = {}, seats = 2): { e: Engine; p: Player; q: Player } {
  const e = new Engine(quiet(), { mode: 'поколение', seed, seats: Array.from({ length: seats }, (_, i) => ({ name: `И${i + 1}` })) }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  const [p, q] = e.state.players
  for (const x of e.state.players) Object.assign(x, { country: p.country, seg: 3, vozm: 3, items: [], character: [0, 0, 0, 0, 0, 0, 0], cls: 'Народ', pos: 0, mods: [] })
  Object.assign(p, over)
  return { e, p, q }
}
function drive<T>(flow: Flow<T>, by: Record<string, string> = {}): { value: T; asked: Request[] } {
  const asked: Request[] = []
  let r = flow.next()
  while (!r.done) {
    asked.push(r.value)
    const req = r.value
    const open = req.options.filter((o) => !o.off).map((o) => o.id)
    const key = Object.keys(by).find((k) => req.text.includes(k))
    r = flow.next(key && open.includes(by[key]) ? by[key] : open[0])
  }
  return { value: r.value, asked }
}

describe('правки 19.11', () => {
  it('сторона в кризисе: Детство и Юность вне периферии — нейтрал без вопроса; с Молодости — выбор с шансом и последствиями', () => {
    const { e, p, q } = lab(1, { seg: 1 })
    const c = e.state.world.countries[p.country]
    c.pos = 'ядро'
    expect(tooYoung(p, c)).toBe(true)
    c.pos = 'периферия'
    expect(tooYoung(p, c)).toBe(false)
    c.pos = 'ядро'
    p.seg = 0
    Object.assign(c, { stability: -10 })
    const { asked } = drive(crisisCheck(e.g, c, false), { 'Твоя сторона': 'в стороне', 'Перейти': 'нет' })
    const sideQs = asked.filter((r) => r.text.includes('Твоя сторона'))
    expect(sideQs.map((r) => r.player)).toEqual([q.seat])
    const notes = sideQs[0].options.map((o) => o.note ?? '')
    expect(notes[0]).toMatch(/смена власти \d+%.*победителей/)
    expect(notes[2]).toContain('смена власти 50%')
  })

  it('новый отчуждённый после смены власти: строка с броском d6 в журнале', () => {
    const { e, p } = lab(2)
    const c = e.state.world.countries[p.country]
    Object.assign(c, { ideology: 'Либеральная демократия', dominant: 'Олигархи', alienated: 'Народ' })
    drive(powerChange(e.g, c), { 'Твоя сторона': 'в стороне', 'Перейти': 'нет' })
    expect(e.state.log.some((x) => x.t === 'мир' && /новый отчуждённый: d6 = \d → /.test(x.text))).toBe(true)
  })

  it('характер до выбора: ±2 — «Это против твоих убеждений», ±1 — «⚠ шанс 50%: d6 4–6»', () => {
    const { e, p } = lab(3)
    const bar = real.actions.find((a) => a.id === 'бар')!
    p.character = [0, 0, 0, 0, 2, 0, 0]
    expect(gateOf(e.g, p, bar).closed).toBe('Это против твоих убеждений (Мера сильно)')
    p.character = [0, 0, 0, 0, 1, 0, 0]
    expect(gateNote(gateOf(e.g, p, bar))).toBe('⚠ шанс 50%: d6 4–6 (Мера)')
    // Пункт «Знакомство» характером не закрывается.
    p.character = [2, 0, 0, 0, 0, 0, 0].map((_, i) => (i === 0 ? 2 : 0))
    expect(gateOf(e.g, p, real.actions.find((a) => a.id === 'знакомство')!)).toEqual({})
  })

  it('банк: кредит только при Стаже 3+, своём деле или Олигархах', () => {
    const bank = real.actions.find((a) => a.id === 'банк')!
    expect(bank.refuse?.text).toContain('Банк не верит')
  })

  it('окно эмиграции: можно ли, цена, шанс границы с поправками, что едет и что останется', () => {
    const { e, p } = lab(4, { vozm: 12, cls: 'Армия' })
    drive(gainItem(e.g, p, 'Диплом'))
    drive(gainItem(e.g, p, 'Присяга'))
    const home = e.state.world.countries[p.country]
    home.ideology = 'Либеральная демократия'
    const dest = e.state.world.countries.find((c) => c.id !== p.country)!
    e.state.world.relations[`${Math.min(p.country, dest.id)}-${Math.max(p.country, dest.id)}`] = 'союз'
    const card = destCard(e.g, p, dest, 'по своей воле').join('\n')
    expect(card).toContain('легально')
    expect(card).toMatch(/граница: 3d6 ≥ 12 \(союз \+2.*Диплом \+1.*→ \d+%/)
    expect(card).toContain('едет: «Диплом»')
    expect(card).toContain('останется: «Присяга»')
    e.state.world.relations[`${Math.min(p.country, dest.id)}-${Math.max(p.country, dest.id)}`] = 'вражда'
    expect(destCard(e.g, p, dest, 'по своей воле').join('\n')).toContain('⚠ вражда')
    const { asked } = drive(emigrate(e.g, p, { optional: true }), { 'Куда': 'нет' })
    expect(asked[0].options.find((o) => o.id === String(dest.id))?.note).toContain('‖')
  })

  it('сиделка: вопрос один раз при входе в Древность, дальше — настройка; переключатель в вопросе хода', () => {
    // Зерно 2: простой ИИ доживает до Древности.
    const e = new Engine(real, { mode: 'поколение', seed: 2, seats: [{ name: 'И1' }] }, { checkpoints: false })
    let entry = 0, toggles = 0
    while (e.pending) {
      const r = e.pending
      if (r.text.startsWith('Древность:')) entry++
      if (r.type === 'ход' && r.options.some((o) => o.id === 'сиделка')) toggles++
      e.answer(answer(e.g, r))
    }
    expect(e.state.players[0].seg).toBe(5)
    expect(entry).toBe(1)
    expect(toggles).toBeGreaterThan(0)
  })
})
