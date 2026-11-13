import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data/content.ts'
import { RULES, type Card, type Node } from '../src/data/schema.ts'
import { addParam, capacity, gainItem } from '../src/engine/change.ts'
import { chance, runCheck, situational } from '../src/engine/checks.ts'
import { cond, newCtx } from '../src/engine/cond.ts'
import type { Flow } from '../src/engine/core.ts'
import { Engine } from '../src/engine/engine.ts'
import { run } from '../src/engine/exec.ts'
import { happinessOf, settle } from '../src/engine/meaning.ts'
import { implementedRules } from '../src/engine/rules.ts'
import { playCard } from '../src/engine/turn.ts'
import type { Content, GameConfig, Player } from '../src/engine/types.ts'

const content = loadContent()
const config = (seed: number, seats = 4): GameConfig => ({ mode: 'поколение', seed, seats: Array.from({ length: seats }, (_, i) => ({ name: `Игрок ${i + 1}` })) })

/** Простой генератор для ответов «наугад» (не тот, что в движке: ответы не должны зависеть от его состояния). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000 }
}
/** Довести партию до конца, отвечая наугад среди открытых вариантов. */
function autoplay(e: Engine, seed: number, limit = 100000): number {
  const r = lcg(seed)
  let n = 0
  while (e.pending && n < limit) {
    const open = e.pending.options.filter((o) => !o.off)
    e.answer(open[Math.floor(r() * open.length)].id)
    n++
  }
  return n
}
/** Выполнить шаг правил, отвечая по списку (дальше — первым открытым вариантом). */
function drive<T>(flow: Flow<T>, answers: string[] = []): T {
  let r = flow.next()
  while (!r.done) r = flow.next(answers.shift() ?? r.value.options.find((o) => !o.off)!.id)
  return r.value
}
/** Партия с одним игроком, готовая к опытам: взрослый в Зрелости, без предметов, нейтральный характер. */
function lab(seed = 1, over: Partial<Player> = {}, c: Content = content): { e: Engine; p: Player } {
  const e = new Engine(c, config(seed, 1), { checkpoints: false })
  while (e.pending && e.pending.type !== 'ход') e.answer(e.pending.options.find((o) => !o.off)!.id)
  const p = e.state.players[0]
  Object.assign(p, { seg: 3, cell: 5, phys: 0, psy: 0, vozm: 0, items: [], character: [0, 0, 0, 0, 0, 0, 0], fin: 0, pos: 0, coh: 0, mods: [] }, over)
  delete p.meaning
  return { e, p }
}
const card = (effect: Node[], extra: Partial<Card> = {}): Card => ({ id: 'тест.01', n: 1, title: 'Тест', text: '', src: '', kind: 'Б', tags: [], effect, ...extra })

describe('поле', () => {
  it('188 клеток в шести отрезках, состав как в концепции', () => {
    const cells = content.board.segments.flatMap((s) => s.cells)
    expect(cells.length).toBe(188)
    expect(content.board.segments.map((s) => s.cells.length)).toEqual([30, 32, 32, 32, 32, 30])
    const n = (t: string) => cells.filter((c) => c.type === t).length
    expect([n('возраст'), n('отношения'), n('культура'), n('страна'), n('развилка'), n('судьба'), n('класс')]).toEqual([64, 30, 23, 26, 10, 6, 8])
    expect(cells.filter((c) => c.fork).map((c) => c.fork)).toEqual(['Образование', 'Эмиграция', 'Партнёрство', 'Ребёнок'])
  })
  it('у каждой напечатанной развилки есть карта, у каждой клетки с колодой — колода', () => {
    for (const c of content.board.segments.flatMap((s) => s.cells)) {
      if (c.fork) expect(content.decks['развилка'].some((x) => x.cell && x.title === c.fork), c.fork).toBe(true)
      const deck = content.tables.cellDeck[c.type]
      if (deck) expect(content.decks[deck]?.length, deck).toBeGreaterThan(0)
    }
  })
})

