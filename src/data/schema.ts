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
  'гражданство',    // гражданство другой страны (arg — какой): туда без проверки границы
  'только подработка', // до конца отрезка из работ доступна только Подработка
  'катастрофа мимо', // первая катастрофа до конца отрезка игрока минует
  'утрата близкого', // бросок среди людей игрока (Партнёр или Супруг(а), Друг, Наставник, Покровитель): кто ушёл — связь теряется
  'студент',        // первые 15 клеток Молодости — студент: из работ только Подработка, Стаж не идёт
  'казённое место', // до конца отрезка карты #работа с потерей возм. бьют на 1 слабее
  'пенсия',         // уйти на пенсию: пенсия по Стажу найма
  'работа на пенсии', // Работа остаётся, но каждая отметка Стажа стоит ещё −1 физ.
  'учить молодых',  // пенсия по Стажу, доход как Подработка
  'изъять козырь',  // обыск: один козырь (если есть) изъят
  'отдать предмет', // отдать статус или козырь (arg — что получаешь)
  'сбросить козыри', // все козыри сброшены
  'срок стигмы',    // особый срок стигмы (arg: «Судимость гаснет через один ход», «Учёт вдвое дольше»)
  'только работа',  // после выхода весь следующий отрезок только Работа, без Подработки
  // Мир и Смута: то, что код делает со странами и сторонами
  'проверка кризиса', // в целевой стране сразу проверка кризиса (может начаться Смута)
  'отношения',      // меняются отношения стран (arg: «враждующая пара → нейтралитет» и т. п.)
  'война',          // страны воюют (arg — кто); у проигравшей сразу проверка кризиса
  'бегство',        // право на бегство сразу (правила эмиграции)
  'карантин',       // до следующего круга: из работ только Подработка, из рынка — больница и семья
  'до мирового хода', // эффект действует до следующего мирового хода (arg — какой)
  'новая земля',    // открываются «Земли за ледником»
  'обряд дорожает', // обряд культуры дорожает (arg)
  'правило тюрьмы', // общее правило Смуты о тюрьме: не действует / тяжёлое / для всех (arg)
  'выбрать сторону', // нейтрал сейчас выбирает сторону и читает её строку
  'стать нейтралом', // проигравший становится нейтралом задним числом
  'донос на нейтрала', // донести на нейтрала-игрока: его проверка с −3
  'стать проигравшим', // нейтрал читает строку проигравших
  'люстрация',      // теряются «Значок», «Присяга», «Офицерское звание», «Партбилет» (arg — сколько сохраняется); Армия и Полиция без статуса — класс Народ
  'итог воспитания', // поправка к «Итогу воспитания» ребёнка (arg — сколько), важно в «Роде»  // потерять одну вещь из Имущества, при нескольких — случайную (d6)
] as const

/** События, которых может ждать отложенный эффект (`later`). */
export const LATER_EVENTS = ['вход в Зрелость', 'вход в следующий отрезок', 'смена власти', 'выход из тюрьмы', 'конец учёбы', 'переход в Мафию', 'следующий мировой ход'] as const

/**
 * Журнал жизни: счётчики событий, которые движок ведёт с рождения.
 * На них ссылаются карты смысла («Никогда не эмигрировать», «Сменить класс дважды»).
 */
export const LOG_EVENTS = [
  // страна и класс
  'эмиграция', 'возвращение на родину', 'бегство', 'вход в отрезок без документов',
  'смена класса', 'уход из Армии', 'уход из Мафии', 'уход из Олигархов',
  'получен Партбилет, Присяга или Значок',
  // семья
  'партнёр', 'развод', 'первый брак в Зрелости или позже',
  // мир и власть
  'война', 'смена власти', 'смена власти без потери класса', 'смена власти при возм. +5 и выше',
  'смена власти с Присягой', 'смена власти со Значком', 'победа в Смуте', 'поражение в Смуте',
  'глобальное событие в своей стране',
  // институты и долги
  'тюрьма', 'срок отбыт', 'психбольница', 'кабала', 'выход из института', 'повторное попадание в институт',
  'Стаж после выхода', 'микрозайм',
  // предметы
  'козырь получен', 'получен «Компромат»', 'антикозырь сыгран', 'стигма получена', 'стигма снята',
  // рынок
  'бар', 'казино', 'выигрыш в казино', 'бордель', 'хобби', 'обряд своей культуры', 'обряд в новой стране',
  'пожертвование в храме', 'вещь через Заповедник', 'отметка в Заповеднике', 'виды с отметками в Заповеднике',
  'отрезков с Хобби', 'отрезков с Храмом', 'отрезков с Курсами',
] as const

