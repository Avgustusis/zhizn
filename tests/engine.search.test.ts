import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { cond } from '../src/engine/cond.ts'
import { enterInst, gainItem } from '../src/engine/change.ts'
import { sellPrice, sellThing } from '../src/engine/life.ts'
import { buyWeapon, leaflets, licenseAtPowerChange, nightSearch, search, verdict } from '../src/engine/search.ts'
import type { Ideo, Player, Request } from '../src/engine/types.ts'

const real = loadContent()
function lab(seed: number, ideology: Ideo = 'Либеральная демократия'): { e: Engine; p: Player } {
  const e = new Engine(real, { span: 'one', seed, seats: [{ name: 'И1' }, { name: 'И2' }] }, { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  for (const p of e.state.players) Object.assign(p, { seg: 3, country: 0, vozm: 10, psy: 3, phys: 3, items: [], cls: 'Народ' })
  e.state.world.countries[0].ideology = ideology
  return { e, p: e.state.players[0] }
}
function drive<T>(flow: Flow<T>): { value: T; asked: Request[] } {
  const asked: Request[] = []
  let r = flow.next()
  while (!r.done) { asked.push(r.value); r = flow.next(r.value.options.find((o) => !o.off)!.id) }
  return { value: r.value, asked }
}
const give = (e: Engine, p: Player, ...names: string[]) => { for (const n of names) drive(gainItem(e.g, p, n)) }
const names = (p: Player) => p.items.map((h) => h.name)
const action = (id: string) => real.actions.find((a) => a.id === id)!

describe('Оружие, лицензия, обыск', () => {
  it('таблица законности: по группам строя, «Лицензия», табельное у Армии и Полиции', () => {
    const { e, p } = lab(1)
    give(e, p, 'Ружьё охотника', 'Холодное оружие', 'Печатный станок')
    const [gun, blade, press] = p.items
    expect(verdict(e.g, p, blade, 'Либеральная демократия')).toBe('ok')
    expect(verdict(e.g, p, blade, 'Госсоциализм')).toBe('take')
    expect(verdict(e.g, p, blade, 'Военная диктатура')).toBe('record')
    expect(verdict(e.g, p, gun, 'Либеральная демократия')).toBe('take')
    expect(verdict(e.g, p, press, 'Клептократия')).toBe('record')
    expect(verdict(e.g, p, gun, 'Вольница')).toBe('ok')
    give(e, p, 'Лицензия')
    expect(verdict(e.g, p, gun, 'Либеральная демократия')).toBe('ok')
    expect(verdict(e.g, p, press, 'Клептократия')).toBe('ok')
    expect(verdict(e.g, p, gun, 'Полицейское государство')).toBe('record') // при ПГ лицензия не действует
    p.cls = 'Армия'
    expect(verdict(e.g, p, blade, 'Военная диктатура')).toBe('ok')
  })

  it('обыск: запрещённое изъято, «Судимость» одна; законное остаётся', () => {
    const { e, p } = lab(2, 'Военная диктатура')
    give(e, p, 'Холодное оружие', 'Ружьё охотника', 'Дробящее оружие', 'Друг')
    const friend = p.items[3].name
    const { value } = drive(search(e.g, p, 'тест'))
    expect(value).toBe(true)
    expect(names(p).filter((n) => n === 'Судимость')).toHaveLength(1)
    expect(names(p)).not.toContain('Холодное оружие')
    expect(names(p)).not.toContain('Дробящее оружие')
    expect(names(p)).toContain(friend)
  })

  it('арест: при входе в тюрьму — обыск', () => {
    const { e, p } = lab(3, 'Клептократия')
    give(e, p, 'Оружие со складов')
    enterInst(e.g, p, 'тюрьма', 2)
    expect(names(p)).not.toContain('Оружие со складов')
    expect(names(p)).toContain('Судимость')
  })

  it('«Ночной обыск»: в мягком строе без «Учёта» — обыскивают соседей, −1 псих.; в вольнице карты нет', () => {
    const { e, p } = lab(4, 'Социал-демократия')
    give(e, p, 'Ружьё охотника')
    drive(nightSearch(e.g, p))
    expect(p.psy).toBe(2)
    expect(names(p)).toContain('Ружьё охотника')
    give(e, p, 'Учёт')
    drive(nightSearch(e.g, p))
    expect(names(p)).not.toContain('Ружьё охотника')
    const card = Object.values(real.decks).flat().find((c) => c.id === 'страна.70')!
    expect(card.title).toBe('Ночной обыск')
    e.state.world.countries[0].ideology = 'Вольница'
    expect(cond(e.g, p, card.requires)).toBe(false)
  })

  it('рынок: «Лицензия» — не с «Судимостью», не при ВД, не вторая; ружьё — только с ней или в вольнице', () => {
    const { e, p } = lab(5)
    const lic = action('лицензия'), gun = action('купить: Ружьё охотника')
    expect(cond(e.g, p, lic.requires)).toBe(true)
    expect(cond(e.g, p, gun.requires)).toBe(false)
    give(e, p, 'Лицензия')
    expect(cond(e.g, p, lic.requires)).toBe(false)
    expect(cond(e.g, p, gun.requires)).toBe(true)
    e.state.world.countries[0].ideology = 'Военная диктатура'
    expect(cond(e.g, p, gun.requires)).toBe(false)
    e.state.world.countries[0].ideology = 'Вольница'
    p.items = []
    expect(cond(e.g, p, gun.requires)).toBe(true)
    expect(cond(e.g, p, lic.requires)).toBe(false)
    e.state.world.countries[0].ideology = 'Либеральная демократия'
    give(e, p, 'Судимость')
    expect(cond(e.g, p, lic.requires)).toBe(false)
  })

  it('стопка: оружия со складов одна копия — купить можно, пока она ни у кого', () => {
    const { e, p } = lab(6)
    const buy = action('купить: Оружие со складов')
    expect(cond(e.g, p, buy.requires)).toBe(true)
    give(e, e.state.players[1], 'Оружие со складов')
    expect(cond(e.g, p, buy.requires)).toBe(false)
  })

  it('облава на складе: d6 1 (при ГС, ВД, ПГ — d8 1–2); Мафии — без риска', () => {
    let raided = 0, harsh = 0, mafia = 0
    for (let seed = 1; seed <= 120; seed++) {
      const a = lab(seed)
      drive(buyWeapon(a.e.g, a.p, 'Взрывчатка'))
      if (!names(a.p).includes('Взрывчатка')) { raided++; expect(names(a.p)).toContain('Судимость') }
      const b = lab(seed, 'Госсоциализм')
      drive(buyWeapon(b.e.g, b.p, 'Взрывчатка'))
      if (!names(b.p).includes('Взрывчатка')) harsh++
      const c = lab(seed, 'Госсоциализм')
      c.p.cls = 'Мафия'
      drive(buyWeapon(c.e.g, c.p, 'Взрывчатка'))
      if (!names(c.p).includes('Взрывчатка')) mafia++
    }
    expect(raided).toBeGreaterThan(8); expect(raided).toBeLessThan(35)
    expect(harsh).toBeGreaterThan(18); expect(harsh).toBeLessThan(50)
    expect(mafia).toBe(0)
  })

  it('«Листовки»: в демократии — без страха; в диктатуре −1 псих., −1 физ., иногда обыск', () => {
    const a = lab(7)
    give(a.e, a.p, 'Печатный станок')
    drive(leaflets(a.e.g, a.p))
    expect([a.p.psy, a.p.phys]).toEqual([3, 3])
    let searched = 0
    for (let seed = 1; seed <= 60; seed++) {
      const b = lab(seed, 'Теократия')
      give(b.e, b.p, 'Печатный станок')
      drive(leaflets(b.e.g, b.p))
      expect([b.p.psy, b.p.phys]).toEqual([2, 2])
      if (!names(b.p).includes('Печатный станок')) searched++
    }
    expect(searched).toBeGreaterThan(3); expect(searched).toBeLessThan(25)
  })

  it('скупка: запрещённое — за треть цены вверх и без броска на «Судимость»', () => {
    const { e, p } = lab(8, 'Военная диктатура')
    give(e, p, 'Оружие со складов', 'Холодное оружие')
    const [store, blade] = p.items
    expect(sellPrice(e.g, p, store)).toBe(2)
    expect(sellPrice(e.g, p, blade)).toBe(1)
    const v = p.vozm
    drive(sellThing(e.g, p, store))
    expect(p.vozm).toBe(v + 2)
    expect(names(p)).not.toContain('Судимость')
    e.state.world.countries[0].ideology = 'Либеральная демократия'
    expect(sellPrice(e.g, p, blade)).toBe(2)
    // «Контрабанда из ядра» — своя цена (на периферии 6), правило трети её не трогает.
    give(e, p, 'Контрабанда из ядра')
    e.state.world.countries[0].pos = 'периферия'
    expect(sellPrice(e.g, p, p.items.find((h) => h.name === 'Контрабанда из ядра')!)).toBe(6)
  })

  it('«Лицензия» при смене власти: d6 1–3 — в сброс', () => {
    let lost = 0
    for (let seed = 1; seed <= 60; seed++) {
      const { e, p } = lab(seed)
      give(e, p, 'Лицензия')
      licenseAtPowerChange(e.g, p)
      if (!names(p).includes('Лицензия')) lost++
    }
    expect(lost).toBeGreaterThan(18); expect(lost).toBeLessThan(42)
  })
})