describe('партия', () => {
  it('одно зерно и одни ответы дают одну и ту же партию', () => {
    const a = new Engine(content, config(42), { checkpoints: false })
    const b = new Engine(content, config(42), { checkpoints: false })
    autoplay(a, 7); autoplay(b, 7)
    expect(a.over).toBe(true)
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
    const c = new Engine(content, config(43), { checkpoints: false })
    autoplay(c, 7)
    expect(JSON.stringify(c.state)).not.toBe(JSON.stringify(a.state))
  })

  it('сохранение посреди хода: загрузка продолжает ту же партию', () => {
    const a = new Engine(content, config(5))
    autoplay(a, 11, 137)
    const save = JSON.parse(JSON.stringify(a.save()))
    const b = Engine.load(content, save)
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state))
    expect(b.pending).toEqual(a.pending)
    autoplay(a, 3); autoplay(b, 3)
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state))
  })

  it('300 партий со случайными ответами доходят до конца, числа остаются в границах', () => {
    const todo: Record<string, number> = {}
    const ends = { смерть: 0, финал: 0, часы: 0 }
    const bySeg: Record<string, number> = {}
    let happy = 0, lives = 0, meaningful = 0
    for (let seed = 1; seed <= 300; seed++) {
      const e = new Engine(content, { ...config(seed), keepLog: false }, { checkpoints: false })
      autoplay(e, seed * 31)
      expect(e.over, `партия ${seed}`).toBe(true)
      for (const [k, v] of Object.entries(e.state.todo)) todo[k] = (todo[k] ?? 0) + v
      for (const p of e.state.players) {
        lives++
        happy += p.happiness
        if (p.meaning && p.meaning.id !== 'серость') meaningful++
        if (!p.alive) { ends.смерть++; bySeg[p.death!.seg] = (bySeg[p.death!.seg] ?? 0) + 1 } else if (p.finished) ends.финал++; else ends.часы++
        expect(p.phys).toBeGreaterThanOrEqual(-10); expect(p.phys).toBeLessThanOrEqual(10)
        expect(p.psy).toBeGreaterThanOrEqual(-10); expect(p.psy).toBeLessThanOrEqual(10)
        expect(p.vozm).toBeGreaterThanOrEqual(-15); expect(p.vozm).toBeLessThanOrEqual(20)
        for (const v of Object.values(p.stats)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(12) }
        for (const v of [p.fin, p.pos, p.coh]) expect(Math.abs(v)).toBeLessThanOrEqual(3)
        for (const v of p.character) expect(Math.abs(v)).toBeLessThanOrEqual(2)
        expect(p.happiness).toBeGreaterThanOrEqual(0); expect(p.happiness).toBeLessThanOrEqual(10)
        for (const kind of ['связь', 'статус', 'козырь', 'антикозырь', 'вещь']) {
          const held = p.items.filter((h) => !h.spouse && content.items.find((i) => i.name === h.name)!.kind === kind && content.items.find((i) => i.name === h.name)!.group !== 'Ребёнок').length
          // Ячейки считаются в момент получения; позже Харизма, Возможности и шкалы семьи могут упасть.
          if (kind === 'статус') expect(held).toBeLessThanOrEqual(content.tables.slots.statuses)
          if (kind === 'связь') expect(held).toBeLessThanOrEqual(5)
        }
      }
    }
    // Опись: какие особые правила встретились и ещё не написаны (этап 3).
    const known = new Set<string>(RULES)
    for (const k of Object.keys(todo)) expect(known.has(k), `неизвестное правило «${k}»`).toBe(true)
    console.log(`жизней ${lives}: смерть ${ends.смерть}, финал ${ends.финал}, часы ${ends.часы}; по отрезкам ${JSON.stringify(bySeg)}`)
    console.log(`счастье в среднем ${(happy / lives).toFixed(2)}; со своим смыслом ${Math.round((100 * meaningful) / lives)}%`)
    console.log('правила этапа 3: ' + Object.entries(todo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', '))
    expect(ends.смерть + ends.финал + ends.часы).toBe(lives)
  }, 120000)

  it('написанные правила есть в списке формата', () => {
    for (const r of implementedRules()) expect((RULES as readonly string[]).includes(r), r).toBe(true)
  })
})

