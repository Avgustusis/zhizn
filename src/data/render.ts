/**
 * Пересказ разобранного эффекта обычными словами.
 * Нужен, чтобы человек сверил разбор с оригиналом карты, не читая JSON.
 */
import { CULTURE_AXES, type Check, type Cond, type Node } from './schema.ts'

const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

const PARAM_LABEL: Record<string, string> = { 'физ': 'физ.', 'псих': 'псих.', 'возм': 'возм.' }

export function renderCond(c: Cond): string {
  if ('all' in c) return c.all.map(renderCond).join(' и ')
  if ('any' in c) return c.any.map(renderCond).join(' или ')
  if ('not' in c) return `не (${renderCond(c.not)})`
  if ('p' in c) {
    const name = PARAM_LABEL[c.p] ?? c.p
    if (c.gte !== undefined && c.lte !== undefined) return `${name} от ${sign(c.gte)} до ${sign(c.lte)}`
    const num = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
    return c.gte !== undefined ? `${name} ${num(c.gte)} и выше` : `${name} ${num(c.lte!)} и ниже`
  }
  if ('pos' in c) return `страна: ${c.pos.join(' или ')}`
  if ('ideo' in c) return `идеология: ${c.ideo.join(' или ')}`
  if ('culture' in c) return `культура ${c.strong ? 'сильно ' : ''}за полюс «${c.culture}»`
  if ('neutral' in c) {
    const axis = CULTURE_AXES.find((ax) => (ax as readonly string[]).includes(c.neutral))!
    return `культура: нейтрально (0) на оси ${axis[0]} ↔ ${axis[1]}`
  }
  if ('char' in c) return `характер ${c.strong ? 'сильно ' : ''}за полюс «${c.char}»`
  if ('cls' in c) return `класс: ${c.cls.join(' или ')}`
  if ('familyCls' in c) return `класс семьи: ${c.familyCls.join(' или ')}`
  if ('war' in c) return c.war ? 'страна воюет' : 'страна не воюет'
  if ('sexFavored' in c) return c.sexFavored ? 'пол в преимуществе' : 'пол в помехе'
  if ('partnerMinority' in c) return 'Партнёр или Супруг(а) не из большинства'
  if ('sex' in c) return c.sex === 'ж' ? 'женщина' : 'мужчина'
  if ('minority' in c) return c.minority ? 'чужак (меньшинство)' : 'из большинства'
  if ('has' in c) return `есть «${c.has}»`
  if ('seg' in c) return `отрезок: ${c.seg.join(' или ')}`
  if ('flag' in c) return `в журнале: «${c.flag}»`
  if ('mainCulture' in c) return `основная культура страны: ${c.mainCulture.join(' или ')}`
  if ('diaspora' in c) return c.diaspora ? 'диаспора без своих' : 'своя культура есть в стране'
  if ('meaning' in c) return c.meaning === 'найден' ? 'смысл жизни найден' : 'у игрока Серость'
  if ('visited' in c) return `в этом отрезке был: ${c.visited}`
  if ('partnerDiff' in c) return `Партнёр или Супруг(а) другого ${c.partnerDiff === 'культура' ? 'культуры' : 'класса'}`
  if ('count' in c) return `«${c.count}» не меньше ${c.gte}`
  if ('notAlone' in c) return c.notAlone ? 'живёт не один' : 'живёт один'
  if ('emigrant' in c) return c.emigrant ? 'эмигрант' : 'живёт в стране рождения'
  if ('draft' in c) return c.draft ? 'в стране призыв, и он касается игрока' : 'призыва нет'
  if ('hasKind' in c) return `есть хотя бы один предмет вида «${c.hasKind}»`
  if ('powerChanged' in c) return `${c.powerChanged ? 'была' : 'не было'} смена власти ${c.inSeg ? 'в этом отрезке' : 'в стране'}`
  if ('stability' in c) return `стабильность ${c.stability.gte !== undefined ? `${c.stability.gte}+` : `${c.stability.lte} и ниже`}`
  if ('clsRole' in c) return `класс игрока ${c.clsRole}`
  if ('dominant' in c) return `доминирующий класс страны: ${c.dominant.join(' или ')}`
  if ('alienated' in c) return `отчуждённый класс страны: ${c.alienated.join(' или ')}`
  if ('multicultural' in c) return c.multicultural ? 'страна мультикультурная' : 'страна гомогенная'
  if ('relation' in c) return `у страны есть ${c.relation === 'вражда' ? 'враг' : 'союзник'}`
  if ('fromHostile' in c) return 'эмигрант из враждебной страны'
  if ('inFashion' in c) return c.inFashion ? 'раса в моде' : 'раса не в моде'
  if ('cultureIs' in c) return `культура: ${c.cultureIs.join(' или ')}`
  if ('ownBusiness' in c) return c.ownBusiness ? 'своё дело' : 'нет своего дела'
  if ('working' in c) return c.working ? 'работает или учится' : 'не работает и не учится'
  if ('mode' in c) return `режим «${c.mode === 'род' ? 'Род' : 'Поколение'}»`
  return JSON.stringify(c)
}

