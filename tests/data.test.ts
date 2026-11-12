import { describe, expect, it } from 'vitest'
import { allCards, decks } from '../src/data/index.ts'
import { meanings } from '../src/data/meanings.ts'
import { items, itemNames } from '../src/data/items.ts'
import { heirs } from '../src/data/heirs.ts'
import { CLASSES } from '../src/data/schema.ts'
import type { Card, Node } from '../src/data/schema.ts'

/** Имена предметов: карты каталога и стопки людей. */
function catalogNames(): Set<string> {
  return itemNames
}

/** Все шаги карты: эффект, часть страны (Мир), строки сторон (Смута). */
function* walkCard(c: Card): Generator<Node> {
  yield* walk(c.effect)
  if (c.country) yield* walk(c.country)
  if (c.sides) { yield* walk(c.sides.win); yield* walk(c.sides.lose); yield* walk(c.sides.neutral) }
}

function* walk(nodes: Node[]): Generator<Node> {
  for (const n of nodes) {
    yield n
    if ('check' in n) { yield* walk(n.success); yield* walk(n.failure) }
    if ('choose' in n) for (const o of n.choose) yield* walk(o.then)
    if ('d6' in n) for (const t of Object.values(n.d6)) yield* walk(t)
    if ('if' in n) { yield* walk(n.then); if (n.else) yield* walk(n.else) }
    if ('cases' in n) { for (const c of n.cases) yield* walk(c.then); if (n.else) yield* walk(n.else) }
    if ('later' in n) yield* walk(n.later.then)
    if ('cancelable' in n) yield* walk(n.then)
    if ('useTrump' in n) { yield* walk(n.then); yield* walk(n.else) }
    if ('installments' in n) yield* walk(n.each)
    if ('everySeg' in n) yield* walk(n.everySeg)
  }
}

