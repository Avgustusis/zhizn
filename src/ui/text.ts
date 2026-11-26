import { CHAR_AXES, CLASSES, CULTURE_AXES, CULTURES, IDEOLOGIES, RACES } from '../data/schema.ts'
/**
 * Как текст выглядит на экране (замечания Августа 25.11). Данные и журнал движка не меняются — правится только показ:
 * кубики — «D6», «3D6»; «Ядро» — с заглавной (оно в игре одно); ✊ и «СЛЕД «канал»» — цветной жетон канала;
 * подписи вариантов — с заглавной буквы.
 */

/** Цвета жетонов «СЛЕД» по каналам — как на листе жетонов (components/Tokens). */
export const TRACE_COLORS: Record<string, string> = {
  'Труд': '#A0643A', 'Долг': '#4F5D3A', 'Порядок': '#2E4A6B', 'Гласность': '#6A4C7A', 'Капитал': '#8A6A1F', 'Тень': '#2B2B30',
}
export const CHANNELS = Object.keys(TRACE_COLORS)

/** Простые замены: D у кубиков, «Ядро» с заглавной, ✊ — словом «СЛЕД» (где жетон не нарисовать). */
export function glyphText(s: string): string {
  return s
    .replace(/(^|[^A-Za-z])(\d*)d(\d+)/g, '$1$2D$3')
    .replace(/(^|[^А-Яа-яЁё])ядр(о|а|у|ом|е)(?![А-Яа-яЁё])/g, '$1Ядр$2')
    .replace(/✊/g, 'СЛЕД')
}

/** Первая буква — заглавная. */
export const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Канал следа карты: «→ Гласность» — он; «→ канал твоего класса» — канал класса игрока. */
export function traceChannel(trace: string | undefined, cls: string | undefined, byClass: Record<string, string>): string | undefined {
  if (!trace) return undefined
  const named = CHANNELS.find((c) => trace.includes(`→ ${c}`))
  if (named) return named
  return cls && /твоего класса/.test(trace) ? byClass[cls] : undefined
}

/**
 * Правило карты по вариантам: «А) … Б) …» — текст каждого варианта (буква, текст). Если букв столько, сколько
 * вариантов, и идут они по порядку, — варианты показываются словами карты; иначе — undefined (тогда разбор эффекта).
 */
export function splitOptions(src: string, count: number): string[] | undefined {
  const letters = 'АБВГДЕ'
  const marks: { i: number; len: number; letter: string }[] = []
  const re = /(^|[\s.;:])([АБВГДЕ])\)\s+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) marks.push({ i: m.index + m[1].length, len: m[0].length - m[1].length, letter: m[2] })
  if (marks.length !== count || marks.some((x, k) => x.letter !== letters[k])) return undefined
  return marks.map((x, k) => src.slice(x.i + x.len, k + 1 < marks.length ? marks[k + 1].i : src.length).trim().replace(/;$/, ''))
}

/**
 * Раскладка правила карты по строкам (замечание Августа 26.11): «Страна: X — эффект / Y — эффект», «Игроки: …»,
 * «🎲 Ловкость 12: успех — … / провал — …», «Теизм: … / Секуляризм: … / Нейтрально: …».
 * Группы — через « · »; в группе новая строка после «.», если дальше заглавная, и после «;», если дальше новое условие
 * (D6, успех, провал, иначе, «Что-то:»). Подпись группы (Страна, Игроки, проверка) висит слева, строки — под ней.
 */