describe('проверки', () => {
  it('шансы 3d6 совпадают с памяткой «Проверка»', () => {
    // Памятка округляет до процента; 37,5% и 62,5% лежат ровно между, поэтому допуск — полпроцента.
    const near = (stat: number, dc: number, pct: number, adv = 0) => expect(Math.abs(chance(dc - stat, adv) * 100 - pct), `${stat} против ${dc}`).toBeLessThanOrEqual(0.5001)
    near(0, 12, 38); near(2, 12, 62); near(4, 12, 84); near(6, 12, 95)
    near(2, 15, 26); near(4, 15, 50); near(6, 15, 74); near(8, 15, 91); near(10, 15, 98)
    near(2, 18, 5); near(4, 18, 16); near(8, 18, 62); near(12, 18, 95)
    near(2, 15, 49, 1); near(4, 15, 73, 1); near(6, 15, 90, 1)
    expect(chance(3)).toBe(1)
    expect(chance(19)).toBe(0)
  })

  it('ситуативные поправки складываются и срезаются до ±3', () => {
    const { e, p } = lab(3)
    const g = e.g
    // Характер: сильное Усердие (+2 #работа) и сильная Скромность (−2 #карьера).
    p.character = [2, 0, 0, 0, 0, 0, 2]
    const profile = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    p.ownProfile = profile
    const country = g.s.world.countries[p.country]
    Object.assign(country, { ideology: 'Либеральная демократия', dominant: 'Олигархи', alienated: 'Мафия', fashionIn: 'Аэлы', fashionOut: 'Кессы' })
    p.cls = 'Народ'; p.race = 'Лирены'
    expect(situational(g, p, 'Сила', newCtx('карта', { tags: ['#работа'] })).add).toBe(2)
    expect(situational(g, p, 'Сила', newCtx('карта', { tags: ['#карьера'] })).add).toBe(0) // Усердие +2, Скромность −2
    country.ideology = 'Госсоциализм' // ещё +1 #работа
    profile[3] = -2 // сильный Порядок: ещё +2 #работа → 5, потолок 3
    expect(situational(g, p, 'Сила', newCtx('карта', { tags: ['#работа'] })).add).toBe(3)
    // Колода «по полюсам»: бонус тега культуры не добавляется.
    expect(situational(g, p, 'Сила', newCtx('карта', { tags: ['#работа'], polar: true })).add).toBe(3)
    profile[3] = 0
    // Класс: доминирующему — преимущество в его тегах, отчуждённому — помеха.
    country.dominant = 'Народ'
    expect(situational(g, p, 'Сила', newCtx('карта', { tags: ['#работа'] })).adv).toBe(true)
    country.dominant = 'Армия'; country.alienated = 'Народ'
    expect(situational(g, p, 'Сила', newCtx('карта', { tags: ['#община'] })).dis).toBe(true)
  })

  it('предметы дают поправку по своим тегам; козырь идёт сверх потолка', () => {
    const { e, p } = lab(4, { pos: 2 })
    const g = e.g
    p.ownProfile = Array(11).fill(0)
    Object.assign(g.s.world.countries[p.country], { ideology: 'Военная диктатура', dominant: 'Армия', alienated: 'Мафия' })
    p.cls = 'Народ'
    drive(gainItem(g, p, 'Диплом'))
    expect(situational(g, p, 'Интеллект', newCtx('карта', { tags: ['#образование'] })).add).toBe(1)
    drive(gainItem(g, p, 'Знакомый врач'))
    p.stats['Выносливость'] = 0
    // Сложность 30 без козыря недостижима; «Знакомый врач» (+5 #здоровье) её не спасёт, но вопрос будет задан.
    const flow = runCheck(g, p, { stat: 'Выносливость', dc: 30 }, newCtx('карта', { tags: ['#здоровье'] }))
    const first = flow.next()
    expect(first.done).toBe(false)
    expect((first.value as { type: string }).type).toBe('козырь')
    const used = (first.value as { options: { id: string }[] }).options[0].id
    let r = flow.next(used)
    while (!r.done) r = flow.next('нет')
    expect(p.items.some((h) => h.name === 'Знакомый врач')).toBe(false)
    const ev = g.s.log.filter((x) => x.t === 'проверка').at(-1)!
    expect(ev.t === 'проверка' && ev.trump).toBe(5)
  })

  it('преимущество и помеха гасят друг друга; предрасположенность даёт преимущество', () => {
    const { e, p } = lab(5)
    p.predisp = 'Сила'
    p.ownProfile = Array(11).fill(0)
    drive(runCheck(e.g, p, { stat: 'Сила', dc: 15 }, newCtx('карта')))
    let ev = e.g.s.log.filter((x) => x.t === 'проверка').at(-1)!
    expect(ev.t === 'проверка' && ev.dice.length).toBe(4)
    drive(runCheck(e.g, p, { stat: 'Сила', dc: 15, mods: [{ dis: true }] }, newCtx('карта')))
    ev = e.g.s.log.filter((x) => x.t === 'проверка').at(-1)!
    expect(ev.t === 'проверка' && ev.dice.length).toBe(3)
  })
})

