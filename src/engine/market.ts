/**
 * Рынок в движке: формулы, которые проще считать кодом, чем записать данными.
 * Доход и износ (концепция, «Работа»), своё дело, обязательные траты и пенсия, обряд, знакомство в городе.
 * Сами действия и их цены — данные: src/data/market.ts.
 */
import { CHAR_AXES } from '../data/schema.ts'
import { ask, countryOf, die, say, segName, shuffle, step, type Flow, type G } from './core.ts'
import { charAxisOf, has, isMinority, kindOf, newCtx, pairOf, type Ctx } from './cond.ts'
import { addParam, charStep, count, enterInst, gainItem, removeHeld, rollDie, setClass, visit } from './change.ts'
import { run } from './exec.ts'
import { previewCheck, runCheck } from './checks.ts'
import { legalize } from './emigration.ts'
import type { CharPole, Cls, Held, Player, Stat } from './types.ts'

// ── Доход ───────────────────────────────────────────────────────────────

/** Обычный доход Д: база класса + пригодность + связи семьи + роль класса + позиция + идеология; минимум 1. */
export function income(g: G, p: Player): number {
  const t = g.c.tables
  const w = t.work
  const c = countryOf(g, p)
  const [a, b] = w.fit[p.cls]
  const fit = step(w.fitMod, Math.floor((p.stats[a] + p.stats[b]) / 2))
  const flat = t.ideologyIncome.flat[c.ideology]
  let d = flat !== undefined ? flat + fit
    : w.base[p.cls] + fit + (p.pos >= w.posFrom ? 1 : 0) + (c.dominant === p.cls ? w.dominant : c.alienated === p.cls ? w.alienated : 0) + w.position[c.pos]
  const minus = t.ideologyIncome.minus[c.ideology]
  if (minus) d = Math.max(minus.min, d + minus.add)
  const byCls = t.ideologyIncome.classes[c.ideology]
  if (byCls?.cls.includes(p.cls)) d += byCls.add
  d += t.ideologyIncome.everyone[c.ideology] ?? 0
  if (c.ideology === 'Национализм') d += isMinority(g, p) ? -t.ideologyIncome.nationalism : t.ideologyIncome.nationalism
  for (const i of p.income) d += i.add
  if (p.rules['мир: доход −1']) d -= 1
  // После геноцида два мировых хода работать некому.
  if (c.emptied !== undefined && g.s.worldTurns <= c.emptied) d -= 1
  return Math.max(w.min, t.ideologyIncome.floor[c.ideology] ?? w.min, d)
}

/** Износ одного здоровья: на −8 и ниже потеря уходит в другое здоровье. */
function hit(g: G, p: Player, which: 'физ' | 'псих', n: number, ctx: Ctx): void {
  const floor = g.c.tables.work.wearFloor
  const value = which === 'физ' ? p.phys : p.psy
  const target = value <= floor ? (which === 'физ' ? 'псих' : 'физ') : which
  addParam(g, p, target, -n, ctx)
}

