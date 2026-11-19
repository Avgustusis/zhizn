import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { gainItem } from '../src/engine/change.ts'
import { cond, newCtx } from '../src/engine/cond.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { pension } from '../src/engine/market.ts'
import { runRule } from '../src/engine/rules.ts'
import { priceOf } from '../src/engine/turn.ts'
import type { Content, Player, Request } from '../src/engine/types.ts'

const real = loadContent()
const act = (id: string) => real.actions.find((a) => a.id === id)!
function quiet(): Content {
  const decks: Content['decks'] = {}
  for (const deck of Object.keys(real.decks)) decks[deck] = [{ id: `тест.${deck}`, n: 1, title: deck, text: '', src: '', kind: 'Б', tags: [], effect: [] }]
  return { ...real, decks, polar: [], subCodes: {} }
}
function lab(seed: number, over: Partial<Player> = {}): { e: Engine; p: Player } {
  const e = new Engine(quiet(), { mode: 'поколение', seed, seats: [{ name: 'Опыт' }] }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  const p = e.state.players[0]
  Object.assign(p, { seg: 4, cell: 5, phys: 3, psy: 3, vozm: 5, items: [], character: [0, 0, 0, 0, 0, 0, 0], fin: 0, pos: 0, coh: 0, mods: [], cls: 'Народ', stazh: 10, stazhHire: 10, citizenship: [0], country: 0 }, over)
  return { e, p }
}
function drive<T>(flow: Flow<T>, pickId?: (r: Request) => string | undefined): { value: T; asked: Request[] } {
  const asked: Request[] = []
  let r = flow.next()
  while (!r.done) {
    asked.push(r.value)
    const open = r.value.options.filter((o) => !o.off).map((o) => o.id)
    const want = pickId?.(r.value)
    r = flow.next(want && open.includes(want) ? want : open[0])
  }
  return { value: r.value, asked }
}
const rule = (e: Engine, p: Player, name: string, arg?: string, by?: (r: Request) => string | undefined) => drive(runRule(e.g, p, name, arg, newCtx('карта')), by)

describe('этап 3г: правила карт', () => {
  it('развилка «Пенсия»: уйти — работы нет; работать дальше — пенсии нет; учить молодых — только Подработка', () => {
    const { e, p } = lab(1)
    expect(pension(e.g, p)).toBeGreaterThan(0)
    rule(e, p, 'пенсия')
    expect(cond(e.g, p, act('работа').requires)).toBe(false)
    expect(cond(e.g, p, act('подработка').requires)).toBe(false)
    rule(e, p, 'работа на пенсии')
    expect(pension(e.g, p)).toBe(0)
    expect(cond(e.g, p, act('работа').requires)).toBe(true)
    rule(e, p, 'учить молодых')
    expect(pension(e.g, p)).toBeGreaterThan(0)
    expect(cond(e.g, p, act('работа').requires)).toBe(false)
    expect(cond(e.g, p, act('подработка').requires)).toBe(true)
  })

  it('«оставить одну вещь»: остальные — в скупку по каталогу; фамильное серебро — Сплочённость −1', () => {
    const { e, p } = lab(2, { vozm: 0, coh: 1 })
    for (const n of ['Швейная машинка', 'Фамильное серебро', 'Книжный шкаф']) drive(gainItem(e.g, p, n))
    rule(e, p, 'оставить одну вещь', undefined, (r) => r.options.find((o) => o.label === 'Книжный шкаф')?.id)
    expect(p.items.map((h) => h.name)).toEqual(['Книжный шкаф'])
    expect(p.vozm).toBe(3 + 5)
    expect(p.coh).toBe(0)
  })

  it('«утрата близкого»: уходит один из близких; «отдать предмет» — статус или козырь на выбор', () => {
    const { e, p } = lab(3)
    drive(gainItem(e.g, p, 'Друг'))
    drive(gainItem(e.g, p, 'Значок'))
    const before = p.items.length
    rule(e, p, 'утрата близкого')
    expect(p.items.length).toBe(before - 1)
    expect(p.items.some((h) => h.name === 'Значок')).toBe(true)
    rule(e, p, 'отдать предмет')
    expect(p.items.some((h) => h.name === 'Значок')).toBe(false)
  })

  it('«отдать всё» и «Летопись»: за каждые 3 отданных возм. — отметка, до 3', () => {
    const { e, p } = lab(4, { vozm: 8 })
    rule(e, p, 'отдать всё', 'фонду заповедника')
    expect(p.vozm).toBe(0)
    rule(e, p, 'летопись', 'любому виду +1 за каждые 3 отданных возм., до 3')
    expect(e.state.chronicle?.at(-1)?.text).toContain('× 2')
  })

  it('«обряд дорожает»: обряд стоит 1 возм.', () => {
    const { e, p } = lab(5)
    expect(priceOf(e.g, p, act('обряд'))).toBe(0)
    rule(e, p, 'обряд дорожает', '«Перекочёвка» +1 возм. навсегда')
    expect(priceOf(e.g, p, act('обряд'))).toBe(1)
  })
})