/** Производные значения «сейчас», которых нет среди параметров. */
export const VALUES = ['пенсия', 'связи', 'вещи', 'козыри', 'друзья', 'аккультурация', 'аккультурация (максимум за жизнь)'] as const

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
  | { log: (typeof LOG_EVENTS)[number]; gte?: number; lte?: number }
  | { val: (typeof VALUES)[number]; gte?: number; lte?: number }
  | { countOf: string[]; gte: number }
  | { atEntry: (typeof SEGMENTS)[number]; cond: Cond }
  | { reached: (typeof SEGMENTS)[number] }
  | { clsVsBirth: 'выше' | 'не ниже' }
  | { partnerCls: (typeof CLASSES)[number][] }
  | { inInst: 'тюрьма' | 'психбольница' | 'кабала' }
  | { mainCulture: (typeof CULTURES)[number][] }
  | { diaspora: boolean }
  | { mode: 'поколение' | 'род' }
  | { meaning: 'найден' | 'серость' }
  | { hasKind: (typeof ITEM_KINDS)[number] }
  | { visited: string }
  | { draft: boolean }
  | { inTarget: boolean }
  | { draftable: boolean }
  | { formerDominant: boolean }
  | { side: 'победители' | 'проигравшие' | 'нейтралы' }
  | { chose: string }
  | { sentenceTag: (typeof TAGS)[number] }
  | { emigrant: boolean }
  | { notAlone: boolean }
  | { partnerDiff: 'культура' | 'класс' | 'раса' }
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
    /** Счётчик журнала жизни: { log: "эмиграция", gte: 1 }, «никогда» — lte: 0. */
    z.strictObject({ log: z.enum(LOG_EVENTS), gte: z.number().int().optional(), lte: z.number().int().optional() })
      .refine((c) => c.gte !== undefined || c.lte !== undefined, 'нужен gte или lte'),
    /** Производное значение сейчас: пенсия за ход, число связей, вещей, козырей, друзей, шаг аккультурации. */
    z.strictObject({ val: z.enum(VALUES), gte: z.number().int().optional(), lte: z.number().int().optional() })
      .refine((c) => c.gte !== undefined || c.lte !== undefined, 'нужен gte или lte'),
    /** Одновременно есть не меньше gte предметов из списка. */
    z.strictObject({ countOf: z.array(ItemName).min(2), gte: z.number().int().positive() }),
    /** Условие выполнялось в момент входа в отрезок («Войти в Старость в браке»). */
    z.strictObject({ atEntry: Segment, cond: Cond }),
    /** Дожить до отрезка. */
    z.strictObject({ reached: Segment }),
    /** Класс относительно класса рождения по лестнице: Народ < Армия = Полиция = Интеллигенция < Мафия < Олигархи. */
    z.strictObject({ clsVsBirth: z.enum(['выше', 'не ниже']) }),
    /** Класс Партнёра или Супруга(и). */
    z.strictObject({ partnerCls: z.array(Class).min(1) }),
    /** Игрок сейчас в институте. */
    z.strictObject({ inInst: z.enum(['тюрьма', 'психбольница', 'кабала']) }),
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
    /** В стране призыв и он касается игрока: военная диктатура, госсоциализм, национализм — всегда, остальные — d6 1–3 (бросок при розыгрыше); зовут пол в преимуществе, при 0 — всех. */
    z.strictObject({ draft: z.boolean() }),
    /** Мир: игрок живёт в целевой стране карты. */
    z.strictObject({ inTarget: z.boolean() }),
    /** Подлежит призыву: Молодость или Зрелость, пол в преимуществе (при 0 — любой), как в «Повестке». */
    z.strictObject({ draftable: z.boolean() }),
    /** Смута: класс игрока был доминирующим до смены власти. */
    z.strictObject({ formerDominant: z.boolean() }),
    /** Смута: сторона игрока. */
    z.strictObject({ side: z.enum(['победители', 'проигравшие', 'нейтралы']) }),
    /** Игрок выбрал на этой карте вариант с такой подписью (для строк сторон, которые зависят от выбора). */
    z.strictObject({ chose: z.string().min(1) }),
    /** Игрок в институте за событие с этим тегом («только если срок за #политика»). */
    z.strictObject({ sentenceTag: Tag }),
    /** Игрок живёт не в стране рождения. */
    z.strictObject({ emigrant: z.boolean() }),
    /** «Живёшь не один»: Супруг(а) или Партнёр; или отметка «Не один» в журнале (до конца жизни); или сиделка за 2 возм., оплаченная в этот ход в Древности. */
    z.strictObject({ notAlone: z.boolean() }),
    /** Партнёр или Супруг(а) другой культуры или другого класса, чем игрок. */
    z.strictObject({ partnerDiff: z.enum(['культура', 'класс', 'раса']) }),
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
  /** Без условия — поправка действует всегда (например, после оплаченного лечения). */
  if: Cond.optional(),
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
  | { add: Partial<Record<(typeof PARAMS)[number], number>>; cap?: number }
  | { stab: number }
  | { addOneOf: (typeof STATS)[number][]; n: number }
  | { addUsed: number }
  | { addPredisp: number }
  | { addClassStat: number; both?: true }
  | { installments: number; each: Node[] }
  | { everySeg: Node[] }
  | { term: number }
  | { set: Partial<Record<(typeof PARAMS)[number], number>> }
  | { release: true; noStigma?: true }
  | { workoff: number }
  | { halve: 'возм' }
  | { later: { when: (typeof LATER_EVENTS)[number]; until?: 'отрезок'; then: Node[] } }
  | { miracle: (typeof STATS)[number][] | 'любая' }
  | { gain: string; blind?: boolean; adopted?: true }
  | { lose: string; price?: true }
  | { income: number; until: 'отрезок' | 'конец Молодости' | 'жизнь' }
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
  | { mod: { tag?: (typeof TAGS)[number]; fork?: string; add?: number; adv?: true; dis?: true; until: 'отрезок' | 'проверка' | 'вражда' | 'конец Молодости'; max?: 'отрезок' } }
  | { cancelable: string[]; then: Node[] }
  | { useTrump: string[]; then: Node[]; else: Node[] }
  | { flag: string }
  | { rule: (typeof RULES)[number]; arg?: string }
  | { bottom: true }
  | { say: string }

