/**
 * Формат карт «Жизни».
 *
 * Карта хранит оригинальный текст (поле `src`) и его разбор в явные эффекты (`effect`).
 * Ключи структуры — английские (op, if, then), значения игровых сущностей — русские,
 * как в документах: «Харизма», «Сплочённость», «Друг детства», «#семья».
 * Описание формата для людей — docs/CARDS.md.
 */
import { z } from 'zod'

// ── Словари ─────────────────────────────────────────────────────────────

export const STATS = ['Сила', 'Выносливость', 'Ловкость', 'Интеллект', 'Мудрость', 'Харизма', 'Смекалка', 'Красота'] as const
export const HEALTH = ['физ', 'псих'] as const
/** Всё, что меняется числом. Финансы, Положение и Сплочённость — шкалы семьи (−3…+3). */
export const PARAMS = [...STATS, ...HEALTH, 'возм', 'Стаж', 'Стаж найма', 'Пожертвования', 'Сплочённость', 'Финансы', 'Положение'] as const

export const SEGMENTS = ['Детство', 'Юность', 'Молодость', 'Зрелость', 'Старость', 'Древность'] as const
export const CLASSES = ['Народ', 'Армия', 'Полиция', 'Интеллигенция', 'Мафия', 'Олигархи'] as const
export const IDEOLOGIES = [
  'Либеральная демократия', 'Социал-демократия', 'Теократия', 'Национализм', 'Госсоциализм', 'Военная диктатура', 'Клептократия',
] as const
/** Группы идеологий, которыми говорят карты. */
export const IDEOLOGY_GROUPS = {
  'демократии': ['Либеральная демократия', 'Социал-демократия'],
  'диктатуры': ['Военная диктатура', 'Госсоциализм', 'Теократия'],
} as const satisfies Record<string, readonly (typeof IDEOLOGIES)[number][]>
export const ITEM_KINDS = ['связь', 'статус', 'козырь', 'антикозырь', 'стигма', 'вещь', 'дело'] as const
export const COUNTRY_POS = ['ядро', 'полупериферия', 'периферия'] as const

/** 11 осей культуры: [первый полюс, второй полюс]. */
export const CULTURE_AXES = [
  ['Коллективизм', 'Индивидуализм'], ['Иерархия', 'Равенство'], ['Патриархат', 'Матриархат'], ['Порядок', 'Риск'],
  ['Теизм', 'Секуляризм'], ['Традиция', 'Самовыражение'], ['Фамилизм', 'Институции'], ['Доверие', 'Цинизм'],
  ['Честь', 'Достоинство'], ['Материализм', 'Гуманизм'], ['Этноцентризм', 'Открытость'],
] as const
export const CULTURE_POLES = CULTURE_AXES.flat()

/** 7 осей характера. */
export const CHAR_AXES = [
  ['Самолюбие', 'Скромность'], ['Хватка', 'Щедрость'], ['Влюбчивость', 'Верность'], ['Соперничество', 'Участие'],
  ['Аппетит', 'Мера'], ['Вспыльчивость', 'Выдержка'], ['Беспечность', 'Усердие'],
] as const
export const CHAR_POLES = CHAR_AXES.flat()

export const CULTURES = ['Карвенцы', 'Олейцы', 'Сарды', 'Веллийцы', 'Тамирцы', 'Хаддры', 'Эшвины'] as const
export const RACES = ['Лирены', 'Тальвы', 'Сэйны', 'Ванэи', 'Кессы', 'Ориды', 'Аэлы'] as const

/** Каталог тегов (концепция, «Каталог тегов»). */
export const TAGS = [
  '#семья', '#любовь', '#дружба', '#община', '#вера', '#культура', '#раскрытие', '#утрата',
  '#работа', '#карьера', '#своёдело', '#сделка', '#собственность', '#бедность',
  '#бюрократия', '#закон', '#политика', '#война', '#власть',
  '#образование', '#традиция', '#девиация',
  '#статус', '#связи', '#заслуги', '#гендер', '#чужак', '#эмиграция',
  '#доверие', '#мошенничество', '#помощь',
  '#здоровье', '#тело', '#старение', '#удовольствие',
  '#конфликт', '#насилие', '#медиа',
] as const

/**
 * Особые правила: то, что делает код движка, а не общий эффект.
 * Каждое правило описано в docs/CARDS.md; новое добавляется сюда и туда.
 */
