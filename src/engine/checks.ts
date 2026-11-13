/** Проверка: 3d6 + характеристика ≥ сложность, со всеми поправками («Проверки»). */
import type { Check, Cond } from '../data/schema.ts'
import type { PoleTag } from '../data/tables.ts'
import { CHAR_AXES, CULTURE_AXES } from '../data/schema.ts'
import { ask, clamp, countryOf, emit, roll3, type Flow, type G } from './core.ts'
import { cond, countryProfile, cultureLean, effStat, isMinority, kindOf, pairOf, profileOf, sexStanding, type Ctx } from './cond.ts'
import { count, removeHeld, rollDie } from './change.ts'
import { run } from './exec.ts'
import type { Held, Player, Stat, Tag } from './types.ts'

// ── Шансы ───────────────────────────────────────────────────────────────

/** Распределения суммы: 3d6, 4d6 без низшего, 4d6 без высшего. */
const DIST: Record<number, number[]> = { 0: [], 1: [], [-1]: [] }
for (const adv of [0, 1, -1]) {
  const d = Array<number>(19).fill(0)
  const n = adv === 0 ? 3 : 4
  const total = 6 ** n
  for (let i = 0; i < total; i++) {
    const dice = Array.from({ length: n }, (_, k) => (Math.floor(i / 6 ** k) % 6) + 1)
    let sum = dice.reduce((a, b) => a + b, 0)
    if (adv > 0) sum -= Math.min(...dice)
    if (adv < 0) sum -= Math.max(...dice)
    d[sum] += 1 / total
  }
  DIST[adv] = d
}
/** Шанс выбросить не меньше need. */
export function chance(need: number, adv = 0): number {
  let s = 0
  for (let v = Math.max(3, need); v <= 18; v++) s += DIST[adv][v]
  return need <= 3 ? 1 : s
}

// ── Ситуативные поправки по тегам ───────────────────────────────────────

export interface Mods { add: number; adv: boolean; dis: boolean; parts: string[] }

function poleParts(g: G, p: Player, stat: Stat, tags: Tag[], list: PoleTag[] | undefined, strength: number, label: string, out: Mods): void {
  for (const e of list ?? []) {
    if (!tags.includes(e.tag)) continue
    if (e.stat && e.stat !== stat) continue
    if (e.pair !== undefined && e.pair !== !!pairOf(g, p)) continue
    if (e.who === 'чужак' && !isMinority(g, p)) continue
    if (e.who === 'пол+' && sexStanding(g, p) <= 0) continue
    if (e.who === 'пол−' && sexStanding(g, p) >= 0) continue
    out.add += e.sign * strength
    out.parts.push(`${label} ${e.tag} ${e.sign * strength > 0 ? '+' : ''}${e.sign * strength}`)
  }
}

