/** Журнал движка обычными словами. */
import type { GameState, LogEvent } from '../engine/types.ts'

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n).replace('-', '−'))
const NAMES: Record<string, string> = { 'физ': 'физ. здоровье', 'псих': 'псих. здоровье', 'возм': 'Возможности' }
const INST: Record<string, string> = { 'тюрьма': 'тюрьма', 'психбольница': 'психбольница', 'кабала': 'кабала' }

/** Строка журнала и её вид: заголовок, обычная, тихая (служебная), важная. */
export function describe(ev: LogEvent, s: GameState): { text: string; kind: 'head' | 'plain' | 'quiet' | 'loud' } {
  const who = 'p' in ev ? s.players[ev.p]?.name ?? '' : ''
  switch (ev.t) {
    case 'ход': return { text: `${who} — ход, круг ${ev.round}`, kind: 'head' }
    case 'бросок': return { text: `кубик d${ev.die}: ${ev.value} (${ev.why})`, kind: 'quiet' }
    case 'клетка': return { text: `${ev.seg}${ev.n ? `, клетка ${ev.n}` : ''}: ${ev.type}`, kind: 'plain' }
    case 'карта': return { text: `Карта «${ev.title}» (${ev.id})`, kind: 'loud' }
    case 'пропуск': return { text: `карта ${ev.id} не подошла — под низ колоды`, kind: 'quiet' }
    case 'проверка': {
      if (ev.auto) return { text: `🎲 ${ev.what ? `${ev.what}: ` : ''}${ev.stat} — автоуспех`, kind: 'plain' }
      // Броски без характеристики: поиск смысла (3d6 + поправка Мудрости) и вход в Древность (3d6 + физ.).
      if (ev.what === 'поиск смысла' || ev.what?.startsWith('вход в Древность')) {
        const base = ev.what === 'поиск смысла' ? '' : ` + физ. ${signed(ev.value)}`
        return { text: `🎲 ${ev.what === 'поиск смысла' ? 'поиск смысла' : 'вход в Древность'}: кубики [${ev.dice.join(', ')}] = ${ev.kept}${base}${ev.mod ? `, поправки ${signed(ev.mod)}` : ''}; нужно ${ev.dc} — ${ev.ok ? 'успех' : 'провал'}`, kind: 'loud' }
      }
      const parts = [`${ev.value}`, `кубики [${ev.dice.join(', ')}] = ${ev.kept}`]
      if (ev.mod) parts.push(`поправки ${signed(ev.mod)}`)
      if (ev.trump) parts.push(`козырь ${signed(ev.trump)}`)
      const adv = ev.adv > 0 ? ', с преимуществом' : ev.adv < 0 ? ', с помехой' : ''
      return { text: `🎲 ${ev.what ? `${ev.what}: ` : ''}${ev.stat} ${parts.join(' + ')} против ${ev.dc}${adv} — ${ev.ok ? 'успех' : 'провал'}`, kind: 'plain' }
    }
    case 'число': return { text: `${NAMES[ev.param] ?? ev.param} ${signed(ev.delta)} (стало ${signed(ev.to).replace('+', '')})`, kind: 'plain' }
    case 'предмет': return { text: ev.how === 'свадьба' ? `свадьба: «${ev.name}» теперь Супруг(а)` : `«${ev.name}» — ${ev.how}`, kind: 'plain' }
    case 'выбор': return { text: `выбор: ${ev.label}`, kind: 'plain' }
    case 'текст': return { text: ev.text, kind: 'plain' }
    case 'отрезок': return { text: `${who} входит в отрезок: ${ev.seg}`, kind: 'loud' }
    case 'класс': return { text: `класс: ${ev.from} → ${ev.to}`, kind: 'loud' }
    case 'характер': return { text: `характер: шаг к полюсу «${ev.pole}» (ось ${signed(ev.value)})`, kind: 'plain' }
    case 'институт': return { text: ev.how === 'вход' ? `${INST[ev.kind]}: вход${ev.turns ? `, срок ${ev.turns}` : ''}` : `${INST[ev.kind]}: выход`, kind: 'loud' }
    case 'смысл': return { text: `смысл жизни: ${ev.id} (${ev.from})`, kind: 'loud' }
    case 'счастье': return { text: `счастье ${ev.from} → ${ev.to}`, kind: 'loud' }
    case 'смерть': return { text: `${who}: смерть — ${ev.cause}`, kind: 'loud' }
    case 'финал': return { text: `${who}: «Финал». У калитки кто-то машет.`, kind: 'loud' }
    case 'мир': return { text: ev.text, kind: 'head' }
    case 'этап3': return { text: `правило этапа 3 ещё не написано: ${ev.rule}`, kind: 'quiet' }
  }
}
