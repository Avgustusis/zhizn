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