/** Все ситуативные поправки к проверке с этими тегами: культура, характер, предметы, класс, идеология, мода, временные. */
export function situational(g: G, p: Player, stat: Stat, ctx: Ctx): Mods {
  const t = g.c.tables
  const tags = ctx.tags
  const out: Mods = { add: 0, adv: false, dis: false, parts: [] }
  const c = countryOf(g, p)
  // Культура игрока. В колоде «по полюсам» карта сама описывает полюса — бонус тега не добавляется.
  if (!ctx.polar) {
    const prof = profileOf(g, p)
    CULTURE_AXES.forEach(([a, b], i) => { if (prof[i]) poleParts(g, p, stat, tags, t.cultureTags[prof[i] < 0 ? a : b], Math.abs(prof[i]), prof[i] < 0 ? a : b, out) })
    const env = countryProfile(g, c)
    CULTURE_AXES.forEach(([a, b], i) => { if (env[i]) poleParts(g, p, stat, tags, t.countryCultureTags[env[i] < 0 ? a : b], Math.abs(env[i]), `страна: ${env[i] < 0 ? a : b}`, out) })
  }
  CHAR_AXES.forEach(([a, b], i) => { const v = p.character[i]; if (v) poleParts(g, p, stat, tags, t.characterTags[v < 0 ? a : b], Math.abs(v), v < 0 ? a : b, out) })
  // Предметы: сама карта, тень, сторона Партнёра или Супруга(и). «Престижный диплом» заменяет «Диплом».
  const prestige = p.items.some((h) => h.name === 'Престижный диплом')
  for (const h of p.items) {
    const item = g.items.get(h.name)
    if (!item || (prestige && h.name === 'Диплом')) continue
    const side = item.sides ? (h.spouse ? item.sides.spouse : item.sides.partner) : undefined
    for (const b of [...(item.bonus ?? []), ...(item.shadow?.bonus ?? []), ...(side?.bonus ?? [])]) {
      if (!b.tags.some((x) => tags.includes(x)) || !cond(g, p, b.if, ctx)) continue
      if (b.add) { out.add += b.add; out.parts.push(`«${h.name}» ${b.add > 0 ? '+' : ''}${b.add}`) }
      if (b.adv) { out.adv = true; out.parts.push(`«${h.name}» преимущество`) }
      if (b.dis) { out.dis = true; out.parts.push(`«${h.name}» помеха`) }
    }
  }
  // Класс: доминирующему — преимущество в его тегах, отчуждённому — помеха.
  if (t.classTags[p.cls].some((x) => tags.includes(x))) {
    if (c.dominant === p.cls) { out.adv = true; out.parts.push('класс доминирует: преимущество') }
    if (c.alienated === p.cls) { out.dis = true; out.parts.push('класс отчуждён: помеха') }
  }
  for (const e of t.ideologyTags[c.ideology]) {
    if (!tags.includes(e.tag)) continue
    if (e.who === 'большинство' && isMinority(g, p)) continue
    if (e.who === 'чужак' && !isMinority(g, p)) continue
    if (e.who && e.who !== 'большинство' && e.who !== 'чужак' && e.who !== p.cls) continue
    out.add += e.add
    out.parts.push(`${c.ideology} ${e.tag} ${e.add > 0 ? '+' : ''}${e.add}`)
  }
  if (t.beauty.fashionTags.some((x) => tags.includes(x))) {
    if (c.fashionIn === p.race) { out.add += 1; out.parts.push('раса в моде +1') }
    if (c.fashionOut === p.race) { out.add -= 1; out.parts.push('раса не в моде −1') }
  }
  for (const m of p.mods) {
    if (!modApplies(g, m, ctx)) continue
    if (m.add) { out.add += m.add; out.parts.push(`поправка ${m.add > 0 ? '+' : ''}${m.add}`) }
    if (m.adv) out.adv = true
    if (m.dis) out.dis = true
  }
  out.add = clamp(out.add, -t.check.situationalCap, t.check.situationalCap)
  return out
}

function modApplies(g: G, m: Player['mods'][number], ctx: Ctx): boolean {
  if (m.fork) return !!ctx.card && g.cards.get(ctx.card)?.card.title === m.fork
  return !m.tag || ctx.tags.includes(m.tag)
}

// ── Поправки карты ──────────────────────────────────────────────────────

/** Полюса культуры, от которых зависит условие (без `strong` и вне отрицаний). */
export function polesIn(c: Cond | undefined, out: string[] = []): string[] {
  if (!c) return out
  if ('all' in c) c.all.forEach((x) => polesIn(x, out))
  else if ('any' in c) c.any.forEach((x) => polesIn(x, out))
  else if ('culture' in c && !c.strong) out.push(c.culture)
  return out
}
/** Игрок «сильно» клонится к одному из полюсов условия. */
export const strongIn = (g: G, p: Player, c: Cond | undefined): boolean => polesIn(c).some((pole) => cultureLean(g, p, pole) === 2)

function trumpOf(c: Cond | undefined): string | undefined {
  if (!c) return undefined
  if ('has' in c) return c.has
  if ('all' in c) return c.all.map(trumpOf).find(Boolean)
  if ('any' in c) return c.any.map(trumpOf).find(Boolean)
  return undefined
}

// ── Проверка ────────────────────────────────────────────────────────────