describe('числа, здоровье, смерть', () => {
  it('возрастной сдвиг правит только эффекты карт', () => {
    const { e, p } = lab(6)
    const g = e.g
    const hit = (seg: number, param: string, delta: number, source: 'карта' | 'действие' = 'карта') => {
      p.seg = seg; p.phys = 0; p.psy = 0
      addParam(g, p, param, delta, newCtx(source))
      return param === 'физ' ? p.phys : p.psy
    }
    expect(hit(0, 'физ', 2)).toBe(3)     // Детство: физ.+ на 1 больше
    expect(hit(0, 'псих', -2)).toBe(-3)  // Детство: псих.− на 1 сильнее
    expect(hit(1, 'псих', 1)).toBe(2)    // Юность: псих. на 1 сильнее в обе стороны
    expect(hit(1, 'псих', -1)).toBe(-2)
    expect(hit(2, 'физ', -1)).toBe(0)    // Молодость: физ.− на 1 мягче
    expect(hit(2, 'физ', -3)).toBe(-2)
    expect(hit(3, 'физ', -2)).toBe(-2)   // Зрелость: без сдвига
    expect(hit(4, 'физ', -2)).toBe(-3)   // Старость: физ.− на 1 сильнее
    expect(hit(4, 'физ', 1)).toBe(0)     // Старость: физ.+ на 1 слабее
    expect(hit(4, 'физ', -2, 'действие')).toBe(-2) // рынок без сдвига
  })

  it('потолки: события до 10, чудо до 12, рынок до 7; Возможности сгорают выше +15', () => {
    const { e, p } = lab(7)
    const g = e.g
    p.stats['Сила'] = 9
    addParam(g, p, 'Сила', 3, newCtx('карта'))
    expect(p.stats['Сила']).toBe(10)
    drive(run(g, p, [{ miracle: ['Сила'] }], newCtx('карта')))
    expect(p.stats['Сила']).toBe(12)
    expect(p.unsealed).toContain('Сила')
    p.stats['Ловкость'] = 6
    addParam(g, p, 'Ловкость', 3, newCtx('действие', { cap: 7 }))
    expect(p.stats['Ловкость']).toBe(7)
    p.stats['Харизма'] = 9
    addParam(g, p, 'Харизма', 1, newCtx('действие', { cap: 7 })) // рынок не опускает то, что выше его потолка
    expect(p.stats['Харизма']).toBe(9)
    p.cls = 'Народ'; p.vozm = 14
    addParam(g, p, 'возм', 5, newCtx('карта'))
    expect(p.vozm).toBe(15)
  })

  it('физ. −10 — смерть; рынок не убивает', () => {
    const a = lab(8)
    a.p.phys = -8
    addParam(a.e.g, a.p, 'физ', -5, newCtx('действие'))
    expect(a.p.alive).toBe(true)
    expect(a.p.phys).toBe(-9)
    expect(a.p.skip).toBe(1)
    addParam(a.e.g, a.p, 'физ', -5, newCtx('карта'))
    expect(a.p.alive).toBe(false)
    expect(a.p.death?.cause).toBe('физическое здоровье')
  })

  it('псих. −10: ребёнок — опека, подросток — срыв, затем отделение, взрослый — психбольница или смерть', () => {
    const child = lab(9, { seg: 0 })
    addParam(child.e.g, child.p, 'псих', -12, newCtx('карта'))
    expect([child.p.alive, child.p.psy, child.p.skip]).toEqual([true, -9, 1])
    const teen = lab(10, { seg: 1 })
    addParam(teen.e.g, teen.p, 'псих', -12, newCtx('карта'))
    expect([teen.p.alive, teen.p.psy, !!teen.p.inst]).toEqual([true, -9, false])
    addParam(teen.e.g, teen.p, 'псих', -5, newCtx('карта'))
    expect([teen.p.alive, teen.p.psy, teen.p.inst?.kind]).toEqual([true, -8, 'психбольница'])
    let saved = 0, dead = 0
    for (let seed = 1; seed <= 200; seed++) {
      const { e, p } = lab(seed)
      e.g.s.world.countries[p.country].pos = 'ядро'
      e.g.s.world.countries[p.country].ideology = 'Клептократия'
      addParam(e.g, p, 'псих', -12, newCtx('карта'))
      if (p.alive) { saved++; expect(p.inst?.kind).toBe('психбольница'); expect(p.psy).toBe(-8) } else dead++
    }
    // Ядро: d6 1–4 — психбольница, то есть две трети.
    expect(saved).toBeGreaterThan(110); expect(dead).toBeGreaterThan(40)
  })
})

