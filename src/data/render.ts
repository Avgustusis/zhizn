/**
 * Пересказ разобранного эффекта обычными словами.
 * Нужен, чтобы человек сверил разбор с оригиналом карты, не читая JSON.
 */
import type { Check, Cond, Node } from './schema.ts'

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
  if ('neutral' in c) return `культура нейтральна на оси «${c.neutral}»`
  if ('char' in c) return `характер ${c.strong ? 'сильно ' : ''}за полюс «${c.char}»`
  if ('cls' in c) return `класс: ${c.cls.join(' или ')}`
  if ('sex' in c) return c.sex === 'ж' ? 'женщина' : 'мужчина'
  if ('minority' in c) return c.minority ? 'чужак (меньшинство)' : 'из большинства'
  if ('has' in c) return `есть «${c.has}»`
  if ('seg' in c) return `отрезок: ${c.seg.join(' или ')}`
  if ('flag' in c) return `в журнале: «${c.flag}»`
  if ('mainCulture' in c) return `основная культура страны: ${c.mainCulture.join(' или ')}`
  if ('diaspora' in c) return c.diaspora ? 'диаспора без своих' : 'своя культура есть в стране'
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
    ].filter(Boolean).join(', ')
    return `${renderCond(m.if)} — ${what}`
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
    } else if ('miracle' in n) {
      out.push(pad + `чудо: +2 ${n.miracle === 'любая' ? 'к любой характеристике' : n.miracle.join(' или ')}, гриф вскрыт`)
    } else if ('gain' in n) {
      out.push(pad + `получить «${n.gain}»${n.blind ? ' (вслепую)' : ''}`)
    } else if ('lose' in n) {
      out.push(pad + `потерять «${n.lose}»`)
    } else if ('charStep' in n) {
      out.push(pad + `характер на ${n.n ?? 1} шаг к «${n.charStep}»`)
    } else if ('cls' in n) {
      out.push(pad + `класс → ${n.cls}`)
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
      out.push(pad + `${what} к ${m.tag ?? 'проверкам'} до конца ${m.until === 'отрезок' ? 'отрезка' : 'следующей проверки'}`)
    } else if ('flag' in n) {
      out.push(pad + `в журнал: «${n.flag}»`)
    } else if ('rule' in n) {
      out.push(pad + `правило: ${n.rule}`)
    } else if ('bottom' in n) {
      out.push(pad + 'карта уходит под низ колоды')
    } else if ('say' in n) {
      out.push(pad + `«${n.say}»`)
    }
  }
  return out
}