export const RULES = [
  'обряд',          // бесплатно срабатывает обряд культуры игрока (как точка обмена во взрослом рынке)
  'летопись',       // отметка в Летописи мира (arg — какому виду и сколько)
  'потерять вещь',
  'оставить одну вещь', // из Имущества оставить одну вещь, остальные продать по скупке
  'раздать вещи',   // сбросить все вещи из Имущества: +1 псих. за каждую (до +3), Пожертвования +1
  'отдать всё',     // отдать все возм. выше 0 (arg — на что)
  'смута',          // влияние в ближайшей Смуте (arg — сколько)
  'дело прогорело', // своё дело прогорает, как на входе в отрезок: карта в сброс, −2 псих. (мафиозные — стигма; социал-демократия — пособие)
  'дело в сброс',   // карта своего дела уходит в сброс без других потерь («разорён»)
  'выручка',        // касса взаимопомощи: один раз до конца отрезка +2 возм. в беде (arg)
  'катастрофа мягче', // следующая катастрофа в этом отрезке на 1 мягче
  'свадьба',        // Партнёр становится Супругом(ой), как на развилке «Партнёрство» (с проверкой мезальянса)
  'эмиграция',      // эмиграция по правилам (arg — особые условия: без проверки, класс сохраняется)
  'стабильность',   // сдвиг стабильности страны проживания (arg — на сколько)
  'итог воспитания', // поправка к «Итогу воспитания» ребёнка (arg — сколько), важно в «Роде»  // потерять одну вещь из Имущества, при нескольких — случайную (d6)
] as const

/** События, которых может ждать отложенный эффект (`later`). */
export const LATER_EVENTS = ['вход в Зрелость', 'вход в следующий отрезок', 'смена власти', 'выход из тюрьмы'] as const

// ── Условия ─────────────────────────────────────────────────────────────

const Stat = z.enum(STATS)
const Param = z.enum(PARAMS)
const Tag = z.enum(TAGS)
const Segment = z.enum(SEGMENTS)
const Class = z.enum(CLASSES)
const Ideology = z.enum([...IDEOLOGIES, ...(Object.keys(IDEOLOGY_GROUPS) as (keyof typeof IDEOLOGY_GROUPS)[])])
const CulturePole = z.enum(CULTURE_POLES)
const CharPole = z.enum(CHAR_POLES)
const ItemName = z.string().min(1)

export type Cond =
  | { all: Cond[] } | { any: Cond[] } | { not: Cond }
  | { p: (typeof PARAMS)[number]; gte?: number; lte?: number }
  | { pos: (typeof COUNTRY_POS)[number][] }
  | { ideo: z.infer<typeof Ideology>[] }
  | { culture: (typeof CULTURE_POLES)[number]; strong?: boolean }
  | { neutral: (typeof CULTURE_POLES)[number] }
  | { char: (typeof CHAR_POLES)[number]; strong?: boolean }
  | { cls: (typeof CLASSES)[number][] }
  | { sex: 'м' | 'ж' }
  | { sexFavored: boolean }
  | { familyCls: (typeof CLASSES)[number][] }
  | { war: boolean }
  | { partnerMinority: boolean }
  | { minority: boolean }
  | { has: string }
  | { seg: (typeof SEGMENTS)[number][] }
  | { flag: string }
  | { mainCulture: (typeof CULTURES)[number][] }
  | { diaspora: boolean }
  | { mode: 'поколение' | 'род' }
  | { meaning: 'найден' | 'серость' }
  | { hasKind: (typeof ITEM_KINDS)[number] }
  | { visited: string }
  | { emigrant: boolean }
  | { notAlone: boolean }
  | { partnerDiff: 'культура' | 'класс' }
  | { count: string; gte: number }
  | { powerChanged: boolean; inSeg?: true }
  | { stability: { gte?: number; lte?: number } }
  | { clsRole: 'доминирующий' | 'отчуждённый' }
  | { dominant: (typeof CLASSES)[number][] }
  | { alienated: (typeof CLASSES)[number][] }
  | { multicultural: boolean }
  | { relation: 'вражда' | 'союз' }
  | { fromHostile: boolean }
  | { inFashion: boolean }
  | { cultureIs: (typeof CULTURES)[number][] }
  | { ownBusiness: boolean }
  | { working: boolean }