export const Node: z.ZodType<Node> = z.lazy(() =>
  z.union([
    /** Изменение чисел: { add: { "Харизма": 1, "псих": -1 } }. Возрастной сдвиг к физ./псих. добавляет движок. */
    z.strictObject({ add: z.partialRecord(Param, z.number().int()), cap: z.number().int().optional() }),
    /** Мир и Смута: стабильность целевой страны ±n (в части `country`) или страны игрока. */
    z.strictObject({ stab: z.number().int() }),
    /** +n к одной характеристике на выбор игрока. */
    z.strictObject({ addOneOf: z.array(Stat).min(2), n: z.number().int() }),
    /** +n к характеристике, которой игрок бросал последнюю проверку («успех — +1 к ней»). */
    z.strictObject({ addUsed: z.number().int() }),
    /** +n к характеристике предрасположенности. */
    z.strictObject({ addPredisp: z.number().int() }),
    /** +n к характеристике пригодности своего класса (на выбор из двух; both — к обеим). */
    z.strictObject({ addClassStat: z.number().int(), both: z.literal(true).optional() }),
    /** Платежи: по одному на входе в каждый следующий подсектор (половину отрезка), всего n («4 жетона на карте»). */
    z.strictObject({ installments: z.number().int().positive(), each: z.array(Node) }),
    /** До конца жизни, в начале каждого отрезка («десятина»). */
    z.strictObject({ everySeg: z.array(Node) }),
    /** Установить значение («долг списан до −10»). */
    z.strictObject({ set: z.partialRecord(Param, z.number().int()) }),
    /** Институт: срок ±n ходов. */
    z.strictObject({ term: z.number().int() }),
    /** Институт: выйти сейчас; noStigma — без стигмы выхода («Судимость», «Учёт», «Долг»). */
    z.strictObject({ release: z.literal(true), noStigma: z.literal(true).optional() }),
    /** Кабала: до конца срока ход отработки даёт n возм. вместо +2. */
    z.strictObject({ workoff: z.number().int() }),
    /** Потерять половину (округление вниз): «Возможности 4+: потеряна половина». */
    z.strictObject({ halve: z.literal('возм') }),
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
    z.strictObject({ income: z.number().int(), until: z.enum(['отрезок', 'конец Молодости', 'жизнь']) }),
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
        until: z.enum(['отрезок', 'проверка', 'вражда', 'конец Молодости']),
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
  id: z.string().regex(/^[а-яё.-]+\.[а-яё]?\d{1,3}[а-я]?$/),
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
  /** Мир: охват (спокойно, местный, глобальный). */
  scope: z.enum(['спокойно', 'местный', 'глобальный']).optional(),
  /** Мир: какую страну бьёт карта; условия в `country` проверяются на ней, `inTarget` — живёт ли там игрок. */
  target: z.enum([
    'нет', 'все', 'случайная', 'случайная не из ядра', 'случайная с врагом', 'враждующая пара',
    'периферия с наименьшей стабильностью', 'самая этноцентричная', 'по культуре',
  ]).optional(),
  /** Мир: что происходит со страной (колонка «Страна»). */
  country: z.array(Node).optional(),
  /** Смута: строки сторон; `effect` — строка «Для всех». */
  sides: z.strictObject({ win: z.array(Node), lose: z.array(Node), neutral: z.array(Node) }).optional(),
  /** Институты: фильтр карты из документа («Либеральная демократия», «Ядро»); условие — в `requires`. */
  filter: z.string().optional(),
  /** Развилка, напечатанная на поле: где стоит («на поле, клетка 8»). */
  cell: z.string().optional(),
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

// ── Смыслы ──────────────────────────────────────────────────────────────

/**
 * Условие карты смысла.
 * сост. — засчитывается, пока выполняется; соб. — один раз и навсегда: движок с рождения помнит,
 * что условие хоть раз выполнилось; итог — проверяется в момент смерти.
 */
export const MeaningCond = z.strictObject({
  /** Оригинальный текст условия. */
  text: z.string().min(1),
  kind: z.enum(['сост.', 'соб.', 'итог']),
  points: z.number().positive(),
  cond: Cond,
})

export const Meaning = z.strictObject({
  /** «серость», «смысл.01» … «смысл.70», «династия.01» … «династия.30». */
  id: z.string().regex(/^(серость|смысл\.\d{2}|династия\.\d{2})$/),
  deck: z.enum(['Серость', 'Случайные', 'Династии']),
  n: z.number().int().nonnegative(),
  title: z.string().min(1),
  motto: z.string(),
  difficulty: z.enum(['Серость', 'Простой', 'Средний', 'Сложный']),
  /** Необычный смысл (5 на колоду). */
  unusual: z.literal(true).optional(),
  tags: z.array(Tag),
  /** Требование карты: не подходишь — тянешь следующую. */
  requires: Cond.optional(),
  requiresText: z.string().optional(),
  conds: z.array(MeaningCond).min(4),
  doubts: z.array(z.string()).optional(),
})
export type Meaning = z.infer<typeof Meaning>
export const MeaningsFile = z.strictObject({ meanings: z.array(Meaning) })
