/**
 * Этап 3г: розыгрыш козырей, антикозырей, расходных вещей и «Знакомых».
 * «В любой момент» — меню «сыграть карту» в вопросе хода (ход не тратится). По ситуации — в своих точках партии:
 * кабала, смерть, граница, призыв, карта #война, смена класса, потери Возможностей, новые люди, колода событий.
 */
import { ask, say, type Flow, type G } from './core.ts'
import { kindOf, newCtx, relation, type Ctx } from './cond.ts'
import { addParam, gainItem, leaveInst, rollDie, setClass } from './change.ts'
import { spend } from './checks.ts'
import { run } from './exec.ts'
import { emigrate } from './emigration.ts'
import { stab } from './world.ts'
import { offFront } from './war.ts'
import type { Cls, Held, Player, Stat } from './types.ts'

type Play = NonNullable<ReturnType<G['items']['get']>>['play'] extends (infer X)[] | undefined ? X : never

/** Розыгрыш с риском: антикозырь — катастрофа на d6 1–2 после розыгрыша. */
function* risk(g: G, p: Player, h: Held): Flow {
  const item = g.items.get(h.name)
  if (kindOf(g, h) !== 'антикозырь' || !item?.risk) return
  if (rollDie(g, p, 6, `риск «${h.name}»: катастрофа на 1–2`) <= 2) yield* run(g, p, item.risk, newCtx('правило'))
}

/** Розыгрыши «в любой момент»: правило с карты → когда можно и что делает. */
const ANYTIME: Record<string, { when?: (g: G, p: Player) => boolean; run: (g: G, p: Player) => Flow }> = {
  'Стабильность любой страны −2': {
    *run(g, p) {
      const id = yield* ask(g, p, 'предмет', 'Какой стране стабильность −2?', g.s.world.countries.map((c) => ({ id: String(c.id), label: `${c.name}: стабильность ${c.stability}` })), { force: true })
      stab(g, g.s.world.countries[Number(id)], -2)
    },
  },
  'Гражданство выбранной страны без проверки (кроме враждебной)': {
    when: (g, p) => g.s.world.countries.some((c) => !p.citizenship.includes(c.id) && relation(g, p.country, c.id) !== 'вражда'),
    *run(g, p) {
      const list = g.s.world.countries.filter((c) => !p.citizenship.includes(c.id) && relation(g, p.country, c.id) !== 'вражда')
      const id = yield* ask(g, p, 'предмет', 'Гражданство какой страны?', list.map((c) => ({ id: String(c.id), label: c.name })), { force: true })
      p.citizenship.push(Number(id))
      say(g, p, `гражданство: ${g.s.world.countries[Number(id)].name}`)
    },
  },
  'Возможности удваиваются (если выше 0) или становятся 0 (если ниже)': {
    *run(g, p) {
      if (p.vozm > 0) addParam(g, p, 'возм', p.vozm, newCtx('правило'))
      else if (p.vozm < 0) addParam(g, p, 'возм', -p.vozm, newCtx('правило'))
      yield* []
    },
  },
  '+2 к Красоте, Силе, Выносливости или Ловкости сверх потолка рынка (до 10)': {
    *run(g, p) {
      const list: Stat[] = ['Красота', 'Сила', 'Выносливость', 'Ловкость']
      const st = (yield* ask(g, p, 'характеристика', 'Подпольный хирург: что улучшить (+2, до 10)?', list.map((s) => ({ id: s, label: `${s} ${p.stats[s]}` })), { force: true })) as Stat
      addParam(g, p, st, 2, newCtx('правило', { cap: 10 }))
    },
  },
  'Эмиграция куда угодно без проверки и цены; стигмы остаются дома': {
    when: (_g, p) => p.seg >= 2 && !p.inst,
    *run(g, p) {
      const before = p.items.filter((h) => kindOf(g, h) === 'стигма').map((h) => h.uid)
      if (yield* emigrate(g, p, { free: true, noCheck: true, optional: true })) {
        for (const h of p.items.filter((x) => before.includes(x.uid))) p.items.splice(p.items.indexOf(h), 1)
        say(g, p, 'купленный паспорт: стигмы остались дома')
      }
    },
  },
  'Выйти из тюрьмы, кабалы, с фронта или из страны прямо сейчас': {
    *run(g, p) {
      if (p.inst?.kind === 'фронт') { offFront(g, p, 'товарный вагон'); return }
      if (p.inst) { yield* leaveInst(g, p, true); say(g, p, 'товарный вагон: вышел'); return }
      yield* emigrate(g, p, { kind: 'бегство', optional: true })
    },
  },
  'Ключ к любому классу, кроме Олигархов: работа по чужому диплому': {
    *run(g, p) {
      const list = (['Народ', 'Армия', 'Полиция', 'Интеллигенция', 'Мафия'] as Cls[]).filter((c) => c !== p.cls)
      const cls = (yield* ask(g, p, 'класс', 'Липовый диплом: какой класс?', list.map((c) => ({ id: c, label: c })), { force: true })) as Cls
      setClass(g, p, cls)
    },
  },
  'Малый обмен в больнице бесплатно': {
    *run(g, p) {
      const a = g.c.actions.find((x) => x.id === 'больница')
      if (a) yield* run(g, p, a.effect, newCtx('правило'))
    },
  },
  'Срок в психбольнице −2 хода': {
    when: (_g, p) => p.inst?.kind === 'психбольница',
    *run(g, p) { p.inst!.left = Math.max(0, p.inst!.left - 2); say(g, p, 'знакомый врач: срок −2 хода'); yield* [] },
  },
  'Только в тюрьме': { when: (_g, p) => p.inst?.kind === 'тюрьма', *run() { yield* [] } },
}

