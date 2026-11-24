/**
 * «Общественный след» (решено 18.11; концепция, «Страна → Общественный след»; карты — колоды, «Общественный след»).
 * Люди меняют жизнь друг друга, не встречаясь: удачная публичная ветка карты со знаком следа кладёт жетон канала на страну игрока,
 * фон — отчуждённый класс, когда бросок кризиса «почти» дотянул. Два жетона одного канала — исход: подавление,
 * имитация или уступка; уступка и подавление — карта политики на 5 мировых ходов.
 */
import { die, emit, pick, say, type G } from './core.ts'
import { addParam, gainItem, rollDie } from './change.ts'
import { newCtx } from './cond.ts'
import { stab } from './world.ts'
import type { Flow } from './core.ts'
import type { Cls, Country, Player } from './types.ts'

const T = (g: G) => g.c.tables.social
const alive = (p: Player | undefined): p is Player => !!p && p.alive && !p.finished
const clsOf = (g: G, channel: string): Cls => (Object.entries(T(g).channels).find(([, ch]) => ch === channel)![0] as Cls)

/** Жетонов канала на всех странах. */
const used = (g: G, channel: string) => g.s.world.countries.reduce((s, c) => s + (c.trace?.[channel] ?? 0), 0)

/** Положить жетон канала на страну; who — место игрока (у фона нет). Жетоны канала кончились — след не ложится. */
export function placeTrace(g: G, c: Country, channel: string, who?: number): boolean {
  if (used(g, channel) >= T(g).tokens) return false
  c.trace ??= {}
  c.trace[channel] = (c.trace[channel] ?? 0) + 1
  if (who !== undefined) { c.traceWho ??= {}; c.traceWho[channel] = [...new Set([...(c.traceWho[channel] ?? []), who])] }
  c.traceNew = true
  return true
}

/** Шаг карты «след»: канал или «свой» (канал класса игрока). */
export function traceRule(g: G, p: Player, arg = 'свой'): void {
  const channel = arg === 'свой' ? T(g).channels[p.cls] : arg
  const c = g.s.world.countries[p.country]
  if (placeTrace(g, c, channel, p.seat)) {
    say(g, p, `жетон СЛЕД «${channel}» — на страну ${c.name}`)
    p.counters['жетон следа'] = (p.counters['жетон следа'] ?? 0) + 1
  } else say(g, p, `жетоны СЛЕД «${channel}» кончились — след не лёг`)
}

/** Фон: бросок кризиса не дотянул до кризиса трёх очков или меньше — отчуждённый класс кладёт жетон своего канала. */
export function nearMiss(g: G, c: Country, roll: number, dc: number): void {
  if (roll < dc && roll >= dc - T(g).nearMiss && placeTrace(g, c, T(g).channels[c.alienated])) {
    emit(g, { t: 'мир', text: `${c.name}: недовольство без кризиса — СЛЕД «${T(g).channels[c.alienated]}» (${c.alienated})` })
  }
}

/** Поправка к доходу класса от карт политики страны. */
export function policyIncome(g: G, p: Player): number {
  const c = g.s.world.countries[p.country]
  return (c.policies ?? []).filter((x) => x.cls === p.cls && x.until > g.s.worldTurns).reduce((s, x) => s + x.add, 0)
}

/** Поправка к броску исхода: роль класса канала, строй, особые случаи. */
function outcomeMod(g: G, c: Country, channel: string): number {
  const t = T(g)
  const cls = clsOf(g, channel)
  let m = (c.dominant === cls ? 1 : 0) - (c.alienated === cls ? 1 : 0)
  if (t.voice.includes(channel)) m += t.democracies.includes(c.ideology) ? 1 : t.dictatorships.includes(c.ideology) ? -1 : 0
  return m + (t.special[channel]?.[c.ideology] ?? 0)
}

/** Конец мирового хода: исходы по каналам с двумя жетонами, карты политики, затухание. */
export function* socialWorld(g: G): Flow {
  const t = T(g)
  for (const c of g.s.world.countries) {
    c.policies = (c.policies ?? []).filter((x) => x.until > g.s.worldTurns)
    for (const [channel, n] of Object.entries(c.trace ?? {})) {
      if (n < t.threshold) continue
      const cls = clsOf(g, channel)
      const r = die(g, 6)
      const mod = outcomeMod(g, c, channel)
      const kind = r + mod <= t.suppressUpTo ? 'подавление' : r + mod <= t.imitateUpTo ? 'имитация' : 'уступка'
      const who = c.traceWho?.[channel] ?? []
      const stat = (g.s.stats ??= {})
      stat[`след: ${kind}`] = (stat[`след: ${kind}`] ?? 0) + 1
      if (who.length) stat['след: исход с жетоном игрока'] = (stat['след: исход с жетоном игрока'] ?? 0) + 1
      emit(g, { t: 'мир', text: `${c.name}: СЛЕД «${channel}» — d6 ${r}${mod ? ` ${mod > 0 ? '+' : '−'} ${Math.abs(mod)}` : ''} — ${kind}` })
      c.trace![channel] = 0
      if (c.traceWho) delete c.traceWho[channel]
      if (kind === 'имитация') continue
      const want = kind === 'подавление' ? 'П' : t.u1.includes(c.ideology) ? 'У1' : 'У2'
      const card = t.policies.find((x) => x.channel === channel && x.kind === want)!
      c.policies.push({ title: card.title, channel, kind, cls, add: kind === 'уступка' ? t.concession.income : t.suppression.income, until: g.s.worldTurns + t.turns })
      ;(g.s.chronicle ??= []).push({ worldTurn: g.s.worldTurns, country: c.id, text: `«${card.title}». ${card.headline}` })
      emit(g, { t: 'мир', text: `${c.name}: карта политики «${card.title}» — ${card.headline} Класс ${cls}: доход ${kind === 'уступка' ? '+1' : '−1'} на ${t.turns} мировых ходов` })
      const people = g.s.players.filter((p) => alive(p) && p.country === c.id)
      if (kind === 'уступка') {
        // Кто-то платит за уступку: все остальные жители страны −1 возм. сразу.
        for (const p of people) if (p.cls !== cls) addParam(g, p, 'возм', t.concession.others, newCtx('правило'))
      } else {
        stab(g, c, t.suppression.stab)
        for (const p of people) {
          if (!who.includes(p.seat)) continue
          if (rollDie(g, p, 6, `подавление: «${t.suppression.stigma}» на 1–${t.suppression.shameUpTo}`) <= t.suppression.shameUpTo) yield* gainItem(g, p, t.suppression.stigma)
        }
      }
    }
    // Затухание: со страны, куда за мировой ход ничего не легло, снимают один жетон.
    const left = Object.entries(c.trace ?? {}).filter(([, n]) => n > 0)
    if (left.length && !c.traceNew) { const [ch] = pick(g, left); c.trace![ch] -= 1 }
    delete c.traceNew
  }
}
