/**
 * Эмиграция (концепция, «Эмиграция», «Культурная дистанция», «Аккультурация», «Бикультурность», «Гражданство»).
 * Переезд по своей воле, бегство, нелегально, возвращение; граница; что едет с тобой; аккультурация и натурализация;
 * «Без документов»: высылка и легализация.
 */
import { CULTURE_AXES } from '../data/schema.ts'
import { ask, clamp, countryOf, emit, roll3, say, step, type Flow, type G } from './core.ts'
import { has, held, kindOf, newCtx, relation } from './cond.ts'
import { addParam, count, dropHeld, enterInst, gainItem, removeHeld, rollDie, setClass } from './change.ts'
import type { Country, Culture, Player } from './types.ts'

export type Kind = 'по своей воле' | 'бегство' | 'нелегально' | 'домой'
export interface EmigrateOptions {
  kind?: Kind
  /** Страна назначения задана (иначе — выбор игрока). */
  dest?: number
  /** Список стран на выбор (иначе — все, кроме своей). */
  choices?: number[]
  /** Без проверки границы и без цены (стипендия, гражданство). */
  free?: true
  noCheck?: true
  /** По приглашению: цена на 1 дешевле и +1 к границе. */
  invite?: true
  /** Класс сохраняется. */
  keepClass?: true
  /** Можно отказаться (решение игрока); иначе — переезд обязателен, если есть куда. */
  optional?: true
}

// ── Культурная дистанция ────────────────────────────────────────────────

const sq = (a: number[], b: number[]) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0)

/** Дистанция до страны: сумма квадратов разниц по 11 осям; в мультикультурной стране — до ближайшей основной культуры. */
export function distance(g: G, p: Player, c: Country): number {
  const mine = p.ownProfile ?? g.s.world.cultures[p.culture]
  return Math.min(...c.mainCultures.map((k) => sq(mine, g.s.world.cultures[k])))
}
export const penaltyOf = (g: G, d: number): number => step(g.c.tables.emigration.distance, d)

// ── Граница ─────────────────────────────────────────────────────────────

/** Поправка к проверке границы (потолок ±3): союз, культура страны назначения, Диплом, деньги, связь там, Судимость. */
export function borderMod(g: G, p: Player, dest: Country, invite = false): number {
  const t = g.c.tables.emigration.border
  const prof = g.s.world.cultures[dest.mainCultures[0]]
  const ethno = prof[CULTURE_AXES.findIndex(([a]) => a === 'Этноцентризм')]
  let m = 0
  if (relation(g, p.country, dest.id) === 'союз') m += t.ally
  if (ethno === -2) m += t.ethnoStrong
  else if (ethno === -1) m += t.ethnoModerate
  else if (ethno > 0) m += ethno
  if (has(g, p, 'Диплом')) m += t.diploma
  if (p.vozm >= t.rich) m += t.richAdd
  if (invite) m += 1
  if (p.items.some((h) => h.name === 'Земляк' || h.name.includes('за границей'))) m += t.link
  if (has(g, p, 'Судимость')) m += t.record
  return clamp(m, -t.cap, t.cap)
}

/** Можно ли выехать легально: не госсоциализм и не военная диктатура, не во враждебную страну (если нет гражданства там). */
export function legalExit(g: G, p: Player, dest: number): boolean {
  if (p.citizenship.includes(dest) && relation(g, p.country, dest) !== 'вражда') return true
  return !g.c.tables.emigration.closed.includes(countryOf(g, p).ideology) && relation(g, p.country, dest) !== 'вражда'
}

// ── Переезд ─────────────────────────────────────────────────────────────