/** Подработка, Работа, Переработка, Дело: доход, износ по d6, Стаж (концепция, «Работа», «Своё дело»). */
export function* work(g: G, p: Player, kind: string): Flow {
  const t = g.c.tables
  const ctx = newCtx('действие', { tags: ['#работа'] })
  const c = countryOf(g, p)
  const D = income(g, p)
  const own = t.work.cost[p.cls]
  // Психика −5 и ниже: Работа приносит только доход Подработки (Усердие держится до −8).
  const weak = p.psy <= -5 && !(cultureFree(p) && p.psy >= -8)
  if (kind === 'дело') {
    const biz = p.items.find((h) => kindOf(g, h) === 'дело')
    const item = biz && g.items.get(biz.name)
    if (!biz || !item?.biz) return
    const b = item.biz
    // Незаконное дело: перед доходом — облава; можно закрыть дело, ничего не получив.
    if (!bizLegal(g, p, biz.name)) {
      const soft = c.ideology === 'Клептократия' || c.dominant === 'Мафия'
      const r = t.business.raid
      const a = yield* ask(g, p, 'действие', `«${biz.name}» здесь незаконно: облава на ${soft ? `d6 1` : `d10 1–${r.d10}`} — дело конфисковано, «Судимость», тюрьма d3. Работать или закрыть дело?`, [
        { id: 'работать', label: 'работать, рискуя облавой' }, { id: 'закрыть', label: 'закрыть дело: сбросить карту, ничего не получив' },
      ], { force: true })
      if (a === 'закрыть') { removeHeld(g, p, biz); say(g, p, `дело «${biz.name}» закрыто`); count(p, 'дело закрыто'); return }
      if (soft ? rollDie(g, p, 6, 'облава на 1') <= r.d6 : rollDie(g, p, 10, `облава на 1–${r.d10}`) <= r.d10) {
        say(g, p, `облава: «${biz.name}» конфисковано`)
        removeHeld(g, p, biz)
        count(p, 'облава')
        yield* gainItem(g, p, r.stigma)
        enterInst(g, p, 'тюрьма', rollDie(g, p, g.c.tables.inst.prison.light, 'срок'), '#закон')
        return
      }
    }
    const war = !!b.war && (c.war || g.s.war?.kind === 'мировая')
    const bonus = war ? b.war!.bonus : bizBonus(g, biz)
    let mod = (b.size === 'крупное' ? t.business.bigIdeology[c.ideology] : undefined) ?? t.business.ideology[c.ideology] ?? 0
    if (c.ideology === 'Клептократия' && has(g, p, t.business.kleptoPatron.item)) mod = t.business.kleptoPatron.add
    let gain = Math.max(t.work.min, D + bonus + mod)
    if (p.psy <= -5) gain = Math.ceil(gain / 2)
    addParam(g, p, 'возм', gain, ctx)
    addStazh(p, false)
    // Особое: ход «Дела» у новых дел; клиника — раз в отрезок лечишься сам.
    if (war) yield* run(g, p, b.war!.turn, ctx)
    if (b.turn) yield* run(g, p, b.turn, ctx)
    if (b.selfHeal && p.phys < b.selfHeal.below && !p.counters[`лечишься сам:${p.seg}`]) {
      p.counters[`лечишься сам:${p.seg}`] = 1
      say(g, p, 'лечишься сам в своей клинике')
      addParam(g, p, 'физ', b.selfHeal.add, ctx)
    }
    // Мафиозные дела без своих правил хода («Серый импорт», «Рекет»): d6 1 — потеря.
    if (b.size === 'мафия' && !b.turn && rollDie(g, p, 6, `риск «${biz.name}»`) <= t.business.mafiaTurnRisk) yield* gainItem(g, p, 'Дурная слава')
    return
  }
  if (kind === 'подработка' || weak) {
    addParam(g, p, 'возм', Math.ceil(D / 2), ctx)
    if (kind === 'подработка') legalize(g, p)
    if (rollDie(g, p, 6, 'износ') <= 4) hit(g, p, p.phys >= p.psy ? 'физ' : 'псих', 1, ctx)
    if (kind === 'работа') say(g, p, 'психика на исходе: работа приносит только доход подработки')
    return
  }
  const other = own === 'физ' ? 'псих' : 'физ'
  if (kind === 'работа') {
    addParam(g, p, 'возм', D + 1, ctx)
    addStazh(p, true)
    const r = rollDie(g, p, 6, 'износ')
    if (own === 'риск') { if (r <= t.work.mafiaRisk['работа']) yield* gainItem(g, p, 'Дурная слава'); return }
    if (r <= 2) { hit(g, p, 'физ', 1, ctx); hit(g, p, 'псих', 1, ctx) } else if (r <= 4) hit(g, p, rollDie(g, p, 6, 'износ: какое здоровье') >= 5 ? other : own, 1, ctx)
    return
  }
  // Переработка
  addParam(g, p, 'возм', D * 2 + 1 + (t.ideologyIncome.overtime[c.ideology] ?? 0), ctx)
  addStazh(p, true)
  const r = rollDie(g, p, 6, 'износ')
  if (own === 'риск') {
    hit(g, p, 'физ', 1, ctx); hit(g, p, 'псих', 1, ctx)
    if (r <= t.work.mafiaRisk['переработка']) yield* gainItem(g, p, 'Дурная слава')
    return
  }
  if (r <= 2) { hit(g, p, 'физ', 2, ctx); hit(g, p, 'псих', 2, ctx) } else if (r <= 4) { hit(g, p, 'физ', 1, ctx); hit(g, p, 'псих', 1, ctx) } else hit(g, p, own, 1, ctx)
}
/** Усердие: работа при психике до −8. */
const cultureFree = (p: Player): boolean => p.character[charAxisOf('Усердие')[0]] > 0

