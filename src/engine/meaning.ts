/** Смысл жизни и счастье: поиск, Династия и отказ, кризис среднего возраста, Серость, подсчёт («Смысл жизни и счастье»). */
import { CULTURE_AXES, type Cond, type Meaning } from '../data/schema.ts'
import { ask, emit, roll3, say, segName, shuffle, step, type Flow, type G } from './core.ts'
import { cond, entryConds, entryKey, has, profileOf } from './cond.ts'
import { addParam } from './change.ts'
import { newCtx } from './cond.ts'
import type { Player, Seg } from './types.ts'

const GREY = 'серость'

/** Карта смысла игрока: из колоды или приписанная стандартному наследнику. */
export function meaningOf(g: G, p: Player): Pick<Meaning, 'title' | 'tags' | 'conds'> | undefined {
  if (!p.meaning) return undefined
  return g.meanings.get(p.meaning.id) ?? g.c.heirs.find((h) => h.id === p.meaning!.id)?.meaning
}

// ── Счастье ─────────────────────────────────────────────────────────────

/** Выполнено ли условие карты смысла сейчас. `итог` считается только в конце жизни. */
function met(g: G, p: Player, k: Meaning['conds'][number]): boolean {
  if (k.kind === 'соб.') return !!p.achieved[JSON.stringify(k.cond)]
  if (k.kind === 'итог') return (!p.alive || p.finished || g.s.phase === 'конец') && cond(g, p, k.cond)
  return cond(g, p, k.cond)
}

export function happinessOf(g: G, p: Player): number {
  const m = meaningOf(g, p)
  return m ? m.conds.reduce((s, k) => s + (met(g, p, k) ? k.points : 0), 0) : 0
}

/**
 * Точка покоя: обновить память о событиях, счастье и отклик культуры на выполненные условия.
 * Вызывается после каждой карты и действия, на входе в отрезок и в момент смерти.
 */
export function settle(g: G, p: Player): void {
  // «соб.»: движок с рождения помнит всё, что хоть раз выполнилось, — по всем картам смысла сразу.
  for (const [key, c] of g.watch) if (!p.achieved[key] && cond(g, p, c)) p.achieved[key] = true
  const m = meaningOf(g, p)
  if (m && p.meaning && p.alive) {
    m.conds.forEach((k, i) => {
      if (k.kind === 'итог' || p.approved.includes(i) || !met(g, p, k)) return
      p.approved.push(i)
      // Культура одобряет смысл: +1 псих. за каждое выполненное условие; осуждает — −1.
      if (p.meaning!.verdict) addParam(g, p, 'псих', p.meaning!.verdict, newCtx('правило'))
    })
  }
  const to = happinessOf(g, p)
  if (to !== p.happiness) { emit(g, { t: 'счастье', p: p.seat, from: p.happiness, to }); p.happiness = to }
}

/** Отметить условия «на входе в отрезок» (`atEntry`), выполненные прямо сейчас. */
export function markEntry(g: G, p: Player): void {
  const seg = segName(p)
  for (const c of entryWatch(g)) if (c.atEntry === seg && cond(g, p, c.cond)) p.flags[entryKey(c)] = true
}
const entryCache = new WeakMap<object, Extract<Cond, { atEntry: unknown }>[]>()
function entryWatch(g: G): Extract<Cond, { atEntry: unknown }>[] {
  let list = entryCache.get(g.c)
  if (!list) {
    list = []
    for (const m of g.c.meanings) { for (const k of m.conds) entryConds(k.cond, list); if (m.requires) entryConds(m.requires, list) }
    for (const h of g.c.heirs) for (const k of h.meaning.conds) entryConds(k.cond, list)
    entryCache.set(g.c, list)
  }
  return list
}

// ── Одобрение культурой ─────────────────────────────────────────────────

