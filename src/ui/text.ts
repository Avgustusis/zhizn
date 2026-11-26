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
const CATEGORY = /^((?:Страна|Игроки|Для всех|Победители|Проигравшие|Нейтралы|Класс|Культура|Раса|Все)\s*:)\s*/
const CHECK_LABEL = /^(🎲[^:;]{1,40}?\d+(?:\s*\([^)]*\))?\s*:)\s*/
/** Вариант: «А) дать:» или «А) свадьба —». */
const OPTION_LABEL = /^([АБВГДЕ]\)\s[^:;—(]{1,40}?(?::|\s—))\s*/
/** Условие, внутри которого свои варианты: «Есть Партнёр: А) …». */
const PARENT_LABEL = /^([А-ЯЁ][^:;—()]{1,30}:)\s*(?=[АБВГДЕ]\)\s)/
/** Имена, с которых начинается своё условие: полюса культуры и характера, идеологии, классы, культуры, расы, позиции. */
const NAMES = [...CULTURE_AXES.flat(), ...CHAR_AXES.flat(), ...IDEOLOGIES, ...CLASSES, ...CULTURES, ...RACES, 'Ядро', 'Полупериферия', 'Периферия', 'Большинство', 'Чужак', 'Мужчины', 'Женщины', 'Диктатуры', 'Демократии']
// Основы слов без окончаний и без регистра: «демократии», «клептократия», «диктатуры» ловятся так же, как «Технократия».
const STEMS = [...new Set(NAMES.flatMap((n) => n.toLowerCase().split(/[\s-]+/)).filter((w) => w.length >= 4).map((w) => (w.length >= 6 ? w.slice(0, -2) : w)))]
const NAMED_HEAD = new RegExp(`^(${STEMS.join('|')})[а-яё]*(?:\\s(?:и|или)\\s[^:—;]{1,30}?)?(:|\\s—\\s)`, 'i')
const HEAD_AFTER_SEMI = /^(\d*[dD]\d|успех|провал|[Ии]наче|если\s|в культуре\s|при\s[А-ЯЁ]|[АБВГДЕ]\)\s|[А-ЯЁA-Z][^:—.;()]{0,40}:\s)/
/** Под проверкой висят только её исходы. */
const CHECK_TAIL = /^(успех|провал|[Ии]наче|\d*[dD]\d)/i
/** Новое условие со своей подписью («Уже в браке: …») — не продолжение варианта. */
const NEW_COND = /^(?!(успех|провал|иначе)(?![а-яё]))[А-ЯЁ][^:—;()]{0,40}:\s/i
const depth = (x: string) => (x.match(/\(/g)?.length ?? 0) - (x.match(/\)/g)?.length ?? 0)

export type SrcGroup = { label?: string; lines: string[] }
export function layoutSrc(src: string): SrcGroup[] {
  const lines: string[] = []
  for (const group of src.split(/\s+·\s+/)) {
    let first = true
    for (const piece of group.split(/(?<=[.;])\s+/)) {
      const prev = lines[lines.length - 1]
      // Внутри скобок строку не рвём: «Сплочённость 9 (Традиция +1/+2; Фамилизм …)».
      const brk = first || (depth(prev) <= 0 && (prev.endsWith(';') ? HEAD_AFTER_SEMI.test(piece) || NAMED_HEAD.test(piece) : /^([А-ЯЁA-Z]|🎲|\d*D\d)/.test(piece)))
      if (brk) lines.push(piece)
      else lines[lines.length - 1] = `${prev} ${piece}`
      first = false
    }
  }
  const out: SrcGroup[] = []
  let open: (SrcGroup & { kind: 'cat' | 'check' | 'opt' | 'parent' }) | undefined
  const start = (kind: 'cat' | 'check' | 'opt' | 'parent', label: string, rest: string) => { open = { kind, label, lines: [rest] }; out.push(open) }
  for (const line of lines) {
    const cat = line.match(CATEGORY), chk = line.match(CHECK_LABEL), opt = line.match(OPTION_LABEL), par = line.match(PARENT_LABEL)
    const keep = open && (
      open.kind === 'cat' ? !cat :
      open.kind === 'check' ? CHECK_TAIL.test(line) :
      open.kind === 'parent' ? !cat && !par && !chk && (!!opt || CHECK_TAIL.test(line) || !NEW_COND.test(line)) :
      !cat && !opt && !par && !NEW_COND.test(line))
    if (keep) { open!.lines.push(line); continue }
    if (cat && line.length > cat[0].length) { start('cat', cat[1], line.slice(cat[0].length)); continue }
    if (par) { start('parent', par[1], line.slice(par[0].length)); continue }
    if (opt && line.length > opt[0].length) { start('opt', opt[1], line.slice(opt[0].length)); continue }
    if (chk && line.length > chk[0].length) { start('check', chk[1], line.slice(chk[0].length)); continue }
    open = undefined
    const last = out[out.length - 1]
    if (last && !last.label) last.lines.push(line)
    else out.push({ lines: [line] })
  }
  return out.map(({ label, lines: l }) => (label ? { label, lines: l } : { lines: l }))
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

/**
 * Разбор эффекта (renderNodes: строки с отступами) — в одну фразу для раскладки layoutSrc (замечание Августа 26.11:
 * моноширинные столбики «если …: / +1 возм.» читать трудно). «если X:» + дети → «если X — …»; «🎲 Ловкость 12» → «🎲 Ловкость 12: успех — …; провал — …».
 */
export function compactLines(lines: string[]): string {
  type T = { text: string; kids: T[] }
  const root: T = { text: '', kids: [] }
  const stack: { d: number; n: T }[] = [{ d: -1, n: root }]
  for (const raw of lines) {
    const d = (raw.match(/^ */)?.[0].length ?? 0) / 2
    const n: T = { text: raw.trim().replace(/если культура за полюс «([^»]+)»/g, '$1').replace(/^если идеология: /, ''), kids: [] }
    while (stack[stack.length - 1].d >= d) stack.pop()
    stack[stack.length - 1].n.kids.push(n)
    stack.push({ d, n })
  }
  const say = (n: T): string => {
    if (!n.kids.length) return n.text
    const inner = n.kids.map(say).join(n.kids.some((k) => k.kids.length) ? '; ' : ', ')
    return n.text.endsWith(':') ? `${n.text.slice(0, -1)} — ${inner}` : `${n.text}: ${inner}`
  }
  return capital(root.kids.map(say).join('; '))
}