/** Отметка Стажа: найма (идёт в пенсию) или пустая — от своего дела. */
export function addStazh(p: Player, hire: boolean): void {
  p.stazh += 1
  if (hire) p.stazhHire += 1
  visit(p, 'Стаж')
  if (p.counters['выход из института']) count(p, 'Стаж после выхода')
}

// ── Деньги каждый ход ───────────────────────────────────────────────────

/** Пенсия за ход: по Стажу найма, не больше обычного дохода; только гражданам страны проживания. */
export function pension(g: G, p: Player): number {
  const t = g.c.tables.pension
  if (!t.segs.includes(segName(p)) || !p.citizenship.includes(p.country)) return 0
  const base = t.table.find(([from]) => p.stazhHire >= from)?.[1] ?? 0
  if (!base) return 0
  return Math.min(base + p.pensionAdd, income(g, p))
}

/** Обязательные траты и пенсия — каждый ход с Молодости, после события (концепция, «Обязательные траты», «Стаж и пенсия»). */
export function money(g: G, p: Player): void {
  const t = g.c.tables
  if (p.inst || p.seg < 2) return
  const ctx = newCtx('правило')
  const spend = segName(p) === t.spending.from ? t.spending.young : t.spending.richClasses.includes(p.cls) ? t.spending.rich : t.spending.base
  addParam(g, p, 'возм', -spend, ctx)
  const pen = pension(g, p)
  p.counters['пенсия за ход'] = pen
  if (pen) addParam(g, p, 'возм', pen, ctx)
}

// ── Своё дело: риск и продажа на входе в отрезок ────────────────────────

/** Законно ли дело в стране игрока (новые дела 18.11: только при одной идеологии или кроме некоторых). */
export function bizLegal(g: G, p: Player, name: string, ideology = countryOf(g, p).ideology): boolean {
  const b = g.items.get(name)?.biz
  if (!b) return true
  if (b.legalIn && !b.legalIn.includes(ideology)) return false
  return !b.illegalIn?.includes(ideology)
}
/** Бонус дела к доходу: выросшее малое — +2, венчурная фирма после роста — +2 или +3. */
export function bizBonus(g: G, h: Held): number {
  const b = g.items.get(h.name)!.biz!
  return h.bonus ?? (b.size === 'малое' && h.grown ? 2 : b.bonus)
}

export function* businessAtEntry(g: G, p: Player): Flow {
  const t = g.c.tables.business
  const h = p.items.find((x) => kindOf(g, x) === 'дело')
  const item = h && g.items.get(h.name)
  if (!h || !item?.biz) return
  const seg = segName(p)
  if (seg === t.saleSeg) {
    const bonus = bizBonus(g, h)
    say(g, p, `дело «${h.name}» продано`)
    removeHeld(g, p, h)
    addParam(g, p, 'возм', bonus * t.salePerBonus, newCtx('правило'))
    return
  }
  if (!t.riskSegs.includes(seg)) return
  const c = countryOf(g, p)
  const wide = (c.ideology === 'Госсоциализм' && h.name !== t.coop) || (c.ideology === 'Национализм' && isMinority(g, p)) || t.riskWideIdeo.includes(c.ideology)
  const r = rollDie(g, p, 6, `риск дела «${h.name}»`)
  const grow = item.biz.grow?.[String(r)]
  if (r <= Math.max(wide ? t.riskWide : 1, item.biz.risk ?? 1)) yield* burn(g, p, h)
  else if (grow && !h.grown) { h.grown = true; h.bonus = grow; say(g, p, `дело «${h.name}» выросло: Д + ${grow}`) }
  else if (r === 6 && item.biz.size === 'малое' && !h.grown) { h.grown = true; say(g, p, `малое дело «${h.name}» выросло до среднего`) }
}

/** Дело прогорело: карта в сброс, −2 псих. (мафиозные — стигма; социал-демократия — пособие). */
export function* burn(g: G, p: Player, h?: Held): Flow {
  const t = g.c.tables.business
  h ??= p.items.find((x) => kindOf(g, x) === 'дело')
  if (!h) return
  say(g, p, `дело «${h.name}» прогорело`)
  removeHeld(g, p, h)
  count(p, 'дело прогорело')
  const ctx = newCtx('правило')
  const stigma = t.mafiaStigma[h.name]
  if (stigma) yield* gainItem(g, p, stigma)
  else addParam(g, p, 'псих', t.burnPsy, ctx)
  if (countryOf(g, p).ideology === 'Социал-демократия') addParam(g, p, 'возм', t.socdemBenefit, ctx)
}