export const Cond: z.ZodType<Cond> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(Cond).min(2) }),
    z.strictObject({ any: z.array(Cond).min(2) }),
    z.strictObject({ not: Cond }),
    z.strictObject({ p: Param, gte: z.number().int().optional(), lte: z.number().int().optional() })
      .refine((c) => c.gte !== undefined || c.lte !== undefined, 'нужен gte или lte'),
    z.strictObject({ pos: z.array(z.enum(COUNTRY_POS)).min(1) }),
    z.strictObject({ ideo: z.array(Ideology).min(1) }),
    z.strictObject({ culture: CulturePole, strong: z.boolean().optional() }),
    z.strictObject({ neutral: CulturePole }),
    z.strictObject({ char: CharPole, strong: z.boolean().optional() }),
    z.strictObject({ cls: z.array(Class).min(1) }),
    z.strictObject({ sex: z.enum(['м', 'ж']) }),
    /** Пол игрока в преимуществе (true) или в помехе (false) по оси Патриархат ↔ Матриархат; при 0 — ни то ни другое. */
    z.strictObject({ sexFavored: z.boolean() }),
    /** Класс семьи игрока (класс при рождении): «семья не армейская». */
    z.strictObject({ familyCls: z.array(Class).min(1) }),
    /** Страна проживания сейчас воюет. */
    z.strictObject({ war: z.boolean() }),
    /** Партнёр или Супруг(а) не из большинства страны. */
    z.strictObject({ partnerMinority: z.boolean() }),
    z.strictObject({ minority: z.boolean() }),
    z.strictObject({ has: ItemName }),
    z.strictObject({ seg: z.array(Segment).min(1) }),
    z.strictObject({ flag: z.string().min(1) }),
    /** Основная культура страны проживания. По ней же география: Большое озеро — Карвенцы, Олейцы; болота — Эшвины; ледник — Сарды. */
    z.strictObject({ mainCulture: z.array(z.enum(CULTURES)).min(1) }),
    /** Диаспора без своих: культуры игрока нет в стране ни как основной, ни как меньшинства. */
    z.strictObject({ diaspora: z.boolean() }),
    /** Режим партии. Отметки в Летописи — только «Род». */
    z.strictObject({ mode: z.enum(['поколение', 'род']) }),
    /** Смысл жизни найден (карта Случайных или Династии) или у игрока Серость. */
    z.strictObject({ meaning: z.enum(['найден', 'серость']) }),
    /** Есть хотя бы один предмет этого вида. */
    z.strictObject({ hasKind: z.enum(ITEM_KINDS) }),
    /** В этом отрезке игрок был в этом месте рынка («Салон в этом отрезке»). */
    z.strictObject({ visited: z.string().min(1) }),
    /** Игрок живёт не в стране рождения. */
    z.strictObject({ emigrant: z.boolean() }),
    /** «Живёшь не один»: Супруг(а) или Партнёр; или отметка «Не один» в журнале (до конца жизни); или сиделка за 2 возм., оплаченная в этот ход в Древности. */
    z.strictObject({ notAlone: z.boolean() }),
    /** Партнёр или Супруг(а) другой культуры или другого класса, чем игрок. */
    z.strictObject({ partnerDiff: z.enum(['культура', 'класс']) }),
    /** Предметов с этим именем не меньше gte («при двух детях и больше»). */
    z.strictObject({ count: ItemName, gte: z.number().int().positive() }),
    /** В стране проживания за партию (inSeg — в этом отрезке) была смена власти. */
    z.strictObject({ powerChanged: z.boolean(), inSeg: z.literal(true).optional() }),
    /** Стабильность страны проживания. */
    z.strictObject({ stability: z.strictObject({ gte: z.number().int().optional(), lte: z.number().int().optional() }) }),
    /** Класс игрока — доминирующий или отчуждённый в его стране. */
    z.strictObject({ clsRole: z.enum(['доминирующий', 'отчуждённый']) }),
    /** Доминирующий или отчуждённый класс страны (независимо от класса игрока): «при отчуждённом Народе». */
    z.strictObject({ dominant: z.array(Class).min(1) }),
    z.strictObject({ alienated: z.array(Class).min(1) }),
    /** Страна мультикультурная. */
    z.strictObject({ multicultural: z.boolean() }),
    /** У страны проживания есть страна, с которой она во вражде или в союзе. */
    z.strictObject({ relation: z.enum(['вражда', 'союз']) }),
    /** Игрок — эмигрант из страны, с которой страна проживания во вражде. */
    z.strictObject({ fromHostile: z.boolean() }),
    /** Раса игрока в моде в стране (канон красоты). */
    z.strictObject({ inFashion: z.boolean() }),
    /** Культура игрока — одна из названных (для бикультурных — родная или приёмная). */
    z.strictObject({ cultureIs: z.array(z.enum(CULTURES)).min(1) }),
    /** У игрока своё дело (лежит карта дела). */
    z.strictObject({ ownBusiness: z.boolean() }),
    /** Работает (в этом отрезке ставил Стаж; подработка не в счёт) или учится (высшее, идёт Молодость). */
    z.strictObject({ working: z.boolean() }),
  ]),
)