/** Описательные правила при розыгрыше эффекта — что ещё сделать после него. */
function* afterEffect(g: G, p: Player, rule?: string): Flow {
  if (rule === 'Каждый раз считается визитом в бар для «Привычки»') {
    p.counters[`действие:бар:${p.seg}`] = (p.counters[`действие:бар:${p.seg}`] ?? 0) + 1
    const at = p.items.some((h) => h.name === 'Собутыльник') ? 2 : 3
    if (p.counters[`действие:бар:${p.seg}`] === at) yield* gainItem(g, p, 'Привычка')
  }
}

/** Что можно сыграть сейчас вне проверки: эффект с карты или правило «в любой момент». */
export function anytimePlays(g: G, p: Player): { id: string; h: Held; pl: Play; label: string; note: string }[] {
  const out: { id: string; h: Held; pl: Play; label: string; note: string }[] = []
  for (const h of p.items) {
    const item = g.items.get(h.name)
    if (!item?.play || h.spouse) continue
    item.play.forEach((pl, i) => {
      const any = ANYTIME[pl.rule ?? '']
      if (!pl.effect && !any) return
      if (any?.when && !any.when(g, p)) return
      if (pl.tags || pl.any) return // карты к проверке играются при проверке
      out.push({ id: `${h.uid}:${i}`, h, pl, label: `«${h.name}»${pl.label ? `: ${pl.label}` : ''}`, note: [pl.rule, kindOf(g, h) === 'антикозырь' ? 'антикозырь: катастрофа на d6 1–2' : ''].filter(Boolean).join(' · ') })
    })
  }
  return out
}

/** Меню «сыграть карту» (из вопроса хода): ход не тратится. */
export function* playMenu(g: G, p: Player): Flow {
  const list = anytimePlays(g, p)
  if (!list.length) return
  const id = yield* ask(g, p, 'козырь', 'Какую карту сыграть сейчас?', [...list.map((x) => ({ id: x.id, label: x.label, ...(x.note ? { note: x.note } : {}), ...(x.pl.effect ? { effect: x.pl.effect } : {}) })), { id: 'нет', label: 'ничего' }], { force: true })
  const x = list.find((v) => v.id === id)
  if (!x) return
  spend(g, p, x.h)
  if (x.pl.effect) yield* run(g, p, x.pl.effect, newCtx('правило', { card: x.h.name }))
  const any = ANYTIME[x.pl.rule ?? '']
  if (any) yield* any.run(g, p)
  else yield* afterEffect(g, p, x.pl.rule)
  yield* risk(g, p, x.h)
}

// ── По ситуации ─────────────────────────────────────────────────────────

/** Найти карту с этим правилом розыгрыша. */
const holder = (g: G, p: Player, rule: string): Held | undefined => p.items.find((h) => g.items.get(h.name)?.play?.some((pl) => pl.rule === rule))

/** Вопрос «сыграть?» по ситуации. */
function* offer(g: G, p: Player, h: Held, text: string, ctx?: Ctx): Flow<boolean> {
  const a = yield* ask(g, p, 'козырь', `${text} Сыграть «${h.name}»?`, [{ id: 'да', label: `сыграть «${h.name}»` }, { id: 'нет', label: 'оставить' }], { ...(ctx?.card ? { card: ctx.card } : {}), force: true })
  if (a !== 'да') return false
  spend(g, p, h)
  yield* risk(g, p, h)
  return true
}

/** Кабала: «Семейные сбережения» — один раз не попасть (остаёшься на −19). */
export function* saveFromBondage(g: G, p: Player): Flow<boolean> {
  const h = holder(g, p, 'Один раз не попасть в кабалу (остаёшься на −19)')
  return h ? yield* offer(g, p, h, 'Возможности дошли до кабалы.') : false
}

/** Карта #война для себя и семьи: «Друг в Генштабе» отменяет её. */
export function* cancelWarCard(g: G, p: Player, tags: string[], ctx: Ctx): Flow<boolean> {
  if (!tags.includes('#война')) return false
  const h = holder(g, p, 'Отменить одну карту #война для себя и семьи')
  return h ? yield* offer(g, p, h, 'Карта #война.', ctx) : false
}