/** Переезд по правилам. Возвращает, переехал ли игрок. */
export function* emigrate(g: G, p: Player, o: EmigrateOptions = {}): Flow<boolean> {
  const t = g.c.tables.emigration
  if (!p.alive || (p.inst && p.inst.kind !== 'тюрьма' && o.kind !== 'бегство')) return false
  const others = (o.choices ?? g.s.world.countries.map((c) => c.id)).filter((id) => id !== p.country)
  if (!others.length) return false
  const kind: Kind = o.kind ?? 'по своей воле'
  // Куда: выбор игрока, с ценой, отношениями и дистанцией.
  const describeDest = (id: number) => {
    const c = g.s.world.countries[id]
    const rel = relation(g, p.country, id)
    const home = id === p.birthCountry
    const pen = home ? 0 : penaltyOf(g, distance(g, p, c))
    const price = o.free || kind === 'бегство' ? 0 : Math.max(0, t.price[c.pos] - (o.invite ? 1 : 0))
    const legal = kind === 'бегство' || o.noCheck || legalExit(g, p, id)
    return { id: String(id), label: `${c.name}: ${c.pos}, ${c.ideology}`, note: [`${rel}`, price ? `${price} возм.` : 'даром', pen ? `псих. ${pen}` : 'культура близка', home ? 'родина' : '', legal ? '' : 'легально нельзя'].filter(Boolean).join(' · '), ...(price > p.vozm ? { off: 'нет денег' } : {}) }
  }
  const options = (o.dest !== undefined ? [o.dest] : others).map(describeDest)
  // Ни на одну страну не хватает денег — переезд не состоится.
  if (!options.some((x) => !x.off)) { say(g, p, 'уехать не на что'); return false }
  const choice = yield* ask(g, p, 'эмиграция', kind === 'бегство' ? 'Бежать: куда?' : 'Куда уехать?', [...options, ...(o.optional || o.dest === undefined ? [{ id: 'нет', label: 'остаться' }] : [])], { force: true })
  if (choice === 'нет') return false
  const dest = Number(choice)
  const c = g.s.world.countries[dest]
  const ctx = newCtx('правило', { tags: ['#эмиграция'] })
  let legal = true
  if (kind === 'бегство') {
    // Бегство: без цены и без проверки границы; 🎲 Ловкость 15, провал — −3 физ. и половина Возможностей в дороге.
    const roll = roll3(g, p.predisp === t.flight.stat ? 1 : 0)
    const ok = roll.sum + p.stats[t.flight.stat] >= t.flight.dc
    emit(g, { t: 'проверка', p: p.seat, stat: t.flight.stat, dice: roll.dice, kept: roll.sum, value: p.stats[t.flight.stat], mod: 0, trump: 0, dc: t.flight.dc, ok, adv: p.predisp === t.flight.stat ? 1 : 0, what: 'бегство' })
    if (!ok) { addParam(g, p, 'физ', t.flight.phys, ctx); if (p.vozm > 0) addParam(g, p, 'возм', -Math.ceil(p.vozm / 2), ctx) }
    count(p, 'бегство')
  } else {
    const price = o.free ? 0 : Math.max(0, t.price[c.pos] - (o.invite ? 1 : 0))
    if (price) addParam(g, p, 'возм', -price, ctx)
    const citizen = p.citizenship.includes(dest) && relation(g, p.country, dest) !== 'вражда'
    if (!legalExit(g, p, dest) && !o.noCheck) {
      legal = false
      say(g, p, 'легально не выехать: только нелегально')
    } else if (!o.noCheck && !citizen) {
      const mod = borderMod(g, p, c, !!o.invite)
      const roll = roll3(g)
      const ok = roll.sum + mod >= t.border.dc
      emit(g, { t: 'проверка', p: p.seat, stat: 'Смекалка', dice: roll.dice, kept: roll.sum, value: 0, mod, trump: 0, dc: t.border.dc, ok, adv: 0, what: 'граница: 3d6' })
      if (!ok) {
        const a = yield* ask(g, p, 'эмиграция', 'Граница не пропустила. Вернуться ни с чем или въехать нелегально?', [
          { id: 'назад', label: 'вернуться (цена потеряна)' }, { id: 'нелегально', label: 'въехать нелегально: «Без документов»' },
        ], { force: true })
        if (a === 'назад') return false
        legal = false
      }
    }
  }
  yield* arrive(g, p, dest, legal, kind, !!o.keepClass)
  return true
}

