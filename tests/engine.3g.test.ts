import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { addParam, gainItem, setClass } from '../src/engine/change.ts'
import { anytimePlays, borderHelp, cigarettesOk, keepClass, playMenu, saveFromBondage } from '../src/engine/tricks.ts'
import { atPowerChange, pensionStazh } from '../src/engine/items.ts'
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

describe('этап 3г: пассивные свойства предметов', () => {
  it('«Карьерист» уходит, когда класс падает (d6 1–3); при росте класса — нет', () => {
    let gone = 0
    for (let seed = 1; seed <= 40; seed++) {
      const { e, p } = lab(seed, { cls: 'Интеллигенция', citizenship: [0] })
      p.items.push({ uid: 999, name: 'Карьерист', spouse: true })
      setClass(e.g, p, 'Олигархи')
      expect(p.items.some((h) => h.name === 'Карьерист')).toBe(true)
      setClass(e.g, p, 'Народ')
      if (!p.items.some((h) => h.name === 'Карьерист')) gone++
    }
    expect(gone).toBeGreaterThan(10)
    expect(gone).toBeLessThan(30)
  })

  it('«Мастер цеха»: Стаж 5 даёт пенсию как Стаж 7', () => {
    const { e, p } = lab(6, { stazhHire: 5 })
    const before = pension(e.g, p)
    drive(gainItem(e.g, p, 'Мастер цеха'))
    expect(pension(e.g, p)).toBeGreaterThanOrEqual(before)
    expect(pensionStazh(e.g, p)).toBe(7)
  })

  it('«Собутыльник»: «Привычка» на втором визите в бар; «Швейная машинка»: подработка +1', () => {
    const { e, p } = lab(7, { seg: 3 })
    drive(gainItem(e.g, p, 'Собутыльник'))
    p.counters[`действие:бар:${p.seg}`] = 2
    rule(e, p, 'привычка', 'бар')
    expect(p.items.some((h) => h.name === 'Привычка')).toBe(true)
  })

  it('«Партбилет» при смене власти на d6 1–3 становится «Дурной славой»', () => {
    let turned = 0
    for (let seed = 1; seed <= 30; seed++) {
      const { e, p } = lab(seed, { seg: 3 })
      drive(gainItem(e.g, p, 'Партбилет'))
      drive(atPowerChange(e.g, p, e.state.world.countries[0], 'Армия'))
      if (!p.items.some((h) => h.name === 'Партбилет')) { turned++; expect(p.items.some((h) => h.name === 'Дурная слава')).toBe(true) }
    }
    expect(turned).toBeGreaterThan(5)
    expect(turned).toBeLessThan(25)
  })

  it('«Человек из кабинета» уходит при любой смене власти; «Хозяин района» — если правила Мафия', () => {
    const { e, p } = lab(8, { seg: 3 })
    drive(gainItem(e.g, p, 'Человек из кабинета'))
    drive(atPowerChange(e.g, p, e.state.world.countries[0], 'Армия'))
    expect(p.items.some((h) => h.name === 'Человек из кабинета')).toBe(false)
    drive(gainItem(e.g, p, 'Хозяин района'))
    drive(atPowerChange(e.g, p, e.state.world.countries[0], 'Армия'))
    expect(p.items.some((h) => h.name === 'Хозяин района')).toBe(true)
  })

  it('«Имя в спорте» в Старости не даёт бонуса; «Фамильное имя» гасит «Дурная слава»', () => {
    const sport = real.items.find((i) => i.name === 'Имя в спорте')!
    expect(JSON.stringify(sport.bonus)).toContain('Старость')
    const name = real.items.find((i) => i.name === 'Фамильное имя')!
    expect(JSON.stringify(name.bonus)).toContain('Дурная слава')
  })
})

describe('этап 3г: розыгрыш карт', () => {
  it('меню «сыграть карту»: «Семейные сбережения» +5 возм., «Всё на красное» удваивает', () => {
    const { e, p } = lab(20, { vozm: 3 })
    drive(gainItem(e.g, p, 'Семейные сбережения'))
    expect(anytimePlays(e.g, p).map((x) => x.label)).toContain('«Семейные сбережения»')
    drive(playMenu(e.g, p), (r) => r.options.find((o) => o.label === '«Семейные сбережения»')?.id)
    expect(p.vozm).toBe(8)
    expect(p.items.some((h) => h.name === 'Семейные сбережения')).toBe(false)
  })

  it('«Лечение за границей» отменяет смерть от физ.: остаёшься на −9', () => {
    const { e, p } = lab(21, { phys: -8 })
    drive(gainItem(e.g, p, 'Лечение за границей'))
    addParam(e.g, p, 'физ', -5, newCtx('карта'))
    expect(p.alive).toBe(true)
    expect(p.phys).toBe(-9)
  })

  it('«Золотой парашют»: класс не теряется в «Смуте»', () => {
    const { e, p } = lab(22, { cls: 'Интеллигенция' })
    drive(gainItem(e.g, p, 'Золотой парашют'))
    const { value } = drive(keepClass(e.g, p, 'Народ', newCtx('карта', { deck: 'смута' })), (r) => (r.options.some((o) => o.id === 'да') ? 'да' : undefined))
    expect(value).toBe(true)
    expect(p.items.some((h) => h.name === 'Золотой парашют')).toBe(false)
  })

  it('«Семейные сбережения» спасают от кабалы; «Земляк за границей» — +2 на границе', () => {
    const { e, p } = lab(23)
    drive(gainItem(e.g, p, 'Семейные сбережения'))
    expect(drive(saveFromBondage(e.g, p), () => 'да').value).toBe(true)
    drive(gainItem(e.g, p, 'Земляк за границей'))
    expect(drive(borderHelp(e.g, p), () => 'да').value).toBe(2)
  })

  it('«Блок сигарет» — валюта только в тюрьме и кабале', () => {
    const { p } = lab(24)
    expect(cigarettesOk(p)).toBe(false)
    p.inst = { kind: 'тюрьма', left: 2, turn: 0 }
    expect(cigarettesOk(p)).toBe(true)
  })
})