// ── Контора: открыть дело самому (18.11) ───────────────────────────────

/** Дела, которые игрок может открыть в Конторе: по классу, по статусу, законные в стране; цена и сложность с поправками. */
export function kontoraMenu(g: G, p: Player): { name: string; price: number; check?: { stat: Stat; dc: number } }[] {
  const k = g.c.tables.business.kontora
  const c = countryOf(g, p)
  return k.menu.flatMap((m) => {
    if (m.who && !m.who.includes(p.cls)) return []
    if (m.item && !has(g, p, m.item)) return []
    if (m.onlyIn && !m.onlyIn.includes(c.ideology)) return []
    if (m.notIn?.includes(c.ideology) || !bizLegal(g, p, m.name)) return []
    const price = Math.max(1, m.price + (k.price[c.ideology] ?? 0) + (c.ideology === 'Клептократия' && !has(g, p, k.kleptoFree) ? k.kleptoAdd : 0))
    const dc = m.check ? m.check.dc + (k.dc[c.ideology] ?? 0) + (isMinority(g, p) ? k.minorityDc[c.ideology] ?? 0 : 0) : 0
    return [{ name: m.name, price, ...(m.check ? { check: { stat: m.check.stat, dc } } : {}) }]
  })
}

export function* kontora(g: G, p: Player): Flow {
  const k = g.c.tables.business.kontora
  const ctx = newCtx('действие', { tags: ['#своёдело'] })
  const menu = kontoraMenu(g, p)
  if (!menu.length) { say(g, p, 'открыть здесь нечего'); return }
  const id = yield* ask(g, p, 'действие', 'Контора: какое дело открыть?', [
    ...menu.map((m) => ({
      id: m.name, label: `${m.name}: ${m.price} возм.`,
      ...(m.check ? { check: previewCheck(g, p, { stat: m.check.stat, dc: m.check.dc }, ctx) } : { note: 'без проверки' }),
      ...(p.vozm < m.price ? { off: 'нет денег' } : {}),
    })),
    { id: 'нет', label: 'ничего не открывать' },
  ], { force: true })
  if (id === 'нет') return
  const m = menu.find((x) => x.name === id)!
  addParam(g, p, 'возм', -m.price, ctx)
  count(p, 'контора')
  const ok = m.check ? yield* runCheck(g, p, { stat: m.check.stat, dc: m.check.dc, what: `Контора: ${m.name}` }, ctx) : true
  if (ok) { yield* gainItem(g, p, m.name); count(p, 'своё дело открыто') } else {
    say(g, p, 'не вышло: половина денег вернулась')
    addParam(g, p, 'возм', Math.floor(m.price / 2), ctx)
    addParam(g, p, 'псих', k.failPsy, ctx)
  }
}

// ── Обряд ───────────────────────────────────────────────────────────────

export function* rite(g: G, p: Player): Flow {
  const nodes = g.c.tables.rites[p.culture]
  if (!nodes) return
  count(p, p.country === p.birthCountry ? 'обряд своей культуры' : 'обряд в новой стране')
  if (p.country === p.birthCountry) visit(p, 'обряд своей культуры')
  yield* run(g, p, nodes, newCtx('действие'))
}

// ── Знакомство в городе ─────────────────────────────────────────────────

/** Кольца знакомств, доступные игроку: по позиции страны; Олигархи — все, Мафия — на кольцо глубже. */
export function rings(g: G, p: Player): string[] {
  const t = g.c.tables.city
  let d = t.depth[countryOf(g, p).pos]
  if (p.cls === 'Олигархи') d = t.rings.length - 1
  if (p.cls === 'Мафия') d = Math.min(t.rings.length - 1, d + 1)
  return t.rings.slice(0, d + 1) as string[]
}

/** Колоды знакомств и колода «Знакомые» — при подготовке. */
export function cityPiles(g: G): void {
  for (const b of g.c.buildings) if (b.deck) g.s.piles[`знакомства.${b.id}`] = shuffle(g, b.deck.map((m) => String(m.n)))
  g.s.piles['Знакомые'] = shuffle(g, g.c.items.filter((i) => i.deck === 'Знакомые').map((i) => i.name))
}