export function renderCheck(ch: Check): string {
  const stats = Array.isArray(ch.stat) ? ch.stat.join(' или ') : ch.stat
  let s = `🎲 ${stats} ${ch.dc}`
  for (const o of ch.or ?? []) s += ` или ${o.stat} ${o.dc}`
  if (ch.what) s += ` (${ch.what})`
  const mods = (ch.mods ?? []).map((m) => {
    const what = [
      m.dc !== undefined && `сложность ${m.dc}`,
      m.add !== undefined && sign(m.add),
      m.adv && 'преимущество',
      m.dis && 'помеха',
      m.auto && 'автоуспех',
      m.spend && 'если потратить',
      m.fixed && 'при любой силе',
    ].filter(Boolean).join(', ')
    return m.if ? `${renderCond(m.if)} — ${what}` : what
  })
  if (mods.length) s += ` [${mods.join('; ')}]`
  return s
}

/** Список узлов → строки с отступами (одна строка на шаг). */
export function renderNodes(nodes: Node[], depth = 0): string[] {
  const pad = '  '.repeat(depth)
  const out: string[] = []
  if (nodes.length === 0) out.push(pad + 'ничего')
  for (const n of nodes) {
    if ('add' in n) {
      out.push(pad + Object.entries(n.add).map(([k, v]) => `${sign(v!)} ${PARAM_LABEL[k] ?? k}`).join(', '))
    } else if ('addOneOf' in n) {
      out.push(pad + `${sign(n.n)} к одной на выбор: ${n.addOneOf.join(', ')}`)
    } else if ('addUsed' in n) {
      out.push(pad + `${sign(n.addUsed)} к характеристике, которой бросал`)
    } else if ('addPredisp' in n) {
      out.push(pad + `${sign(n.addPredisp)} к характеристике предрасположенности`)
    } else if ('addClassStat' in n) {
      out.push(pad + `${sign(n.addClassStat)} ${n.both ? 'к обеим характеристикам' : 'к одной характеристике'} пригодности своего класса`)
    } else if ('perSeg' in n) {
      out.push(pad + 'в начале каждого отрезка до конца Зрелости:', ...renderNodes(n.perSeg, depth + 1))
    } else if ('halve' in n) {
      out.push(pad + 'потерять половину возм. (округление вниз)')
    } else if ('later' in n) {
      out.push(pad + `потом — ${n.later.when}${n.later.until ? ' (если до конца отрезка)' : ''}:`, ...renderNodes(n.later.then, depth + 1))
    } else if ('miracle' in n) {
      out.push(pad + `чудо: +2 ${n.miracle === 'любая' ? 'к любой характеристике' : n.miracle.join(' или ')}, гриф вскрыт`)
    } else if ('gain' in n) {
      out.push(pad + `получить «${n.gain}»${n.adopted ? ' (воспитанник)' : ''}${n.blind ? ' (вслепую)' : ''}`)
    } else if ('lose' in n) {
      out.push(pad + `потерять «${n.lose}»${n.price ? ' (с обычной ценой сброса)' : ''}`)
    } else if ('income' in n) {
      out.push(pad + `доход ${sign(n.income)} за ход до ${n.until === 'жизнь' ? 'конца жизни' : n.until === 'конец Молодости' ? 'конца Молодости' : 'конца отрезка'}`)
    } else if ('pension' in n) {
      out.push(pad + `надбавка к пенсии ${sign(n.pension)} за ход до конца жизни (по правилам пенсии)`)
    } else if ('noAging' in n) {
      out.push(pad + `${n.noAging} хода без потери физ. от Древности`)
    } else if ('reshuffle' in n) {
      out.push(pad + 'карта замешивается обратно в колоду')
    } else if ('charStep' in n) {
      out.push(pad + `характер на ${n.n ?? 1} шаг к «${n.charStep}»`)
    } else if ('cls' in n) {
      out.push(pad + `класс → ${n.cls}`)
    } else if ('allowCls' in n) {
      out.push(pad + `можно сразу перейти в класс ${n.allowCls} (решение сейчас, позже нельзя)`)
    } else if ('prison' in n) {
      out.push(pad + `тюрьма (${n.prison === 'лёгкое' ? 'лёгкое, d3 хода' : 'тяжёлое, d6 + 2 хода'})`)
    } else if ('check' in n) {
      out.push(pad + renderCheck(n.check))
      out.push(pad + '  успех:', ...renderNodes(n.success, depth + 2))
      out.push(pad + '  провал:', ...renderNodes(n.failure, depth + 2))
    } else if ('choose' in n) {
      out.push(pad + 'выбор:')
      n.choose.forEach((o, i) => {
        out.push(pad + `  ${'АБВГД'[i]}) ${o.label}${o.if ? ` [только если ${renderCond(o.if)}]` : ''}:`)
        out.push(...renderNodes(o.then, depth + 2))
      })
    } else if ('d6' in n) {
      out.push(pad + 'бросок d6:')
      for (const [r, then] of Object.entries(n.d6)) {
        out.push(pad + `  ${r.replace('-', '–')}:`, ...renderNodes(then, depth + 2))
      }
    } else if ('if' in n) {
      out.push(pad + `если ${renderCond(n.if)}:`, ...renderNodes(n.then, depth + 1))
      if (n.else) out.push(pad + 'иначе:', ...renderNodes(n.else, depth + 1))
    } else if ('cases' in n) {
      for (const c of n.cases) out.push(pad + `если ${renderCond(c.if)}:`, ...renderNodes(c.then, depth + 1))
      if (n.else) out.push(pad + 'иначе:', ...renderNodes(n.else, depth + 1))
    } else if ('mod' in n) {
      const m = n.mod
      const what = [m.add !== undefined && sign(m.add), m.adv && 'преимущество', m.dis && 'помеха'].filter(Boolean).join(', ')
      out.push(pad + `${what} к ${m.fork ? `развилке «${m.fork}»` : m.tag ?? 'проверкам'} до ${m.until === 'отрезок' ? 'конца отрезка' : m.until === 'вражда' ? 'конца вражды стран' : m.until === 'конец Молодости' ? 'конца Молодости' : 'следующей такой проверки'}${m.max ? ', но не дольше конца отрезка' : ''}`)
    } else if ('useTrump' in n) {
      out.push(pad + `потратить козырь ${n.useTrump.map((x) => `«${x}»`).join(' или ')}:`, ...renderNodes(n.then, depth + 1))
      out.push(pad + 'не тратить или нет козыря:', ...renderNodes(n.else, depth + 1))
    } else if ('cancelable' in n) {
      out.push(pad + `можно отменить, потратив козырь ${n.cancelable.map((x) => `«${x}»`).join(', ')}:`, ...renderNodes(n.then, depth + 1))
    } else if ('flag' in n) {
      out.push(pad + `в журнал: «${n.flag}»`)
    } else if ('rule' in n) {
      out.push(pad + `правило: ${n.rule}${n.arg ? ` (${n.arg})` : ''}`)
    } else if ('bottom' in n) {
      out.push(pad + 'карта уходит под низ колоды')
    } else if ('say' in n) {
      out.push(pad + `«${n.say}»`)
    }
  }
  return out
}