// ── Проверки ────────────────────────────────────────────────────────────

/** Поправка к проверке при условии: новая сложность, ±к броску, преимущество, помеха, автоуспех. */
const CheckMod = z.strictObject({
  if: Cond,
  dc: z.number().int().optional(),
  add: z.number().int().optional(),
  adv: z.literal(true).optional(),
  dis: z.literal(true).optional(),
  auto: z.literal(true).optional(),
  /** Поправка от козыря: игрок решает, тратить ли его («Знакомый врач» +5). */
  spend: z.literal(true).optional(),
  /** В колоде «по полюсам»: поправка не зависит от силы положения (написана не в скобках). */
  fixed: z.literal(true).optional(),
})

export const Check = z.strictObject({
  /** Одна характеристика или несколько на выбор игрока («🎲 Интеллект или Харизма 12»). */
  stat: z.union([Stat, z.array(Stat).min(2)]),
  dc: z.number().int(),
  /** Другие характеристики со своей сложностью («🎲 Смекалка 12 или Сила 15»). */
  or: z.array(z.strictObject({ stat: Stat, dc: z.number().int() })).optional(),
  mods: z.array(CheckMod).optional(),
  /** Что проверяется, если это сказано на карте («понять, к кому идти»). */
  what: z.string().optional(),
})
export type Check = z.infer<typeof Check>

// ── Эффекты ─────────────────────────────────────────────────────────────

/** Диапазон на кубике: «6», «1-2», «4-6». */
const Range = z.string().regex(/^\d+(-\d+)?$/, 'диапазон вида «1-2» или «6»')

export type Node =
  | { add: Partial<Record<(typeof PARAMS)[number], number>> }
  | { addOneOf: (typeof STATS)[number][]; n: number }
  | { addUsed: number }
  | { later: { when: (typeof LATER_EVENTS)[number]; until?: 'отрезок'; then: Node[] } }
  | { miracle: (typeof STATS)[number][] | 'любая' }
  | { gain: string; blind?: boolean; adopted?: true }
  | { lose: string; price?: true }
  | { income: number; until: 'отрезок' }
  | { pension: number }
  | { reshuffle: true }
  | { noAging: number }
  | { charStep: (typeof CHAR_POLES)[number]; n?: number }
  | { cls: (typeof CLASSES)[number] }
  | { allowCls: (typeof CLASSES)[number] }
  | { prison: 'лёгкое' | 'тяжёлое' }
  | { check: Check; success: Node[]; failure: Node[] }
  | { choose: { label: string; if?: Cond; then: Node[] }[] }
  | { d6: Record<string, Node[]> }
  | { if: Cond; then: Node[]; else?: Node[] }
  | { cases: { if: Cond; then: Node[] }[]; else?: Node[] }
  | { mod: { tag?: (typeof TAGS)[number]; fork?: string; add?: number; adv?: true; dis?: true; until: 'отрезок' | 'проверка' | 'вражда'; max?: 'отрезок' } }
  | { cancelable: string[]; then: Node[] }
  | { useTrump: string[]; then: Node[]; else: Node[] }
  | { flag: string }
  | { rule: (typeof RULES)[number]; arg?: string }
  | { bottom: true }
  | { say: string }

