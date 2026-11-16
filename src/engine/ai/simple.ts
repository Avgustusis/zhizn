/**
 * Простой ИИ: отвечает на вопросы движка разумно, но без расчёта на свой смысл жизни.
 * Нужен для проверки правил («можно ли прожить жизнь») и кнопки «Ход за ИИ» в пробной партии.
 * Настоящие ИИ-соперники с логикой симуляции — этап 4.
 */
import type { Node } from '../../data/schema.ts'
import type { G } from '../core.ts'
import type { Player, Request } from '../types.ts'

/** Грубая ценность шагов для этого игрока: здоровье дороже, когда его мало; деньги — когда их нет. */
export function value(p: Player, nodes: Node[] | undefined, depth = 0): number {
  if (!nodes || depth > 6) return 0
  let v = 0
  for (const n of nodes) {
    if ('add' in n) {
      for (const [k, x] of Object.entries(n.add)) {
        if (k === 'физ') v += x * (p.phys < -2 ? 1.6 : 1)
        else if (k === 'псих') v += x * (p.psy < -2 ? 1.6 : 1)
        else if (k === 'возм') v += x * (p.vozm < 0 ? 1.3 : 0.6)
        else if (k === 'Сплочённость') v += x * 2
        else if (k === 'Положение' || k === 'Финансы') v += x * 1.5
        else if (k === 'Стаж' || k === 'Пожертвования') v += x * 0.5
        else v += x * 2.5
      }
    } else if ('gain' in n) v += ['Судимость', 'Дурная слава', 'Враг', 'Долг', 'Учёт', 'Без документов', 'Привычка'].includes(n.gain) ? -3 : 2
    else if ('lose' in n) v -= 2
    else if ('prison' in n) v -= 6
    else if ('check' in n) v += 0.6 * value(p, n.success, depth + 1) + 0.4 * value(p, n.failure, depth + 1)
    else if ('d6' in n) for (const [r, t] of Object.entries(n.d6)) { const [a, b = a] = r.split('-').map(Number); v += ((b - a + 1) / 6) * value(p, t, depth + 1) }
    else if ('die' in n) for (const [r, t] of Object.entries(n.out)) { const [a, b = a] = r.split('-').map(Number); v += ((b - a + 1) / n.die) * value(p, t, depth + 1) }
    else if ('if' in n) v += 0.5 * value(p, n.then, depth + 1) + 0.5 * value(p, n.else, depth + 1)
    else if ('cases' in n) v += Math.max(...n.cases.map((c) => value(p, c.then, depth + 1)), value(p, n.else, depth + 1))
    else if ('choose' in n) v += Math.max(...n.choose.map((o) => value(p, o.then, depth + 1)))
    else if ('cls' in n) v += 1
  }
  return v
}

/**
 * Какое действие рынка выбрать — порядок как у ИИ симуляции автора (sim3.py: market, work, small):
 * тяжело — большой обмен; работа, пока денег меньше 10; малый обмен: больница при физ. 0 и ниже, психолог при псих. 0 и ниже,
 * обряд, семья, рост характеристик своего класса, отдых; в остатке — подлечиться, если есть запас денег.
 */
function marketPick(g: G, p: Player, ids: string[], price: (id: string) => number): string {
  const hasId = (id: string) => ids.includes(id)
  const first = (...list: string[]) => list.find(hasId)
  const work = first('дело', 'работа', 'подработка')
  const old = p.seg >= 4
  if (p.phys <= -6) { const h = first('больница-большой'); if (h) return h }
  if (p.psy <= -6) { const h = first('психолог-большой', 'психолог-привычка'); if (h) return h }
  if (hasId('психолог-привычка') && p.psy <= -1 && p.vozm >= price('психолог-привычка') + 2) return 'психолог-привычка'
  // ■: работа, пока денег меньше 10 (переработка — когда здоровья в запасе, а денег нет).
  if (work && p.vozm < 10 && p.seg < 5) return p.vozm < 2 && p.phys >= 3 && p.psy >= 3 && !old && hasId('переработка') ? 'переработка' : work
  // ▲: малый обмен.
  if (p.phys <= (old ? 3 : 0)) { const h = first('больница-старость', 'больница-льгота', 'больница-старцы', 'больница'); if (h) return h }
  if (p.psy <= 0) { const h = first('исповедь', 'психолог-льгота', 'обряд', 'двор', 'психолог', 'семья', 'храм'); if (h) return h }
  if (p.phys <= -5 && old) { const h = first('больница-большой'); if (h) return h }
  const youth = ids.filter((id) => id.startsWith('молодость-'))
  if (youth.length && p.phys >= 0 && p.psy >= 0 && p.vozm >= 3) return youth[(p.turns * 13 + p.seat) % youth.length]
  if (hasId('обряд') && (p.psy < 3 || p.phys < 2)) return 'обряд'
  if (hasId('семья') && (p.vozm < 0 || p.psy < 0)) return 'семья'
  const fit = g.c.tables.work.fit[p.cls]
  if (p.vozm >= 5 && p.psy > -5) {
    if (fit.some((s) => ['Сила', 'Выносливость', 'Ловкость'].includes(s) && p.stats[s] < 7) && hasId('спортзал')) return 'спортзал'
    if (fit.some((s) => ['Интеллект', 'Мудрость', 'Харизма', 'Смекалка'].includes(s) && p.stats[s] < 7) && hasId('курсы')) return 'курсы'
  }
  if (hasId('путешествие') && p.vozm >= 7 && p.psy < 4) return 'путешествие'
  if (hasId('хобби') && p.psy < 5) return 'хобби'
  if (p.phys < (old ? 6 : 3)) { const h = first('больница-старость', 'больница-льгота', 'больница'); if (h && p.vozm >= price(h) + 2) return h }
  if (p.psy < 3) { const h = first('психолог-льгота', 'психолог'); if (h && p.vozm >= price(h) + 2) return h }
  return first('знакомство', 'двор') ?? 'конец'
}

/** Ответ ИИ на вопрос движка. */
export function answer(g: G, req: Request): string {
  const p = g.s.players[req.player]
  const open = req.options.filter((o) => !o.off)
  const ids = open.map((o) => o.id)
  const best = (score: (o: Request['options'][number]) => number) => open.reduce((a, b) => (score(b) > score(a) ? b : a)).id
  switch (req.type) {
    case 'ход': return ids[0]
    case 'действие':
      if (ids.includes('конец')) return marketPick(g, p, ids, (id) => g.c.actions.find((a) => a.id === id)?.price?.find(() => true)?.n ?? 0)
      if (ids.includes('да') && ids.includes('нет')) return p.vozm >= 4 ? 'да' : 'нет' // сиделка, как в симуляции: при 4+ возм.
      return ids[0]
    case 'карта': return best((o) => value(p, o.effect))
    case 'козырь': case 'отмена': return ids.includes('да') ? 'да' : ids.find((x) => x !== 'нет') ?? ids[0]
    case 'сброс': return 'нет'
    case 'класс': {
      const to = req.options.find((o) => o.id === 'да')?.label ?? ''
      const ladder = g.c.tables.work.ladder
      const target = (Object.keys(ladder) as (keyof typeof ladder)[]).find((c) => to.includes(c))
      return target && ladder[target] > ladder[p.cls] ? 'да' : 'нет'
    }
    case 'смысл': return ids.includes('принять') ? 'принять' : ids.includes('оставить') ? 'оставить' : ids[0]
    case 'предмет': return ids[0]
    default: return ids[0]
  }
}