describe('исполнитель карт', () => {
  it('параллельные d6 читают один бросок, вложенный d6 бросается заново', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { e, p } = lab(seed)
      const before = e.g.s.log.length
      const effect: Node[] = [
        { d6: { '1-3': [{ add: { 'Сила': 1 } }], '4-6': [{ add: { 'Ловкость': 1 } }] } },
        { d6: { '1-3': [{ add: { 'Харизма': 1 } }, { d6: { '1-6': [{ flag: 'вложенный' }] } }], '4-6': [{ add: { 'Мудрость': 1 } }] } },
      ]
      const was = { ...p.stats }
      drive(playCard(e.g, p, card(effect), 'тест'))
      const rolls = e.g.s.log.slice(before).filter((x) => x.t === 'бросок')
      const low = p.stats['Сила'] > was['Сила']
      // Обе части карты согласованы: либо обе «1–3», либо обе «4–6».
      expect(p.stats['Харизма'] > was['Харизма']).toBe(low)
      expect(p.stats['Мудрость'] > was['Мудрость']).toBe(!low)
      expect(rolls.length).toBe(low ? 2 : 1)
      expect(!!p.flags['вложенный']).toBe(low)
    }
  })

  it('выбор, условие варианта и условие «выбрал»', () => {
    const { e, p } = lab(11)
    const effect: Node[] = [
      { choose: [{ label: 'взять', if: { p: 'возм', gte: 5 }, then: [{ add: { 'возм': -5 } }] }, { label: 'отказаться', then: [{ add: { 'псих': -1 } }] }] },
      { if: { chose: 'отказаться' }, then: [{ flag: 'отказ' }] },
    ]
    const flow = playCard(e.g, p, card(effect), 'тест')
    const q = flow.next()
    expect(q.done).toBe(false)
    const options = (q.value as { options: { off?: string }[] }).options
    expect(options[0].off).toBeTruthy()
    let r = flow.next('1')
    while (!r.done) r = flow.next('нет')
    expect(p.psy).toBe(-1)
    expect(p.flags['отказ']).toBe(true)
  })

  it('колода «по полюсам»: при «сильно» псих., физ. и возм. в ветке полюса на 1 крупнее', () => {
    const effect: Node[] = [{ cases: [{ if: { culture: 'Коллективизм' }, then: [{ add: { 'псих': -2, 'Сплочённость': 1, 'возм': 1 } }] }], else: [{ add: { 'псих': 5 } }] }]
    const play = (lean: number, polar: boolean) => {
      const c: Content = { ...content, polar: polar ? ['тест'] : [] }
      const { e, p } = lab(12, {}, c)
      p.ownProfile = [lean, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      e.g.s.world.countries[p.country].ideology = 'Либеральная демократия'
      drive(playCard(e.g, p, card(effect), 'тест'))
      return [p.psy, p.coh, p.vozm]
    }
    expect(play(-1, true)).toEqual([-2, 1, 1])   // умеренно: как написано
    expect(play(-2, true)).toEqual([-3, 1, 2])   // сильно: псих. и возм. крупнее, Сплочённость нет
    expect(play(-2, false)).toEqual([-2, 1, 1])  // обычная колода: без поправки
    expect(play(1, true)).toEqual([5, 0, 0])     // другой полюс: ветка «иначе»
  })

  it('ячейки: без высокого положения семьи козырь взять некуда', () => {
    const { e, p } = lab(13)
    expect(capacity(e.g, p, 'козырь')).toBe(0)
    drive(gainItem(e.g, p, 'Старая услуга'))
    expect(p.items.length).toBe(0)
    p.fin = 1
    drive(gainItem(e.g, p, 'Старая услуга'))
    expect(p.items.map((h) => h.name)).toEqual(['Старая услуга'])
    // Вторая карта при одной ячейке: вопрос, что сбросить.
    const flow = gainItem(e.g, p, 'Справка')
    const q = flow.next()
    expect((q.value as { type: string }).type).toBe('сброс')
    flow.next('нет')
    expect(p.items.map((h) => h.name)).toEqual(['Старая услуга'])
  })

  it('Партнёр не приходит вторым; свадьба переворачивает карту', () => {
    const { e, p } = lab(14)
    drive(gainItem(e.g, p, 'Партнёр'))
    expect(cond(e.g, p, { has: 'Партнёр' })).toBe(true)
    const n = p.items.length
    drive(gainItem(e.g, p, 'Партнёр'))
    expect(p.items.length).toBe(n)
    drive(run(e.g, p, [{ rule: 'свадьба' }], newCtx('карта')))
    expect(cond(e.g, p, { has: 'Супруг(а)' })).toBe(true)
    expect(cond(e.g, p, { has: 'Партнёр' })).toBe(false)
    expect(p.counters['свадьба']).toBe(1)
  })
})