/** Что едет с тобой и что ждёт на новом месте («Что едет с тобой», «На новом месте»). */
export function* arrive(g: G, p: Player, dest: number, legal: boolean, kind: Kind, keepClass = false): Flow {
  const t = g.c.tables.emigration
  const from = p.country
  const rel = relation(g, from, dest)
  const back = dest === p.birthCountry
  const ctx = newCtx('правило', { tags: ['#эмиграция'] })
  p.country = dest
  p.counters['Стаж здесь'] = 0
  emit(g, { t: 'текст', p: p.seat, text: `переезд: ${g.s.world.countries[from].name} → ${g.s.world.countries[dest].name}${legal ? '' : ' (нелегально)'}` })
  if (back) {
    count(p, 'возвращение на родину')
    p.counters['аккультурация'] = 0
    delete p.culture2
    // Из враждебной страны домой — только в класс Мафия.
    if (rel === 'вражда') setClass(g, p, 'Мафия')
  } else {
    count(p, 'эмиграция')
    const pen = penaltyOf(g, distance(g, p, g.s.world.countries[dest]))
    if (pen) addParam(g, p, 'псих', pen, ctx)
    p.counters['аккультурация'] = 0
    p.counters['штраф дистанции'] = -pen
    p.counters['провалы аккультурации'] = 0
    // Класс: Народ, кроме исключений.
    const capital = keepClass || p.cls === 'Олигархи' || p.vozm >= t.capital
    if (!capital && p.cls !== 'Народ') {
      if (p.cls === 'Мафия') {
        const a = yield* ask(g, p, 'эмиграция', 'Чужая сеть принимает только снизу: остаться Мафией (Положение −1) или стать Народом?', [
          { id: 'мафия', label: 'остаться Мафией, Положение −1' }, { id: 'народ', label: 'стать Народом' },
        ], { force: true })
        if (a === 'мафия') addParam(g, p, 'Положение', -1, ctx)
        else setClass(g, p, 'Народ')
      } else if (p.cls === 'Интеллигенция' && has(g, p, 'Диплом')) {
        const roll = roll3(g, p.predisp === 'Интеллект' ? 1 : 0)
        const ok = roll.sum + p.stats['Интеллект'] >= t.diplomaDc
        emit(g, { t: 'проверка', p: p.seat, stat: 'Интеллект', dice: roll.dice, kept: roll.sum, value: p.stats['Интеллект'], mod: 0, trump: 0, dc: t.diplomaDc, ok, adv: p.predisp === 'Интеллект' ? 1 : 0, what: 'признание диплома' })
        if (!ok) setClass(g, p, 'Народ')
      } else setClass(g, p, 'Народ')
    }
  }
  // Ключи старой страны гаснут; «Диплом» остаётся.
  for (const name of ['Присяга', 'Значок']) for (const h of held(g, p, name)) removeHeld(g, p, h)
  // Связи: каждая на d6 1–3 теряется (Друг детства — 1–4); «Знакомые» остаются дома.
  for (const h of [...p.items]) {
    const item = g.items.get(h.name)
    if (!item) continue
    if (item.kind === 'знакомый') { removeHeld(g, p, h); continue }
    if (item.group === 'Друг' || item.group === 'Наставник' || item.group === 'Покровитель') {
      const limit = h.name === 'Друг детства' ? t.childhoodFriendLoss : t.linkLoss
      if (rollDie(g, p, 6, `связь «${h.name}» едет?`) <= limit) { say(g, p, `«${h.name}» остаётся`); removeHeld(g, p, h) }
    }
    if (item.kind === 'вещь' && rollDie(g, p, 6, `вещь «${h.name}» в дороге`) <= t.thingLoss) { say(g, p, `«${h.name}» потеряна в дороге`); removeHeld(g, p, h) }
  }
  // Партнёр едет или остаётся — по выбору игрока; Супруг(а) и дети едут.
  const partner = p.items.find((h) => !h.spouse && g.items.get(h.name)?.group === 'Партнёр')
  if (partner) {
    const a = yield* ask(g, p, 'эмиграция', `Партнёр («${partner.name}») едет с тобой?`, [{ id: 'да', label: 'едет' }, { id: 'нет', label: 'остаётся: расставание (−2 псих.)' }], { force: true })
    if (a === 'нет') yield* dropHeld(g, p, partner, true)
  }
  // Стигмы — по отношениям: союз — едут; нейтралитет — «Судимость» и «Учёт» дома, «Долг» едет; вражда — всё дома.
  for (const h of [...p.items]) {
    if (kindOf(g, h) !== 'стигма') continue
    if (rel !== 'союз' && (h.name === 'Судимость' || h.name === 'Учёт')) removeHeld(g, p, h)
    if (rel === 'вражда' && h.name === 'Долг') removeHeld(g, p, h)
    if (h.name === 'Дурная слава' || (h.name === 'Враг' && rel !== 'союз')) removeHeld(g, p, h)
    if (h.name === 'Без документов') removeHeld(g, p, h)
  }
  if (!legal && !p.citizenship.includes(dest)) { yield* gainItem(g, p, 'Без документов'); p.counters['подработка без документов'] = 0 }
  if (kind === 'бегство') say(g, p, 'беженец')
}

