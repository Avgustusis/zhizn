/** Исполнитель карт: обходит шаги эффекта (`Node`) и меняет состояние. Там, где нужен игрок, задаёт вопрос. */
import { STATS, type Node } from '../data/schema.ts'
import { ask, countryOf, clamp, emit, say, type Flow, type G } from './core.ts'
import { cond, has, type Ctx } from './cond.ts'
import { addParam, charStep, enterInst, gainItem, leaveInst, loseItem, rollDie, setClass, setParam, statCap } from './change.ts'
import { runCheck, spend, strongIn } from './checks.ts'
import { runRule } from './rules.ts'
import type { Player, Stat } from './types.ts'

/** Попадает ли значение кубика в диапазон «1-2» или «6». */
const inRange = (range: string, v: number): boolean => {
  const [a, b] = range.split('-').map(Number)
  return v >= a && v <= (b ?? a)
}

/** В ветке есть шаг «+1 к характеристике проверки» — тогда характеристику выбирает игрок. */
const usesStat = (nodes: Node[]): boolean => JSON.stringify(nodes).includes('"addUsed"')

/** Ветка полюса в колоде «по полюсам»: при «сильно» числа на 1 крупнее. Явное `strong` в условии — числа уже точные. */
function branchCtx(g: G, p: Player, ctx: Ctx, c: Parameters<typeof cond>[2]): Ctx {
  if (!ctx.polar || ctx.strong) return ctx
  return strongIn(g, p, c) ? { ...ctx, strong: true } : ctx
}

/** Выполнить шаги по порядку. Смерть игрока обрывает карту. */
export function* run(g: G, p: Player, nodes: Node[], ctx: Ctx): Flow {
  for (const node of nodes) {
    if (!p.alive) return
    yield* runNode(g, p, node, ctx)
  }
}

