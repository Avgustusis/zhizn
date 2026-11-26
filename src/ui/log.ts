/** Журнал движка обычными словами. */
import type { GameState, LogEvent } from '../engine/types.ts'

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n).replace('-', '−'))
const NAMES: Record<string, string> = { 'физ': 'физ. здоровье', 'псих': 'псих. здоровье', 'возм': 'Возможности' }
const INST: Record<string, string> = { 'тюрьма': 'тюрьма', 'психбольница': 'психбольница', 'кабала': 'кабала', 'фронт': '«Фронт»' }

/** Строка журнала и её вид: заголовок, обычная, тихая (служебная), важная. */
export function describe(ev: LogEvent, s: GameState): { text: string; kind: 'head' | 'plain' | 'quiet' | 'loud' } {
  const who = 'p' in ev && ev.p !== undefined ? s.players[ev.p]?.name ?? '' : ''
  switch (ev.t) {
    case 'ход': return { text: `${who} — ход, круг ${ev.round}`, kind: 'head' }
    case 'бросок': return { text: `кубик d${ev.die}: ${ev.value} (${ev.why})`, kind: 'quiet' }
    case 'клетка': return { text: `${ev.seg}${ev.n ? `, клетка ${ev.n}` : ''}: ${ev.type}`, kind: 'plain' }
    case 'карта': return { text: `Карта «${ev.title}» (${ev.id})`, kind: 'loud' }
    case 'пропуск': return { text: `карта ${ev.id} не подошла — под низ колоды`, kind: 'quiet' }
    case 'проверка': {
      if (ev.auto) return { text: `🎲 ${ev.what ? `${ev.what}: ` : ''}${ev.stat} — автоуспех`, kind: 'plain' }
      // Порядок чтения (замечание Августа 26.11): что бросаем и сколько нужно → кубики → прибавки → итог.
      // Броски без характеристики: поиск смысла (3d6 + поправка Мудрости), вход в Древность (3d6 + физ.), сватовство (+ Сплочённость).
      const ancient = ev.what?.startsWith('вход в Древность')
      const label = ev.what === 'поиск смысла' ? 'поиск смысла' : ancient ? 'вход в Древность' : ev.what?.startsWith('сватовство') ? 'сватовство' : `${ev.what ? `${ev.what}: ` : ''}${ev.stat}`
      const statName = ev.what === 'поиск смысла' ? '' : ancient ? 'физ.' : ev.what?.startsWith('сватовство') ? 'Сплочённость' : ev.stat
      const adv = ev.adv > 0 ? ' (с преимуществом)' : ev.adv < 0 ? ' (с помехой)' : ''
      const parts = [`кубики [${ev.dice.join(', ')}]${adv} = ${ev.kept}`]
      if (statName && ev.value) parts.push(`${statName} ${signed(ev.value)}`)
      if (ev.mod) parts.push(`поправки ${signed(ev.mod)}`)
      if (ev.trump) parts.push(`козырь ${signed(ev.trump)}`)
      const total = ev.kept + ev.value + ev.mod + ev.trump
      return { text: `🎲 ${label}, нужно ${ev.dc}: ${parts.join(', ')} → ${total} — ${ev.ok ? 'успех' : 'провал'}`, kind: ev.what === 'поиск смысла' || ancient ? 'loud' : 'plain' }
    }
    case 'число': return { text: `${NAMES[ev.param] ?? ev.param} ${signed(ev.delta)} (стало ${signed(ev.to).replace('+', '')})${ev.parts ? `: по карте ${signed(ev.base ?? 0)}, ${ev.parts.map(([w, n]) => `${w} ${signed(n)}`).join(', ')}` : ''}`, kind: 'plain' }
    case 'предмет': return { text: ev.how === 'свадьба' ? `свадьба: «${ev.name}» теперь Супруг(а)` : `«${ev.name}» — ${ev.how}`, kind: 'plain' }
    case 'выбор': return { text: `выбор: ${ev.label}`, kind: 'plain' }
    case 'текст': return { text: ev.text, kind: 'plain' }
    case 'отрезок': return { text: `${who} входит в отрезок: ${ev.seg}`, kind: 'loud' }
    case 'класс': return { text: `класс: ${ev.from} → ${ev.to}`, kind: 'loud' }
    case 'характер': return { text: `характер: шаг к полюсу «${ev.pole}» (ось ${signed(ev.value)})`, kind: 'plain' }
    case 'институт': return { text: ev.how === 'вход' ? `${INST[ev.kind]}: вход${ev.turns ? `, срок ${ev.turns}` : ''}` : `${INST[ev.kind]}: выход`, kind: 'loud' }
    case 'смысл': return { text: `смысл жизни: ${ev.id} (${ev.from})`, kind: 'loud' }
    case 'счастье': return { text: `счастье ${ev.from} → ${ev.to}`, kind: 'loud' }
    case 'фронт': return { text: `⚔ ${ev.text}${ev.mark !== undefined ? ` [метка ${signed(ev.mark)}]` : ''}`, kind: 'plain' }
    case 'смерть': return { text: `${who}: смерть — ${ev.cause}`, kind: 'loud' }
    case 'финал': return { text: `${who}: «Финал». У калитки кто-то машет.`, kind: 'loud' }
    case 'мир': return { text: ev.text, kind: 'head' }
    case 'этап3': return { text: `правило этапа 3 ещё не написано: ${ev.rule}`, kind: 'quiet' }
  }
}