describe('смысл и счастье', () => {
  it('условие «соб.» помнится с рождения, «сост.» снимается, когда перестало выполняться', () => {
    const { e, p } = lab(15, { seg: 2 })
    const g = e.g
    const m = content.meanings.find((x) => x.conds.some((k) => k.kind === 'сост.' && 'p' in k.cond && k.cond.p === 'Сила'))
      ?? content.meanings.find((x) => x.conds.some((k) => k.kind === 'сост.' && 'p' in k.cond))!
    const k = m.conds.find((x) => x.kind === 'сост.' && 'p' in x.cond)!
    const c = k.cond as { p: string; gte?: number; lte?: number }
    p.meaning = { id: m.id, from: 'поиск', verdict: 0 }
    const others = () => happinessOf(g, p)
    const set = (v: number) => { if (c.p === 'возм') p.vozm = v; else if (c.p === 'физ') p.phys = v; else if (c.p === 'псих') p.psy = v; else (p.stats as Record<string, number>)[c.p] = v }
    set((c.gte ?? c.lte!) + (c.gte !== undefined ? -1 : 1))
    const without = others()
    set(c.gte ?? c.lte!)
    expect(others()).toBe(without + k.points)
    // «соб.»: условие всех карт сразу; выполнилось однажды — остаётся в памяти.
    const ev = content.meanings.flatMap((x) => x.conds).find((x) => x.kind === 'соб.' && 'reached' in x.cond && x.cond.reached === 'Зрелость')
    if (ev) {
      const key = JSON.stringify(ev.cond)
      settle(g, p); expect(p.achieved[key]).toBeUndefined()
      p.seg = 3; settle(g, p); expect(p.achieved[key]).toBe(true)
      p.seg = 2; settle(g, p); expect(p.achieved[key]).toBe(true)
    }
  })

  it('к Зрелости у каждого есть смысл или Серость; счастье Серости не выше 7', () => {
    let grey = 0, n = 0
    for (let seed = 500; seed < 560; seed++) {
      const e = new Engine(content, { ...config(seed), keepLog: false }, { checkpoints: false })
      autoplay(e, seed)
      for (const p of e.state.players) {
        if (p.seg < 3) continue
        n++
        expect(p.meaning, `партия ${seed}`).toBeTruthy()
        if (p.meaning!.id === 'серость') { grey++; expect(p.happiness).toBeLessThanOrEqual(7) }
      }
    }
    expect(n).toBeGreaterThan(20)
    console.log(`дошли до Зрелости ${n}, из них Серость ${grey} (${Math.round((100 * grey) / n)}%)`)
  }, 60000)
})