function* runNode(g: G, p: Player, n: Node, ctx: Ctx): Flow {
  if ('add' in n) {
    const c = n.cap !== undefined ? { ...ctx, cap: n.cap } : ctx
    for (const [param, delta] of Object.entries(n.add)) addParam(g, p, param, delta, c)
  } else if ('say' in n) say(g, p, n.say)
  else if ('if' in n) {
    if (cond(g, p, n.if, ctx)) yield* run(g, p, n.then, branchCtx(g, p, ctx, n.if))
    else if (n.else) yield* run(g, p, n.else, ctx)
  } else if ('cases' in n) {
    const hit = n.cases.find((c) => cond(g, p, c.if, ctx))
    if (hit) yield* run(g, p, hit.then, branchCtx(g, p, ctx, hit.if))
    else if (n.else) yield* run(g, p, n.else, ctx)
  } else if ('d6' in n) {
    // Один бросок на уровень карты; исход открывает новый уровень со своим броском.
    ctx.d6 ??= {}
    ctx.d6.value ??= rollDie(g, p, 6, 'карта')
    const v = ctx.d6.value
    for (const [range, then] of Object.entries(n.d6)) if (inRange(range, v)) yield* run(g, p, then, { ...ctx, d6: {} })
  } else if ('choose' in n) {
    const options = n.choose.map((o, i) => ({ id: String(i), label: o.label, ...(cond(g, p, o.if, ctx) ? {} : { off: 'недоступно' }) }))
    if (options.every((o) => o.off)) { say(g, p, 'ни один вариант не доступен'); return }
    const id = yield* ask(g, p, 'карта', title(g, ctx), options, { card: ctx.card, force: true })
    const o = n.choose[Number(id)]
    ctx.shared.chose.push(o.label)
    emit(g, { t: 'выбор', p: p.seat, label: o.label })
    yield* run(g, p, o.then, ctx)
  } else if ('check' in n) {
    const ok = yield* runCheck(g, p, n.check, ctx, usesStat([...n.success, ...n.failure]))
    yield* run(g, p, ok ? n.success : n.failure, ctx)
  } else if ('gain' in n) yield* gainItem(g, p, n.gain, n.adopted ? { adopted: true } : {})
  else if ('lose' in n) yield* loseItem(g, p, n.lose, !!n.price, ctx.tags.includes('#утрата'))
  else if ('rule' in n) yield* runRule(g, p, n.rule, n.arg, ctx)
  else if ('charStep' in n) charStep(g, p, n.charStep, n.n ?? 1)
  else if ('mod' in n) p.mods.push({ ...n.mod, seg: p.seg })
  else if ('cls' in n) setClass(g, p, n.cls)
  else if ('stab' in n) {
    const c = ctx.target !== undefined ? g.s.world.countries[ctx.target] : countryOf(g, p)
    const w = g.c.tables.world.stability
    c.stability = clamp(c.stability + n.stab, w.min, w.max)
  } else if ('miracle' in n) {
    const list = n.miracle === 'любая' ? [...STATS] : n.miracle
    const stat = (list.length === 1 ? list[0] : yield* ask(g, p, 'характеристика', 'Чудо: какая характеристика?', list.map((s) => ({ id: s, label: `${s} ${p.stats[s]}` })), { card: ctx.card })) as Stat
    if (!p.unsealed.includes(stat)) p.unsealed.push(stat)
    p.counters['чудо'] = (p.counters['чудо'] ?? 0) + 1
    addParam(g, p, stat, g.c.tables.caps.miracleAdd, { ...ctx, cap: g.c.tables.caps.miracle })
  } else if ('prison' in n) {
    const t = g.c.tables.inst.prison
    const turns = n.prison === 'тяжёлое' ? rollDie(g, p, t.heavyDie, 'срок') + t.heavyAdd : rollDie(g, p, t.light, 'срок')
    enterInst(g, p, 'тюрьма', turns, ctx.tags[0])
  } else if ('term' in n) { if (p.inst) p.inst.left = Math.max(0, p.inst.left + n.term) }
  else if ('later' in n) p.laters.push({ when: n.later.when, then: n.later.then, ...(ctx.card ? { card: ctx.card } : {}), ...(n.later.until ? { seg: p.seg } : {}) })
  else if ('release' in n) yield* leaveInst(g, p, !!n.noStigma)
  else if ('useTrump' in n) {
    const h = p.items.find((x) => n.useTrump.includes(x.name))
    const a = h ? yield* ask(g, p, 'козырь', `Сыграть «${h.name}»?`, [{ id: 'да', label: `сыграть «${h.name}»` }, { id: 'нет', label: 'оставить' }], { card: ctx.card, force: true }) : 'нет'
    if (h && a === 'да') { spend(g, p, h); yield* run(g, p, n.then, ctx) } else yield* run(g, p, n.else, ctx)
  } else if ('cancelable' in n) {
    const h = p.items.find((x) => n.cancelable.includes(x.name))
    const a = h ? yield* ask(g, p, 'отмена', `Отменить последствия козырем «${h.name}»?`, [{ id: 'да', label: `сыграть «${h.name}»` }, { id: 'нет', label: 'оставить' }], { card: ctx.card, force: true }) : 'нет'
    if (h && a === 'да') spend(g, p, h)
    else yield* run(g, p, n.then, ctx)
  } else if ('flag' in n) p.flags[n.flag] = true
  else if ('income' in n) p.income.push({ add: n.income, until: n.until, seg: p.seg })
  else if ('allowCls' in n) {
    const a = yield* ask(g, p, 'класс', `Перейти в класс ${n.allowCls}?`, [{ id: 'да', label: `перейти в класс ${n.allowCls}` }, { id: 'нет', label: `остаться: ${p.cls}` }], { card: ctx.card, force: true })
    if (a === 'да') setClass(g, p, n.allowCls)
  } else if ('addOneOf' in n) {
    const stat = yield* ask(g, p, 'характеристика', `${n.n > 0 ? '+' : ''}${n.n} к одной характеристике`, n.addOneOf.map((s) => ({ id: s, label: `${s} ${p.stats[s]}`, ...(n.n > 0 && p.stats[s] >= (ctx.cap ?? statCap(g, p, s)) ? { off: 'потолок' } : {}) })).map(openIfAllOff), { card: ctx.card })
    addParam(g, p, stat, n.n, ctx)
  } else if ('addClassStat' in n) {
    const fit = g.c.tables.work.fit[p.cls]
    if (n.both) for (const s of fit) addParam(g, p, s, n.addClassStat, ctx)
    else {
      const stat = yield* ask(g, p, 'характеристика', `+${n.addClassStat} к характеристике своего класса`, fit.map((s) => ({ id: s, label: `${s} ${p.stats[s]}` })), { card: ctx.card })
      addParam(g, p, stat, n.addClassStat, ctx)
    }
  } else if ('addUsed' in n) { if (ctx.shared.used) addParam(g, p, ctx.shared.used, n.addUsed, ctx) }
  else if ('addPredisp' in n) addParam(g, p, p.predisp, n.addPredisp, ctx)
  else if ('halve' in n) { if (p.vozm > 0) addParam(g, p, 'возм', -Math.floor(p.vozm / 2), ctx) }
  else if ('set' in n) for (const [param, v] of Object.entries(n.set)) setParam(g, p, param, v)
  else if ('workoff' in n) { if (p.inst) p.inst.workoff = n.workoff }
  else if ('noAging' in n) p.noAging += n.noAging
  else if ('pension' in n) p.pensionAdd += n.pension
  else if ('everySeg' in n) p.everySeg.push(n.everySeg)
  else if ('installments' in n) p.installments.push({ left: n.installments, each: n.each })
  else if ('reshuffle' in n) ctx.shared.dispose = 'замешать'
  else if ('bottom' in n) { /* сыгранная карта и так уходит под низ колоды */ }
  else throw new Error(`неизвестный шаг: ${JSON.stringify(n)}`)
}

/** Если закрыты все варианты (все характеристики на потолке), вопрос остаётся — выбор ничего не изменит. */
function openIfAllOff<T extends { off?: string }>(o: T, _i: number, all: T[]): T {
  if (all.every((x) => x.off)) { const { off: _off, ...rest } = o; return rest as T }
  return o
}

function title(g: G, ctx: Ctx): string {
  const card = ctx.card ? g.cards.get(ctx.card)?.card : undefined
  return card ? `${card.title}. ${card.text || card.src}` : 'Что выбираешь?'
}

export { has }