export const Node: z.ZodType<Node> = z.lazy(() =>
  z.union([
    /** Изменение чисел: { add: { "Харизма": 1, "псих": -1 } }. Возрастной сдвиг к физ./псих. добавляет движок. */
    z.strictObject({ add: z.partialRecord(Param, z.number().int()) }),
    /** +n к одной характеристике на выбор игрока. */
    z.strictObject({ addOneOf: z.array(Stat).min(2), n: z.number().int() }),
    /** +n к характеристике, которой игрок бросал последнюю проверку («успех — +1 к ней»). */
    z.strictObject({ addUsed: z.number().int() }),
    /** Отложенный эффект: сработает при событии; until — только если событие случится до конца отрезка. */
    z.strictObject({
      later: z.strictObject({ when: z.enum(LATER_EVENTS), until: z.literal('отрезок').optional(), then: z.array(Node) }),
    }),
    /** Чудо: +2 к характеристике, гриф вскрыт (потолок 12). */
    z.strictObject({ miracle: z.union([z.array(Stat).min(1), z.literal('любая')]) }),
    /** Получить предмет по имени из каталога. blind — «вслепую» из стопки людей. */
    z.strictObject({ gain: ItemName, blind: z.boolean().optional(), adopted: z.literal(true).optional() }),
    /** Потерять предмет. price — со своей ценой сброса («расставание по обычной цене»). */
    z.strictObject({ lose: ItemName, price: z.literal(true).optional() }),
    /** Прибавка к доходу за ход до конца отрезка. */
    z.strictObject({ income: z.number().int(), until: z.literal('отрезок') }),
    /** Надбавка к пенсии каждый ход до конца жизни — по правилам пенсии: нет пенсии (Стаж 0–4) — нет и надбавки; потолок «не больше обычного дохода» — вместе с надбавкой. */
    z.strictObject({ pension: z.number().int() }),
    /** Карта замешивается обратно в колоду, а не уходит в сброс («он вернётся»). */
    z.strictObject({ reshuffle: z.literal(true) }),
    /** Древность: n ходов без ежеходной потери физ. («2 хода без потери физ.»). */
    z.strictObject({ noAging: z.number().int().positive() }),
    /** «Характер на шаг к Вспыльчивости». */
    z.strictObject({ charStep: CharPole, n: z.number().int().optional() }),
    /** Смена класса. Ключи старого класса («Присяга», «Значок») гаснут, «Диплом» остаётся. */
    z.strictObject({ cls: Class }),
    /** «Разрешено перейти в класс …»: разовое окно — игрок решает сразу, при розыгрыше карты; позже нельзя. */
    z.strictObject({ allowCls: Class }),
    /** Тюрьма: лёгкое — d3 хода, тяжёлое — d6 + 2 (концепция, «Тотальные институты»). */
    z.strictObject({ prison: z.enum(['лёгкое', 'тяжёлое']) }),
    /** Проверка 3d6 + характеристика ≥ сложность. Теги карты сами дают поправки культуры, характера, предметов. */
    z.strictObject({ check: Check, success: z.array(Node), failure: z.array(Node) }),
    /** Решение игрока. if — вариант доступен только при условии. */
    z.strictObject({ choose: z.array(z.strictObject({ label: z.string().min(1), if: Cond.optional(), then: z.array(Node) })).min(2) }),
    /** Бросок d6 с исходами: { "d6": { "1-2": [...], "6": [...] } }. Пропущенные значения — ничего. */
    z.strictObject({ d6: z.record(Range, z.array(Node)) }),
    z.strictObject({ if: Cond, then: z.array(Node), else: z.array(Node).optional() }),
    /** Первая подходящая ветка: «Ядро: … Полупериферия: … Периферия: …». */
    z.strictObject({ cases: z.array(z.strictObject({ if: Cond, then: z.array(Node) })).min(2), else: z.array(Node).optional() }),
    /** Временная поправка к будущим проверкам. */
    z.strictObject({
      mod: z.strictObject({
        tag: Tag.optional(), fork: z.string().optional(), add: z.number().int().optional(), adv: z.literal(true).optional(), dis: z.literal(true).optional(),
        until: z.enum(['отрезок', 'проверка', 'вражда']),
        /** Для until «проверка»: сгорает в конце отрезка, даже если проверки так и не было. */
        max: z.literal('отрезок').optional(),
      }),
    }),
    /** Шаги, которые игрок может отменить козырем («Знакомый врач» отменяет осложнение). Козырь тратится. */
    z.strictObject({ cancelable: z.array(ItemName).min(1), then: z.array(Node) }),
    /** Игрок решает, тратить ли козырь: потратил — then, не стал или нет козыря — else. */
    z.strictObject({ useTrump: z.array(ItemName).min(1), then: z.array(Node), else: z.array(Node) }),
    /** Отметка в журнале жизни: прошлые события для условий смысла и карт. */
    z.strictObject({ flag: z.string().min(1) }),
    z.strictObject({ rule: z.enum(RULES), arg: z.string().optional() }),
    /** Карта уходит под низ колоды, а не в сброс. */
    z.strictObject({ bottom: z.literal(true) }),
    /** Текст без механики, который игрок видит в журнале. */
    z.strictObject({ say: z.string().min(1) }),
  ]),
)