/** Класс теряется в «Смуте», кризисе или мировом событии: «Золотой парашют». */
export function* keepClass(g: G, p: Player, to: Cls, ctx: Ctx): Flow<boolean> {
  const ladder = g.c.tables.work.ladder
  if (ladder[to] >= ladder[p.cls] || !['смута', 'мир', 'страна'].includes(ctx.deck ?? '')) return false
  const h = holder(g, p, 'Один раз класс не теряется: Смута, кризис, мировое событие')
  return h ? yield* offer(g, p, h, `Класс ${p.cls} теряется (станешь ${to}).`, ctx) : false
}

/** Потеря Возможностей: «Офшор» (Смута, эмиграция, суд, кризис — один раз целиком); «Сосед-электрик» — потеря до 2. */
export function* saveVozm(g: G, p: Player, delta: number, ctx: Ctx): Flow<number> {
  if (delta >= 0) return delta
  const offshoreCtx = ['смута', 'тюрьма'].includes(ctx.deck ?? '') || ctx.tags.includes('#эмиграция') || ctx.tags.includes('#политика')
  const off = offshoreCtx ? holder(g, p, 'Один раз Возможности не теряются: Смута, эмиграция, суд, кризис') : undefined
  if (off && (yield* offer(g, p, off, `Потеря ${delta} возм.`, ctx))) { say(g, p, '«Офшор»: деньги там, где их не считают'); return 0 }
  const small = delta >= -2 ? holder(g, p, 'Отменить одну потерю Возможностей до 2') : undefined
  if (small && (yield* offer(g, p, small, `Потеря ${delta} возм.`, ctx))) return 0
  return delta
}

/** Граница: «Земляк за границей» и «Дальний родственник» — +2; «Контрабандный канал» — нелегально без проверки и без потери цены. */
export function* borderHelp(g: G, p: Player): Flow<number> {
  const h = holder(g, p, '+2 к броску на границе')
  return h && (yield* offer(g, p, h, 'Проверка границы.')) ? 2 : 0
}
export function* smugglerChannel(g: G, p: Player): Flow<boolean> {
  const h = holder(g, p, 'Нелегальный переход границы без проверки и без потери цены')
  return h ? yield* offer(g, p, h, 'Переход границы.') : false
}
export function* safeContraband(g: G, p: Player): Flow<boolean> {
  const h = holder(g, p, 'Одна «Контрабанда» без риска')
  return h ? yield* offer(g, p, h, '«Контрабанда».') : false
}

/** Новый Партнёр или Друг вслепую: «Тот, кто всех знает» — тянешь две карты, берёшь одну. */
export function* twoDraws(g: G, p: Player, group: string, draw: () => string): Flow<string> {
  const first = draw()
  if (group !== 'Партнёр' && group !== 'Друг') return first
  const h = holder(g, p, 'Следующий «Партнёр» или «Друг»: тянешь две карты, берёшь одну')
  if (!h || !(yield* offer(g, p, h, `Новый человек («${group}»).`))) return first
  const second = draw()
  return (yield* ask(g, p, 'предмет', 'Кого берёшь?', [{ id: first, label: first }, { id: second, label: second }], { force: true }))
}

/** Перед картой события: «Старушка у подъезда» — посмотреть верхнюю карту, можно убрать под низ. */
export function* peekTop(g: G, p: Player, title: string, text: string): Flow<boolean> {
  const h = holder(g, p, 'Посмотреть верхнюю карту колоды события перед вытягиванием; можно убрать её под низ')
  if (!h) return false
  const a = yield* ask(g, p, 'козырь', `«${h.name}» может подсказать, что дальше. Посмотреть верхнюю карту?`, [{ id: 'да', label: 'посмотреть (карта уйдёт)' }, { id: 'нет', label: 'не надо' }], { force: true })
  if (a !== 'да') return false
  spend(g, p, h)
  const b = yield* ask(g, p, 'карта', `Сверху: «${title}». ${text} Оставить или убрать под низ?`, [{ id: 'оставить', label: 'оставить' }, { id: 'под низ', label: 'убрать под низ' }], { force: true })
  return b === 'под низ'
}

/** Путешествие: «Билетёр», «Проводник поезда» — на 1 возм. дешевле (карта уходит). */
export function travelDiscount(g: G, p: Player): number {
  const h = holder(g, p, 'Путешествие на 1 возм. дешевле')
  if (!h) return 0
  spend(g, p, h)
  say(g, p, `«${h.name}»: путешествие на 1 возм. дешевле`)
  return 1
}

/** Физическое здоровье −10: «Лечение за границей» отменяет одну смерть (остаёшься на −9). Без вопроса: отказаться незачем. */
export function deathSave(g: G, p: Player): boolean {
  const h = holder(g, p, 'Отменить одну смерть от физического здоровья (остаёшься на −9)')
  if (!h) return false
  spend(g, p, h)
  p.phys = -9
  say(g, p, '«Лечение за границей»: смерть отменена, физ. −9')
  return true
}

/** «Блок сигарет»: автоуспех только в тюрьме и кабале. */
export const cigarettesOk = (p: Player): boolean => p.inst?.kind === 'тюрьма' || p.inst?.kind === 'кабала'

