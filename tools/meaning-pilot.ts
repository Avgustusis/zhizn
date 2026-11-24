/**
 * Пилот карт смысла: средний итог (счастье к концу жизни) каждой карты в «Биографии» на движке, ИИ «Нормально».
 * Им пользуется ИИ «Сказки», когда выбирает смысл открыто (как card_value в sim3.py: пилотное среднее + половина
 * уже выполненного).
 *
 *   npx tsx tools/meaning-pilot.ts [партий=2000]  → src/data/meaning-pilot.json
 */
import { writeFileSync } from 'node:fs'
import { loadContent } from '../src/data/content.ts'
import { Engine } from '../src/engine/engine.ts'
import { aiAnswer } from '../src/engine/ai/index.ts'
import { ARCHETYPES } from '../src/engine/ai/persona.ts'

const N = Number(process.argv[2] ?? 2000)
const content = loadContent()
const sum: Record<string, number> = {}
const n: Record<string, number> = {}
for (let seed = 1; seed <= N; seed++) {
  const e = new Engine(content, { span: 'one', seed, seats: [0, 1, 2, 3].map((i) => ({ name: `И${i + 1}`, ai: 'normal' as const, archetype: ARCHETYPES[(seed * 4 + i) % ARCHETYPES.length].id })) }, { checkpoints: false })
  while (e.pending) e.answer(aiAnswer(e.g, e.pending))
  for (const p of e.state.players) {
    const id = p.meaning?.id
    if (!id) continue
    sum[id] = (sum[id] ?? 0) + p.happiness
    n[id] = (n[id] ?? 0) + 1
  }
}
const all = Object.values(sum).reduce((a, b) => a + b, 0) / Object.values(n).reduce((a, b) => a + b, 0)
const mean = Object.fromEntries(Object.keys(sum).sort().map((id) => [id, { mean: Math.round((100 * sum[id]) / n[id]) / 100, n: n[id] }]))
writeFileSync('src/data/meaning-pilot.json', JSON.stringify({ games: N, all: Math.round(all * 100) / 100, cards: mean }, null, 1) + '\n')
console.log(`партий ${N}, карт ${Object.keys(mean).length}, среднее ${all.toFixed(2)}`)