const GROUP_LABEL = /^((?:Страна|Игроки|Для всех|Победители|Проигравшие|Нейтралы|Класс|Культура|Раса|Все)\s*:|🎲[^:;]{1,40}?\d+(?:\s*\([^)]*\))?\s*:|[АБВГДЕ]\)\s[^:;—]{1,40}?:)\s*/
/** Имена, с которых начинается своё условие: полюса культуры и характера, идеологии, классы, культуры, расы, позиции. */
const NAMES = [...CULTURE_AXES.flat(), ...CHAR_AXES.flat(), ...IDEOLOGIES, ...CLASSES, ...CULTURES, ...RACES, 'Ядро', 'Полупериферия', 'Периферия', 'Большинство', 'Чужак', 'Мужчины', 'Женщины', 'Диктатуры', 'Демократии']
// Основы слов без окончаний и без регистра: «демократии», «клептократия», «диктатуры» ловятся так же, как «Технократия».
const STEMS = [...new Set(NAMES.flatMap((n) => n.toLowerCase().split(/[\s-]+/)).filter((w) => w.length >= 4).map((w) => (w.length >= 6 ? w.slice(0, -2) : w)))]
const NAMED_HEAD = new RegExp(`^(${STEMS.join('|')})[а-яё]*(?:\\s(?:и|или)\\s[^:—;]{1,30}?)?(:|\\s—\\s)`, 'i')
const HEAD_AFTER_SEMI = /^(\d*[dD]\d|успех|провал|[Ии]наче|в культуре\s|при\s[А-ЯЁ]|[А-ЯЁA-Z][^:—.;()]{0,40}:\s)/
/** Под проверкой висят только её исходы; прочее — новая строка во всю ширину. */
const CHECK_TAIL = /^(успех|провал|[Ии]наче|\d*[dD]\d)/
export function layoutSrc(src: string): { label?: string; lines: string[] }[] {
  const lines: string[] = []
  for (const group of src.split(/\s+·\s+/)) {
    let first = true
    for (const piece of group.split(/(?<=[.;])\s+/)) {
      const prev = lines[lines.length - 1]
      const brk = first || (prev.endsWith(';') ? HEAD_AFTER_SEMI.test(piece) || NAMED_HEAD.test(piece) : /^([А-ЯЁA-Z]|🎲|\d*D\d)/.test(piece))
      if (brk) lines.push(piece)
      else lines[lines.length - 1] = `${prev} ${piece}`
      first = false
    }
  }
  const out: { label?: string; lines: string[] }[] = []
  let open: { label?: string; lines: string[] } | undefined
  for (const line of lines) {
    const m = line.match(GROUP_LABEL)
    if (m && line.length > m[0].length) { open = { label: m[1], lines: [line.slice(m[0].length)] }; out.push(open); continue }
    if (open?.label && !(open.label.startsWith('🎲') && !CHECK_TAIL.test(line))) { open.lines.push(line); continue }
    open = undefined
    const last = out[out.length - 1]
    if (last && !last.label) last.lines.push(line)
    else out.push({ lines: [line] })
  }
  return out
}

/**
 * Варианты без «А) Б)» словами карты (замечание Августа 26.11): «одно на выбор: спорт (+1 Сила, …), шахматы (+1 Интеллект)».
 * Если у каждого варианта в тексте карты есть скобка с эффектом — вариант «Спорт (+1 Сила, …)», а правило карты
 * обрезается до первого варианта («−1 возм. и одно на выбор:»). Иначе — undefined.
 */
export function wordsFromSrc(src: string, labels: string[]): { words: string[]; head: string } | undefined {
  const low = src.toLowerCase()
  let at = 0
  const found: { i: number; text: string }[] = []
  for (const l of labels) {
    const i = low.indexOf(l.toLowerCase(), at)
    if (i < 0) return undefined
    const m = src.slice(i + l.length).match(/^\s*(\([^)]*\))/)
    if (!m) return undefined
    found.push({ i, text: `${capital(src.slice(i, i + l.length))} ${m[1]}` })
    at = i + l.length + m[0].length
  }
  return { words: found.map((f) => f.text), head: src.slice(0, found[0].i).trim() }
}

/** Пояснение варианта без повтора его названия: «+1 Мудрость» + «+1 Мудрость (до 7)» → «(до 7)»; совпадает — пусто. */
export function noteBeyondLabel(label: string, text: string): string {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '').trim()
  const a = norm(label), b = norm(text)
  if (a === b) return ''
  if (b.startsWith(a)) return text.trim().slice(label.trim().length).trim()
  return text
}