// ── Аккультурация и гражданство на входе в отрезок ──────────────────────

/** Аккультурация: шаг 0–3; шаг 3 — бикультурность, до Зрелости можно полностью сменить культуру. */
export function* acculturate(g: G, p: Player): Flow {
  const t = g.c.tables.emigration
  if (p.country === p.birthCountry || !p.alive || p.inst) return
  const c = countryOf(g, p)
  if (c.mainCultures.includes(p.culture)) return
  const stepNow = p.counters['аккультурация'] ?? 0
  if (stepNow < t.acc.steps) {
    const a = yield* ask(g, p, 'эмиграция', `Аккультурация в стране ${c.name}: шаг ${stepNow} из ${t.acc.steps}. Врастать в новую культуру или держаться своих?`, [
      { id: 'да', label: 'врастать: бросок 3d6' }, { id: 'нет', label: 'держаться своих (сепарация: +1 в #община с диаспорой)' },
    ], { force: true })
    if (a === 'нет') { p.rules['сепарация'] = {}; return }
    delete p.rules['сепарация']
    const pen = p.counters['штраф дистанции'] ?? 0
    const adv = p.seg < ['Детство', 'Юность', 'Молодость', 'Зрелость'].indexOf(t.acc.before) ? 1 : 0
    const mod = step(g.c.tables.statMod, p.stats['Интеллект'])
    const roll = roll3(g, adv)
    const dc = t.acc.base + pen
    const ok = roll.sum + mod >= dc
    emit(g, { t: 'проверка', p: p.seat, stat: 'Интеллект', dice: roll.dice, kept: roll.sum, value: 0, mod, trump: 0, dc, ok, adv, what: 'аккультурация' })
    if (ok) {
      p.counters['аккультурация'] = stepNow + 1
      p.counters['аккультурация (максимум за жизнь)'] = Math.max(p.counters['аккультурация (максимум за жизнь)'] ?? 0, stepNow + 1)
      p.counters['провалы аккультурации'] = 0
      if (pen) addParam(g, p, 'псих', Math.ceil(pen / 3), newCtx('правило'))
      if (stepNow + 1 >= t.acc.steps) yield* bicultural(g, p, c.mainCultures[0])
    } else {
      p.counters['провалы аккультурации'] = (p.counters['провалы аккультурации'] ?? 0) + 1
      if (p.counters['провалы аккультурации'] >= t.acc.failsToMarginal) {
        say(g, p, 'маргинализация: ни своя, ни чужая культура')
        addParam(g, p, 'псих', t.acc.marginal, newCtx('правило'))
        p.counters['провалы аккультурации'] = 0
      }
    }
  }
}