/** Вердикт культуры о смысле: +1 одобряет, −1 осуждает, 0 — всё равно («Одобрение смысла культурой»). */
export function verdict(g: G, p: Player, m: Pick<Meaning, 'tags'>, id: string): -1 | 0 | 1 {
  if (id === GREY) return 0
  const t = g.c.tables.meaning
  const prof = profileOf(g, p)
  let sum = 0
  CULTURE_AXES.forEach(([a, b], i) => {
    const v = prof[i]
    if (!v) return
    const [toward, away] = v < 0 ? [a, b] : [b, a]
    for (const tag of m.tags) {
      if (t.values[toward]?.includes(tag)) sum += Math.abs(v)
      if (t.values[away]?.includes(tag)) sum -= Math.abs(v)
    }
  })
  return sum >= t.approval ? 1 : sum <= -t.approval ? -1 : 0
}

// ── Карты смысла ────────────────────────────────────────────────────────

function setMeaning(g: G, p: Player, id: string, from: NonNullable<Player['meaning']>['from'], locked = false): void {
  // Старая карта возвращается под низ своей колоды.
  if (p.meaning) {
    const old = g.meanings.get(p.meaning.id)
    if (old?.deck === 'Случайные') g.s.piles['смыслы'].push(old.id)
    if (old?.deck === 'Династии') g.s.piles['династии'].push(old.id)
  }
  p.meaning = { id, from, verdict: 0, ...(locked ? { locked: true as const } : {}) }
  p.approved = []
  const m = meaningOf(g, p)!
  p.meaning.verdict = verdict(g, p, m, id)
  emit(g, { t: 'смысл', p: p.seat, id, from })
  // Зачёт при вытягивании: уже выполненное засчитывается сразу, без отклика культуры задним числом.
  m.conds.forEach((k, i) => { if (k.kind !== 'итог' && met(g, p, k)) p.approved.push(i) })
  settle(g, p)
}

/** Верхняя подходящая карта стопки; неподходящие уходят под низ. */
function drawMeaning(g: G, p: Player, pile: 'смыслы' | 'династии'): string | undefined {
  const stack = g.s.piles[pile]
  for (let i = 0; i < stack.length; i++) {
    const id = stack.shift()!
    if (cond(g, p, g.meanings.get(id)!.requires)) return id
    stack.push(id)
  }
  return undefined
}

/** Бросок на смысл: 3d6 + поправка Мудрости (с Юности) + Наставник. */
function meaningRoll(g: G, p: Player, seg: Seg): boolean {
  const t = g.c.tables.meaning
  const need = t.need[seg]
  if (need === undefined) return false
  const child = seg === 'Детство'
  const mod = (child ? 0 : step(g.c.tables.statMod, p.stats['Мудрость'])) + (has(g, p, 'Наставник') ? t.mentorAdd : 0)
  const adv = !child && p.predisp === 'Мудрость' ? 1 : 0
  const roll = roll3(g, adv)
  const ok = roll.sum + mod >= need
  emit(g, { t: 'проверка', p: p.seat, stat: 'Мудрость', dice: roll.dice, kept: roll.sum, value: 0, mod, trump: 0, dc: need, ok, adv, what: 'поиск смысла' })
  return ok
}

/** Рождение: Династия у семьи с высоким положением или первый бросок на смысл. */
export function* meaningAtBirth(g: G, p: Player): Flow {
  if (p.pos >= g.c.tables.meaning.dynastyFrom) {
    const id = drawMeaning(g, p, 'династии')
    if (id) {
      setMeaning(g, p, id, 'династия')
      yield* refusal(g, p, 'Детство')
      return
    }
  }
  if (meaningRoll(g, p, 'Детство')) { const id = drawMeaning(g, p, 'смыслы'); if (id) setMeaning(g, p, id, 'рождение') }
}

