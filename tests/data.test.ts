import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allCards, decks } from '../src/data/index.ts'
import type { Node } from '../src/data/schema.ts'

/** Имена предметов из каталога: первая колонка таблиц документа предметов. */
function catalogNames(): Set<string> {
  const md = readFileSync('reference/docs/items.md', 'utf8')
  const names = new Set<string>()
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|/)
    if (!m || /^-+$/.test(m[1]) || m[1] === 'Карта') continue
    names.add(m[1].replace(/\s*×\d+$/, ''))
  }
  for (const generic of ['Партнёр', 'Супруг(а)', 'Ребёнок', 'Друг', 'Наставник', 'Покровитель']) names.add(generic)
  return names
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
      [...walk(c.effect)].flatMap((n) => ('gain' in n ? [n.gain] : 'lose' in n ? [n.lose] : [])).filter((x) => !names.has(x)).map((x) => `${c.id}: ${x}`))
    expect(unknown).toEqual([])
  })

  it('предметы в условиях и отменах тоже есть в каталоге', () => {
    const names = catalogNames()
    const conds = (x: unknown): string[] =>
      x && typeof x === 'object'
        ? Object.entries(x).flatMap(([k, v]) => (k === 'has' && typeof v === 'string' ? [v] : conds(v)))
        : []
    const unknown = allCards.flatMap((c) =>
      [...conds(c.effect), ...conds(c.requires), ...(c.cancelBy ?? [])].filter((x) => !names.has(x)).map((x) => `${c.id}: ${x}`))
    expect(unknown).toEqual([])
  })

  it('исходы d6 в пределах 1–6 и не пересекаются', () => {
    const bad: string[] = []
    for (const c of allCards) for (const n of walk(c.effect)) {
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

  it('сложность проверок — 12, 15 или 18', () => {
    const bad = allCards.flatMap((c) => [...walk(c.effect)].flatMap((n) => ('check' in n && ![12, 15, 18].includes(n.check.dc) ? [`${c.id}: ${n.check.dc}`] : [])))
    expect(bad).toEqual([])
  })

  it('тип карты совпадает с разбором: П — есть проверка, Р — есть выбор', () => {
    const bad = allCards.filter((c) => {
      const nodes = [...walk(c.effect)]
      if (c.kind === 'П') return !nodes.some((n) => 'check' in n)
      if (c.kind === 'Р') return !nodes.some((n) => 'choose' in n)
      return false
    }).map((c) => `${c.id} (${c.kind})`)
    expect(bad).toEqual([])
  })
})