/** Шаг 3: бикультурность (личная культура — среднее, округление к родной) или, до Зрелости, ассимиляция. */
function* bicultural(g: G, p: Player, other: Culture): Flow {
  const before = p.seg < 3
  if (before) {
    const a = yield* ask(g, p, 'эмиграция', `Шаг 3. Полностью сменить культуру на ${other} или стать бикультурным?`, [
      { id: 'смена', label: `ассимиляция: культура — ${other}` }, { id: 'би', label: 'бикультурность: личная культура' },
    ], { force: true })
    if (a === 'смена') { p.culture = other; delete p.culture2; delete p.ownProfile; say(g, p, `культура теперь — ${other}`); return }
  }
  const mine = p.ownProfile ?? g.s.world.cultures[p.culture]
  const theirs = g.s.world.cultures[other]
  p.ownProfile = mine.map((x, i) => { const avg = (x + theirs[i]) / 2; return Number.isInteger(avg) ? avg : x < theirs[i] ? Math.floor(avg) : Math.ceil(avg) })
  p.culture2 = other
  say(g, p, `бикультурность: своя и ${other}`)
}

/** Натурализация: шаг 2+ и Стаж 5 в стране → 🎲 Смекалка 12 (союзная страна — без проверки). */
export function naturalize(g: G, p: Player): void {
  const t = g.c.tables.emigration
  if (p.citizenship.includes(p.country) || has(g, p, 'Без документов')) return
  if ((p.counters['аккультурация'] ?? 0) < t.naturalize.step || (p.counters['Стаж здесь'] ?? 0) < t.naturalize.stazh) return
  let ok = relation(g, p.birthCountry, p.country) === 'союз'
  if (!ok) {
    const roll = roll3(g)
    ok = roll.sum + p.stats['Смекалка'] + (p.items.some((h) => h.spouse) ? 2 : 0) >= t.naturalize.dc
    emit(g, { t: 'проверка', p: p.seat, stat: 'Смекалка', dice: roll.dice, kept: roll.sum, value: p.stats['Смекалка'], mod: 0, trump: 0, dc: t.naturalize.dc, ok, adv: 0, what: 'натурализация' })
  }
  if (!ok) return
  if (t.singleCitizenship.includes(countryOf(g, p).ideology)) p.citizenship = []
  p.citizenship.push(p.country)
  say(g, p, `гражданство: ${countryOf(g, p).name}`)
}

/** «Без документов»: карта #закон — d6 1–2 высылка домой (из враждебной страны — тюрьма). */
export function* deportRisk(g: G, p: Player): Flow {
  const t = g.c.tables.emigration
  if (!has(g, p, 'Без документов') || p.inst || !p.alive) return
  if (rollDie(g, p, 6, 'риск депортации') > t.deportUpTo) return
  const hostile = relation(g, p.country, p.birthCountry) === 'вражда'
  say(g, p, 'депортация')
  for (const h of held(g, p, 'Без документов')) removeHeld(g, p, h)
  yield* arrive(g, p, p.birthCountry, true, 'домой')
  if (hostile) enterInst(g, p, 'тюрьма', rollDie(g, p, g.c.tables.inst.prison.light, 'срок'), '#закон')
}