/** Отказ от предназначения: бросок по таблице поиска; прекратить можно в любой момент, и это навсегда. */
function* refusal(g: G, p: Player, seg: Seg): Flow {
  const m = p.meaning
  if (!m || m.from !== 'династия' || m.locked) return
  const title = g.meanings.get(m.id)!.title
  const last = seg === 'Зрелость'
  const first = !p.refusing
  const a = yield* ask(g, p, 'смысл', `Предназначение рода: «${title}». ${first ? 'Принять или пытаться отказаться?' : 'Продолжать попытки отказа?'}${last ? ' Последний бросок: неудача — «Серость».' : ''}`, [
    { id: 'принять', label: first ? 'принять предназначение' : 'прекратить попытки' },
    { id: 'отказ', label: 'пытаться отказаться' },
  ], { force: true })
  if (a === 'принять') { delete p.refusing; m.locked = true; return }
  p.refusing = true
  if (meaningRoll(g, p, seg)) {
    delete p.refusing
    // Отказ удался: три Случайные карты, одна на выбор; менять её в кризис нельзя.
    const ids: string[] = []
    for (let i = 0; i < g.c.tables.meaning.refuseDraw; i++) { const id = drawMeaning(g, p, 'смыслы'); if (id) ids.push(id) }
    if (!ids.length) return
    const pickId = yield* ask(g, p, 'смысл', 'Отказ удался. Выбери свой смысл.', ids.map((id) => ({ id, label: g.meanings.get(id)!.title, note: g.meanings.get(id)!.motto })))
    for (const id of ids) if (id !== pickId) g.s.piles['смыслы'].push(id)
    setMeaning(g, p, pickId, 'отказ', true)
  } else if (last) {
    delete p.refusing
    say(g, p, 'отказ не удался: ни предназначения, ни своего смысла')
    setMeaning(g, p, GREY, 'серость', true)
  }
}

/** Вход в Юность, Молодость и Зрелость: поиск, отказ, кризис среднего возраста, Серость. */
export function* meaningAtEntry(g: G, p: Player): Flow {
  const seg = segName(p)
  if (g.c.tables.meaning.need[seg] === undefined) return
  if (p.meaning?.from === 'династия' && !p.meaning.locked) {
    if (p.refusing) yield* refusal(g, p, seg)
    else p.meaning.locked = true
    return
  }
  if (!p.meaning) {
    if (meaningRoll(g, p, seg)) { const id = drawMeaning(g, p, 'смыслы'); if (id) setMeaning(g, p, id, 'поиск') }
    if (!p.meaning && seg === 'Зрелость') setMeaning(g, p, GREY, 'серость', true)
    if (seg === 'Зрелость') p.crisisDone = true
    return
  }
  // Кризис среднего возраста: нашедший смысл раньше может сменить карту на другую случайную.
  if (seg === 'Зрелость' && !p.crisisDone) {
    p.crisisDone = true
    const m = g.meanings.get(p.meaning.id)
    if (!m || m.deck !== 'Случайные' || p.meaning.locked) return
    const a = yield* ask(g, p, 'смысл', `Кризис среднего возраста. Твой смысл — «${m.title}», счастье ${p.happiness}. Сменить карту на другую случайную?`, [
      { id: 'оставить', label: 'оставить свой смысл' },
      { id: 'сменить', label: 'тянуть новую карту' },
    ], { force: true })
    if (a === 'сменить') { const id = drawMeaning(g, p, 'смыслы'); if (id) setMeaning(g, p, id, 'кризис', true) }
  }
}

/** Стопки смыслов при подготовке. */
export function meaningPiles(g: G): void {
  g.s.piles['смыслы'] = shuffle(g, g.c.meanings.filter((m) => m.deck === 'Случайные').map((m) => m.id))
  g.s.piles['династии'] = shuffle(g, g.c.meanings.filter((m) => m.deck === 'Династии').map((m) => m.id))
}

/** Условия карты смысла игрока с отметкой «выполнено сейчас» — для листа игрока. */
export function meaningStatus(g: G, p: Player): { text: string; kind: string; points: number; met: boolean }[] {
  return (meaningOf(g, p)?.conds ?? []).map((k) => ({ text: k.text, kind: k.kind, points: k.points, met: met(g, p, k) }))
}