/** Провести проверку. Возвращает успех. */
export function* runCheck(g: G, p: Player, check: Check, ctx: Ctx, askStat = false): Flow<boolean> {
  let dcBase = check.dc
  let add = 0
  let adv = false
  let dis = false
  let auto = false
  const notes: string[] = []
  for (const m of check.mods ?? []) {
    if (!cond(g, p, m.if, ctx)) continue
    if (m.spend) {
      const name = trumpOf(m.if)
      const h = name ? p.items.find((x) => x.name === name) : undefined
      if (!h) continue
      const a = yield* ask(g, p, 'козырь', `Потратить «${h.name}» на эту проверку?`, [{ id: 'да', label: `сыграть «${h.name}»` }, { id: 'нет', label: 'оставить' }], { card: ctx.card, force: true })
      if (a === 'нет') continue
      spend(g, p, h)
    }
    // Колода «по полюсам»: поправка записана для «сильно», при «умеренно» — на 1 от обычного.
    const moderate = !!ctx.polar && !m.fixed && polesIn(m.if).length > 0 && !strongIn(g, p, m.if)
    if (m.dc !== undefined) dcBase = moderate ? check.dc + Math.sign(m.dc - check.dc) : m.dc
    if (m.add) { const v = moderate ? Math.sign(m.add) : m.add; add += v; notes.push(`карта ${v > 0 ? '+' : ''}${v}`) }
    if (m.adv) adv = true
    if (m.dis) dis = true
    if (m.auto) auto = true
  }
  // Какой характеристикой бросать: та, с которой шанс выше.
  const options = [...(Array.isArray(check.stat) ? check.stat : [check.stat]).map((stat) => ({ stat, dc: dcBase })), ...(check.or ?? [])]
  const rate = (o: { stat: Stat; dc: number }) => {
    const s = situational(g, p, o.stat, ctx)
    const a = net(adv || s.adv || p.predisp === o.stat, dis || s.dis)
    return { ...o, s, a, chance: chance(o.dc - effStat(g, p, o.stat) - add - s.add, a) }
  }
  const rated = options.map(rate)
  let best = rated.reduce((a, b) => (b.chance > a.chance ? b : a))
  if (askStat && rated.length > 1) {
    const id = yield* ask(g, p, 'характеристика', 'Чем бросаешь проверку?', rated.map((r) => ({ id: r.stat, label: `${r.stat} ${r.dc}`, note: `${Math.round(r.chance * 100)}%` })), { card: ctx.card })
    best = rated.find((r) => r.stat === id)!
  }
  const stat = best.stat
  const value = effStat(g, p, stat)
  const mod = add + best.s.add
  ctx.shared.used = stat

  // Козырь — до броска и сверх потолка ±3.
  let trump = 0
  let risky: Held | undefined
  if (!auto) {
    const plays = playable(g, p, ctx.tags)
    if (plays.length) {
      const now = Math.round(chance(best.dc - value - mod, best.a) * 100)
      const id = yield* ask(g, p, 'козырь', `Проверка: ${stat} ${best.dc}, шанс ${now}%. Сыграть козырь?`, [
        ...plays.map((x) => ({ id: `${x.h.uid}:${x.i}`, label: `«${x.h.name}»: ${x.auto ? 'автоуспех' : `+${x.add}`}` })),
        { id: 'нет', label: 'без козыря' },
      ], { card: ctx.card, force: true })
      const used = plays.find((x) => `${x.h.uid}:${x.i}` === id)
      if (used) {
        if (used.auto) auto = true
        else trump = used.add
        if (kindOf(g, used.h) === 'антикозырь') { risky = used.h; count(p, 'антикозырь сыгран') }
        spend(g, p, used.h)
      }
    }
  }

  const roll = auto ? { dice: [], sum: 0 } : roll3(g, best.a)
  const ok = auto || roll.sum + value + mod + trump >= best.dc
  emit(g, { t: 'проверка', p: p.seat, stat, dice: roll.dice, kept: roll.sum, value, mod, trump, dc: best.dc, ok, adv: best.a, ...(auto ? { auto: true as const } : {}), ...(check.what ? { what: check.what } : {}) })
  if (!ok) ctx.shared.failed = true
  // Поправки «до следующей проверки» сгорают.
  p.mods = p.mods.filter((m) => !(m.until === 'проверка' && modApplies(g, m, ctx)))
  // Антикозырь: сила сработала, катастрофа на d6 1–2 идёт сверху.
  if (risky) {
    const item = g.items.get(risky.name)
    if (rollDie(g, p, 6, `риск «${risky.name}»`) <= 2 && item?.risk) yield* run(g, p, item.risk, { ...ctx, source: 'правило' })
  }
  return ok
}

const net = (adv: boolean, dis: boolean): number => (adv && !dis ? 1 : dis && !adv ? -1 : 0)

/** Козыри, антикозыри и расходные вещи игрока, которыми можно усилить проверку с этими тегами. */
function playable(g: G, p: Player, tags: Tag[]): { h: Held; i: number; add: number; auto: boolean }[] {
  const out: { h: Held; i: number; add: number; auto: boolean }[] = []
  for (const h of p.items) {
    const item = g.items.get(h.name)
    item?.play?.forEach((pl, i) => {
      if (!pl.add && !pl.auto) return
      if (!pl.any && !(pl.tags ?? []).some((x) => tags.includes(x))) return
      out.push({ h, i, add: pl.add ?? 0, auto: !!pl.auto })
    })
  }
  return out
}

/** Сыграть одноразовую карту: минус использование, без использований — карта уходит. */
export function spend(g: G, p: Player, h: Held): void {
  emit(g, { t: 'предмет', p: p.seat, name: h.name, how: 'сыгран' })
  if (h.uses && h.uses > 1) { h.uses -= 1; return }
  removeHeld(g, p, h)
}