export function* acquaintance(g: G, p: Player): Flow {
  const t = g.c.tables.city
  const open = rings(g, p)
  const options = g.c.buildings.filter((b) => b.deck && open.includes(b.ring)).map((b) => ({
    id: b.id, label: `${b.name} (${b.ring})`, ...(p.counters[`здание:${b.id}:${p.seg}`] ? { off: 'уже был в этом отрезке' } : {}),
  }))
  if (!options.some((o) => !o.off)) { say(g, p, 'знакомиться негде: во всех доступных зданиях уже был в этом отрезке'); return }
  const id = yield* ask(g, p, 'действие', 'Куда идёшь знакомиться?', options, { force: true })
  const b = g.c.buildings.find((x) => x.id === id)!
  p.counters[`здание:${b.id}:${p.seg}`] = 1
  visit(p, b.name)
  const pile = g.s.piles[`знакомства.${b.id}`]
  const n = pile.shift()!
  pile.push(n)
  const m = b.deck!.find((x) => String(x.n) === n)!
  say(g, p, `${b.name}: «${m.title}». ${m.text}`)
  // Шаг к одному из полюсов встречи — или к нулю по одной из её осей.
  const opts: { id: string; label: string }[] = m.poles.map((pole) => ({ id: `к:${pole}`, label: `шаг к полюсу «${pole}»` }))
  for (const pole of m.poles) {
    const [axis] = charAxisOf(pole)
    const v = p.character[axis]
    if (v) opts.push({ id: `ноль:${axis}`, label: `отойти от «${v < 0 ? CHAR_AXES[axis][0] : CHAR_AXES[axis][1]}» (шаг к нулю)` })
  }
  const unique = opts.filter((o, i) => opts.findIndex((x) => x.id === o.id) === i)
  const a = yield* ask(g, p, 'карта', `«${m.title}»: как ты отозвался на эту встречу?`, unique, { force: true })
  if (a.startsWith('к:')) stepChar(g, p, a.slice(2) as CharPole)
  else {
    const axis = Number(a.slice(5))
    stepChar(g, p, (p.character[axis] < 0 ? CHAR_AXES[axis][1] : CHAR_AXES[axis][0]) as CharPole)
  }
  // 📇 — d6 4–6 (в Центре 3–6): тянешь «Знакомого».
  if (m.acquaintance && die(g, 6) >= t.acqFrom - (b.ring === 'центр' ? t.acqCenterBonus : 0)) {
    const zp = g.s.piles['Знакомые']
    const name = zp.shift()
    if (name) {
      const got = yield* gainItem(g, p, name)
      if (!got) zp.push(name)
      else if (g.items.get(name)?.rules?.some((r) => r.includes('сразу уходит под низ'))) { removeHeld(g, p, got) }
    }
  }
}
/** Шаг характера — через общий charStep: с журналом и пределом ±2. */
const stepChar = (g: G, p: Player, pole: CharPole): void => charStep(g, p, pole)

// ── Прочее ──────────────────────────────────────────────────────────────

/** «Разрешён переход в класс партнёра, если он выше» (ранний брак, исход 4). */
export function* partnerClass(g: G, p: Player): Flow {
  const person = pairOf(g, p)?.person
  const ladder = g.c.tables.work.ladder
  if (!person || ladder[person.cls] <= ladder[p.cls]) return
  const a = yield* ask(g, p, 'класс', `Брак как социальный лифт: перейти в класс партнёра (${person.cls})?`, [
    { id: 'да', label: `перейти в класс ${person.cls}` }, { id: 'нет', label: `остаться: ${p.cls}` },
  ], { force: true })
  if (a === 'да') setClass(g, p, person.cls as Cls)
}

/** Незаконная ловушка: −3 возм. (штраф или взятка); второй раз за отрезок — тюрьма. */
export function lawTrap(g: G, p: Player): void {
  if (p.rules['по знакомству']) return void say(g, p, 'по знакомству: облава прошла мимо')
  say(g, p, '#закон: облава')
  addParam(g, p, 'возм', -3, newCtx('действие'))
  const key = `закон ловушки:${p.seg}`
  p.counters[key] = (p.counters[key] ?? 0) + 1
  if (p.counters[key] >= 2 && !p.inst) enterInst(g, p, 'тюрьма', rollDie(g, p, g.c.tables.inst.prison.light, 'срок'), '#закон')
}