describe('карты', () => {
  it('колоды загружены', () => {
    expect(decks.length).toBeGreaterThan(0)
  })

  it('id уникальны', () => {
    const ids = allCards.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('предметы есть в каталоге', () => {
    const names = catalogNames()
    const unknown = allCards.flatMap((c) =>
      [...walkCard(c)].flatMap((n) => ('gain' in n ? [n.gain] : 'lose' in n ? [n.lose] : [])).filter((x) => !names.has(x)).map((x) => `${c.id}: ${x}`))
    expect(unknown).toEqual([])
  })

  it('предметы в условиях и отменах тоже есть в каталоге', () => {
    const names = catalogNames()
    const conds = (x: unknown): string[] =>
      x && typeof x === 'object'
        ? Object.entries(x).flatMap(([k, v]) => (k === 'has' && typeof v === 'string' ? [v] : conds(v)))
        : []
    const unknown = allCards.flatMap((c) =>
      [...conds(c.effect), ...conds(c.country), ...conds(c.sides), ...conds(c.requires), ...(c.cancelBy ?? [])].filter((x) => !names.has(x)).map((x) => `${c.id}: ${x}`))
    expect(unknown).toEqual([])
  })

  it('исходы d6 в пределах 1–6 и не пересекаются', () => {
    const bad: string[] = []
    for (const c of allCards) for (const n of walkCard(c)) {
      if (!('d6' in n)) continue
      const seen = new Set<number>()
      for (const r of Object.keys(n.d6)) {
        const [a, b = a] = r.split('-').map(Number)
        if (a < 1 || b > 6 || a > b) bad.push(`${c.id}: ${r}`)
        for (let v = a; v <= b; v++) { if (seen.has(v)) bad.push(`${c.id}: ${v} дважды`); seen.add(v) }
      }
    }
    expect(bad).toEqual([])
  })

  it('сложность проверок — 12, 15 или 18 (вступительные — 16)', () => {
    // Исключение: вступительные на «Образовании» — 16.
    const ok = (c: { id: string }, dc: number) => [12, 15, 18].includes(dc) || (c.id === 'развилка.01' && dc === 16)
    const bad = allCards.flatMap((c) => [...walkCard(c)].flatMap((n) => ('check' in n && !ok(c, n.check.dc) ? [`${c.id}: ${n.check.dc}`] : [])))
    expect(bad).toEqual([])
  })

  it('тип карты совпадает с разбором: П — есть проверка, Р — есть выбор', () => {
    const bad = allCards.filter((c) => {
      const nodes = [...walkCard(c)]
      if (c.kind === 'П') return !nodes.some((n) => 'check' in n)
      if (c.kind === 'Р') return !nodes.some((n) => 'choose' in n)
      return false
    }).map((c) => `${c.id} (${c.kind})`)
    expect(bad).toEqual([])
  })
})

describe('смыслы', () => {
  it('101 карта: Серость, 70 Случайных, 30 Династий', () => {
    expect(meanings.filter((m) => m.deck === 'Серость').length).toBe(1)
    expect(meanings.filter((m) => m.deck === 'Случайные').length).toBe(70)
    expect(meanings.filter((m) => m.deck === 'Династии').length).toBe(30)
  })

  it('очки: Серость 7, остальные 10; число условий по сложности', () => {
    const shape = { 'Серость': [10, 7], 'Простой': [10, 10], 'Средний': [5, 10], 'Сложный': [4, 10] } as const
    const bad = meanings.filter((m) => {
      const [count, sum] = shape[m.difficulty]
      return m.conds.length !== count || m.conds.reduce((s, c) => s + c.points, 0) !== sum
    }).map((m) => m.id)
    expect(bad).toEqual([])
  })

  it('у всех Династий есть требование; необычных смыслов 5', () => {
    expect(meanings.filter((m) => m.deck === 'Династии' && !m.requires).map((m) => m.id)).toEqual([])
    expect(meanings.filter((m) => m.unusual).length).toBe(5)
  })

  it('предметы в условиях есть в каталоге', () => {
    const names = catalogNames()
    const conds = (x: unknown): string[] =>
      x && typeof x === 'object'
        ? Object.entries(x).flatMap(([k, v]) =>
            k === 'has' && typeof v === 'string' ? [v] : k === 'countOf' ? (v as string[]) : k === 'count' && typeof v === 'string' ? [v] : conds(v))
        : []
    const unknown = meanings.flatMap((m) => conds([m.conds.map((c) => c.cond), m.requires]).filter((x) => !names.has(x)).map((x) => `${m.id}: ${x}`))
    expect(unknown).toEqual([])
  })
})

describe('предметы', () => {
  it('число карт по видам, как в документе', () => {
    const copies = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).reduce((s, i) => s + i.copies, 0)
    const cat = (kind: string) => copies((i) => i.deck === 'каталог' && i.kind === kind)
    expect([cat('связь'), cat('статус'), cat('козырь'), cat('стигма'), cat('вещь'), cat('дело')]).toEqual([27, 19, 9, 16, 29, 12])
    expect(copies((i) => i.deck === 'Верхи')).toBe(15)
    expect(copies((i) => i.deck === 'Дно')).toBe(10)
  })

  it('имена уникальны; у антикозырей есть катастрофа, у козырей — способ сыграть', () => {
    expect(new Set(items.map((i) => i.name)).size).toBe(items.length)
    expect(items.filter((i) => i.kind === 'антикозырь' && !i.risk && !i.riskRule).map((i) => i.name)).toEqual([])
    expect(items.filter((i) => (i.kind === 'козырь' || i.kind === 'антикозырь') && !i.play?.length).map((i) => i.name)).toEqual([])
  })

  it('предметы, которые дают сами предметы, есть в каталоге', () => {
    const names = (x: unknown): string[] =>
      x && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => ((k === 'gain' || k === 'lose' || k === 'has') && typeof v === 'string' ? [v] : names(v))) : []
    expect(items.flatMap((i) => names(i).filter((n) => !itemNames.has(n)).map((n) => `${i.name}: ${n}`))).toEqual([])
  })
})

describe('наследники', () => {
  it('12 карт: по две на класс, у каждой 8 характеристик и 6 условий', () => {
    expect(heirs.length).toBe(12)
    for (const c of CLASSES) expect(heirs.filter((h) => h.cls === c).map((h) => h.n)).toEqual([1, 2])
    expect(heirs.filter((h) => Object.keys(h.stats).length !== 8 || h.meaning.conds.length !== 6).map((h) => h.id)).toEqual([])
  })

  it('стартовые предметы есть в каталоге; наследник входит не позже Старости', () => {
    expect(heirs.flatMap((h) => (h.startItems ?? []).filter((n) => !itemNames.has(n)))).toEqual([])
    expect(heirs.filter((h) => !['Молодость', 'Зрелость', 'Старость'].includes(h.entry)).map((h) => h.id)).toEqual([])
  })
})