/** Легализация: каждые 3 хода Подработки без документов — 🎲 Смекалка 15. */
export function legalize(g: G, p: Player): void {
  const t = g.c.tables.emigration
  if (!has(g, p, 'Без документов')) return
  p.counters['подработка без документов'] = (p.counters['подработка без документов'] ?? 0) + 1
  if (p.counters['подработка без документов'] % t.legalizeTurns) return
  const roll = roll3(g)
  const ok = roll.sum + p.stats['Смекалка'] >= t.legalizeDc
  emit(g, { t: 'проверка', p: p.seat, stat: 'Смекалка', dice: roll.dice, kept: roll.sum, value: p.stats['Смекалка'], mod: 0, trump: 0, dc: t.legalizeDc, ok, adv: 0, what: 'легализация' })
  if (ok) for (const h of held(g, p, 'Без документов')) removeHeld(g, p, h)
}

/** Правило карты «эмиграция» с аргументом — в параметры переезда. */
export function* emigrationRule(g: G, p: Player, arg = ''): Flow {
  const core = g.s.world.countries.filter((c) => c.pos === 'ядро').map((c) => c.id)
  if (arg.startsWith('шаг аккультурации')) {
    if (p.country !== p.birthCountry) p.counters['аккультурация'] = Math.min(g.c.tables.emigration.acc.steps, (p.counters['аккультурация'] ?? 0) + 1)
    return
  }
  if (arg.includes('Земли за ледником')) return void say(g, p, '«Земли за ледником» — только режим «Род»')
  if (arg.includes('сразу в страну ядра')) { yield* emigrate(g, p, { dest: core[0], free: true, noCheck: true, optional: true }); return }
  if (arg.startsWith('домой')) { if (p.country !== p.birthCountry) yield* emigrate(g, p, { dest: p.birthCountry, noCheck: true, kind: 'домой' }); return }
  if (arg.startsWith('в страну ядра или полупериферии')) {
    const choices = g.s.world.countries.filter((c) => c.pos !== 'периферия' && c.id !== p.country).map((c) => c.id)
    yield* emigrate(g, p, { choices, free: true, noCheck: true })
    return
  }
  yield* emigrate(g, p, { optional: true, ...(arg.startsWith('по приглашению') ? { invite: true } : {}), ...(arg.includes('класс сохраняется') ? { keepClass: true } : {}) })
}

/** Сколько отрезков игрок был без нарушений и т. п. — угасание стигм на входе в отрезок (каталог стигм, «Как снять»). */
export function decayStigmas(g: G, p: Player): void {
  const t = g.c.tables.stigmaDecay
  const prev = p.seg - 1
  const clean = (place: string, n: number) => Array.from({ length: n }, (_, i) => prev - i).every((s) => !(p.visits[place] ?? []).includes(s))
  for (const h of [...p.items]) {
    if (kindOf(g, h) !== 'стигма') continue
    const got = h.seg ?? -1
    const need = h.decay ?? t[h.name]
    if (h.name === 'Судимость' && got <= prev - need && clean('тюрьма', need)) { removeHeld(g, p, h); say(g, p, '«Судимость» погасла: отрезок без нарушений') }
    if (h.name === 'Учёт' && got <= prev - need && clean('психбольница', need)) { removeHeld(g, p, h); say(g, p, '«Учёт» погас') }
    if (h.name === 'Долг' && got <= prev - need && clean('в минусе', need)) { removeHeld(g, p, h); say(g, p, '«Долг» погас: отрезок без минуса') }
  }
  const bad = p.items.filter((h) => h.name === 'Дурная слава')
  if (bad.length) {
    const name = p.items.some((h) => h.name.startsWith('Имя '))
    const donated = (p.counters[`пожертвования:${prev}`] ?? 0) >= 2
    const quiet = !(p.visits['стигма получена'] ?? []).includes(prev) && (bad[0].seg ?? -1) < prev
    if (name) { for (const h of bad) removeHeld(g, p, h); say(g, p, '«Дурная слава» снята: имя сильнее') }
    else if (donated || quiet) { removeHeld(g, p, bad[0]); say(g, p, '«Дурная слава» гаснет') }
  }
}