// ── Карта ───────────────────────────────────────────────────────────────

export const DECKS = {
  'возраст.детство': 'Возраст: Детство',
  'возраст.юность': 'Возраст: Юность',
  'возраст.молодость': 'Возраст: Молодость',
  'возраст.зрелость': 'Возраст: Зрелость',
  'возраст.старость': 'Возраст: Старость',
  'возраст.древность': 'Возраст: Древность',
  'отношения': 'Отношения',
  'культура': 'Культура',
  'страна': 'Страна',
  'класс': 'Класс',
  'судьба': 'Судьба',
  'развилка': 'Развилка',
  'смута': 'Смута',
  'мир': 'Мир',
  'тюрьма': 'Тюрьма',
  'психбольница': 'Психбольница',
  'кабала': 'Кабала',
} as const
export type DeckId = keyof typeof DECKS

/** Латинские имена файлов колод: кириллица в путях ломается на некоторых системах. */
export const DECK_FILES: Record<DeckId, string> = {
  'возраст.детство': 'age-childhood', 'возраст.юность': 'age-youth', 'возраст.молодость': 'age-young',
  'возраст.зрелость': 'age-mature', 'возраст.старость': 'age-old', 'возраст.древность': 'age-ancient',
  'отношения': 'relations', 'культура': 'culture', 'страна': 'country', 'класс': 'class', 'судьба': 'fate',
  'развилка': 'forks', 'смута': 'turmoil', 'мир': 'world', 'тюрьма': 'prison', 'психбольница': 'asylum', 'кабала': 'bondage',
}

export const Card = z.strictObject({
  /** Уникальный id: колода и номер, «возраст.детство.04». */
  id: z.string().regex(/^[а-яё.-]+\.\d{2,3}[а-я]?$/),
  n: z.number().int().positive(),
  title: z.string().min(1),
  /** Художественный текст карты. */
  text: z.string(),
  /** Оригинальный текст эффекта из документа колод — дословно. */
  src: z.string(),
  /** Тип: Б — просто бывает, П — проверка, Р — решение. */
  kind: z.enum(['Б', 'П', 'Р']),
  /** Подсекторы для колод Возраста (коды из документа колод), отрезки — для общих колод. */
  sub: z.array(z.string()).optional(),
  segs: z.array(Segment).optional(),
  /** Для колоды «Класс» — чья стопка. */
  cls: Class.optional(),
  tags: z.array(Tag).max(2),
  /** Карта играется только при условии, иначе уходит в сброс и тянут следующую («Только со статусом «Диплом»…»). */
  requires: Cond.optional(),
  /** Козыри, которые отменяют карту целиком («Козырь «Справка» отменяет карту»). Козырь тратится. */
  cancelBy: z.array(ItemName).optional(),
  miracle: z.literal(true).optional(),
  effect: z.array(Node),
  /** Вопросы к автору правил. Пока вопрос открыт, карта помечена спорной. */
  doubts: z.array(z.string()).optional(),
})
export type Card = z.infer<typeof Card>

export const DeckFile = z.strictObject({
  deck: z.enum(Object.keys(DECKS) as [DeckId, ...DeckId[]]),
  /**
   * Колода «по полюсам» (Культура). Числа в ветках с условием `culture` (без `strong`) и на картах
   * с `requires: { culture }` написаны для «умеренно»; при «сильно» на 1 крупнее только псих., физ. и возм.
   * (+1 → +2, −2 → −3; смягчение тоже растёт). Сплочённость, характеристики, d6, сложности и бонусы не растут.
   * Поправки по полюсу в `mods` (сложность и бонус) написаны для «сильно», при «умеренно» — ±1 от обычного,
   * кроме помеченных `fixed`. Бонус тега культуры не добавляется.
   */
  polar: z.literal(true).optional(),
  /** Расшифровка кодов подсекторов колоды. */
  sub: z.record(z.string(), z.string()).optional(),
  cards: z.array(Card),
})
export type DeckFile = z.infer<typeof DeckFile>
