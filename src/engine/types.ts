/** Состояние партии и протокол вопросов. Всё здесь — обычные данные: состояние целиком сохраняется в JSON. */
import type { Board } from '../data/board-schema.ts'
import type {
  Building, Card, CHAR_POLES, FrontFile, CLASSES, COUNTRY_POS, CULTURES, Heir, IDEOLOGIES, Item, ITEM_KINDS, LATER_EVENTS, Meaning, Node, RACES, SEGMENTS, STATS, TAGS,
} from '../data/schema.ts'
import type { Tables } from '../data/tables.ts'

export type Stat = (typeof STATS)[number]
export type Cls = (typeof CLASSES)[number]
export type Pos = (typeof COUNTRY_POS)[number]
export type Ideo = (typeof IDEOLOGIES)[number]
export type Tag = (typeof TAGS)[number]
export type Seg = (typeof SEGMENTS)[number]
export type Culture = (typeof CULTURES)[number]
export type Race = (typeof RACES)[number]
export type CharPole = (typeof CHAR_POLES)[number]
export type ItemKind = (typeof ITEM_KINDS)[number]
export type Slot = '■' | '▲' | '◆'
export type InstKind = 'тюрьма' | 'психбольница' | 'кабала' | 'фронт'
export type Relation = 'вражда' | 'нейтралитет' | 'союз'
/**
 * Режим партии (решено 20.11): span — одна жизнь или поколения, start — «Быль» (кубики) или «Сказка» (сборка).
 * «Биография» = one + dice, «Родословная» = lineage + dice, «Легенда» = one + tale, «Сага» = lineage + tale.
 */
export type Span = 'one' | 'lineage'
export type Start = 'dice' | 'tale'

// ── Содержание ──────────────────────────────────────────────────────────

/**
 * Действие после события: работа, обмен, знакомство, решение рынка молодости. Цена — в слотах хода
 * и в Возможностях; всё остальное — шаги того же формата, что у карт. Содержание — src/data/market.ts.
 */
export interface Action {
  id: string
  label: string
  /** Место рынка (для журнала посещений и условия «был в этом месте в этом отрезке»). */
  place?: string
  slots: Slot[]
  requires?: import('../data/schema.ts').Cond
  /** Сколько раз за отрезок. */
  perSeg?: number
  /** Один раз за жизнь (решения рынка молодости). */
  once?: true
  /** Цена в Возможностях: первая подходящая строка. Заплатить можно только из своих (в минус нельзя). */
  price?: { if?: import('../data/schema.ts').Cond; n: number }[]
  /** Потолок характеристик в этом действии (рынок — 7, с предрасположенностью 8; по умолчанию так). */
  cap?: number
  /** Теги — для поправок к проверкам внутри действия. */
  tags?: Tag[]
  /** Счётчики журнала жизни, которые действие увеличивает. */
  log?: (typeof import('../data/schema.ts').LOG_EVENTS)[number][]
  /** Подсказка для игрока. */
  note?: string
  /**
   * Доступ по характеру (решено 17.11). need — нужное место (больница, психолог): не закрывается, проверка d6
   * 3–6 при черте ±1 и 4–6 при ±2. Остальное: ±1 — d6 4–6, ±2 — закрыто; strongRoll — вместо закрытия проверка от этого числа.
   */
  gate?: { pole: CharPole; need?: true; strongRoll?: number } | { pole: CharPole }[]
  /** Попытка считается и тогда, когда проверка характера провалилась («Контора»: одна попытка за отрезок). */
  tryCounts?: true
  /** Отказ с объяснением: условие не выполнено — кнопка неактивна с этой подписью («Банк не верит…»). */
  refuse?: { unless: import('../data/schema.ts').Cond; text: string }[]
  /** Незаконное действие: в клептократии его можно сделать «по знакомству» — −1 возм. сверху, без риска. */
  illegal?: true
  effect: Node[]
}

/** Всё содержание игры. Движок не знает, сколько чего здесь лежит. */
export interface Content {
  /** Колоды событий: id колоды → карты. Колода «по полюсам» перечислена в `polar`. */
  decks: Record<string, Card[]>
  polar: string[]
  /** Коды подсекторов колод Возраста по порядку: первый код — первый подсектор. */
  subCodes: Record<string, string[]>
  items: Item[]
  meanings: Meaning[]
  heirs: Heir[]
  board: Board
  actions: Action[]
  /** Город: здания с кольцами, точками рынка и колодами знакомств. */
  buildings: Building[]
  /** Поле «Фронт»: клетки трека и 140 событий. */
  front: FrontFile
  tables: Tables
}

// ── Мир ─────────────────────────────────────────────────────────────────

export interface Country {
  id: number
  name: string
  pos: Pos
  multicultural: boolean
  mainRaces: Race[]
  mainCultures: Culture[]
  minorityRaces: Race[]
  minorityCultures: Culture[]
  ideology: Ideo
  dominant: Cls
  alienated: Cls
  stability: number
  fashionIn: Race
  fashionOut: Race
  war: boolean
  /** Сколько раз менялась власть за партию. */
  powerChanges: number
  /** Кризис подавлен: отчуждённый класс с помехой до следующего мирового хода. */
  suppressed?: true
  /** Оккупирована до конца этого мирового хода (номер). */
  occupied?: number
  /** Эмбарго исполнителю геноцида — пока не сменится власть. */
  embargo?: true
  /** После геноцида доход −1 до этого мирового хода включительно. */
  emptied?: number
  /** Общественный след: жетоны по каналам, чьи они (места игроков), легло ли что-то за этот мировой ход. */
  trace?: Record<string, number>
  traceWho?: Record<string, number[]>
  traceNew?: true
  /** Карты политики на стране: класс, прибавка к доходу, до какого мирового хода (не включая). */
  policies?: { title: string; channel: string; kind: 'уступка' | 'подавление'; cls: Cls; add: number; until: number }[]
}

/** Война на «Фронте». Метка — с края первой стороны: её +7 — «ПОБЕДА!» первой, −7 — второй. */
export interface War {
  n: number
  kind: 'местная' | 'мировая'
  /** Стороны: первая страна — ядро коалиции (её позиция и идеология — позиция и идеология стороны). */
  sides: [number[], number[]]
  mark: number
  /** Военная диктатура: первый бросок атаки ещё не сделан. */
  first: [boolean, boolean]
  /** «Священная война»: переброс за этот мировой ход ещё есть. */
  holy: [boolean, boolean]
  /** «Ни шагу назад!»: нечетов подряд у штурмующей стороны. */
  siege: [number, number]
  /** Атаки стороны (для преимущества в каждую вторую). */
  attacks: [number, number]
  rounds: number
  startWorldTurn: number
  /** Война только что объявлена: смена власти даёт мир лишь на d12 10–12. */
  declaring?: true
  /** Война решена: сторона-победитель или мир; итоги ещё не разыграны. */
  over?: 0 | 1 | 'мир'
  /** Итоги разыгрываются: повторный конец войны не начинается. */
  closing?: true
}

export interface World {
  countries: Country[]
  /** Отношения пар: ключ «меньший-больший» id. */
  relations: Record<string, Relation>
  /** Профили культур: 11 осей, −2…+2; минус — первый полюс оси. */
  cultures: Record<Culture, number[]>
}

// ── Игрок ───────────────────────────────────────────────────────────────

/** Карта предмета у игрока. */
export interface Held {
  /** Номер экземпляра в партии. */
  uid: number
  name: string
  /** Партнёр после свадьбы. */
  spouse?: true
  /** Воспитанник, а не родной ребёнок. */
  adopted?: true
  /** Партнёр и Супруг(а): класс, культура и раса человека. */
  person?: { cls: Cls; culture: Culture; race: Race }
  /** Сколько раз ещё можно сыграть. */
  uses?: number
  /** Малое дело выросло до среднего: карту перевернули. */
  grown?: true
  /** Бонус дела после роста (венчурная фирма: +2 или +3). */
  bonus?: number
  /** Откуда карта пришла (id карты события): цена в скупке может зависеть от этого. */
  origin?: string
  /** Ребёнок: прибавка к «Итогу воспитания» с карт (её прочтёт «Род»). */
  upbringing?: number
  /** Козырь без ячейки: можно сыграть до конца этого хода, потом карта уходит. */
  temp?: true
  /** Стигма: отрезок получения и особый срок угасания (в целых отрезках; 0 — гаснет через ход). */
  seg?: number
  decay?: number
}

/** Временная поправка к будущим проверкам (шаг `mod`). */
export interface TempMod {
  tag?: Tag
  fork?: string
  add?: number
  adv?: true
  dis?: true
  until: 'отрезок' | 'проверка' | 'вражда' | 'конец Молодости' | 'мировой ход'
  max?: 'отрезок'
  /** Отрезок, в конце которого поправка сгорает (для until «отрезок» и max «отрезок»). */
  seg?: number
}

/** Отложенный эффект (шаг `later`). */
export interface Later { when: (typeof LATER_EVENTS)[number]; then: Node[]; card?: string; seg?: number; /** Событие наступило: эффект ждёт ближайшей точки покоя. */ due?: true }

export interface Player {
  seat: number
  name: string
  gen: number
  alive: boolean
  /** Дошёл до «Финала». */
  finished: boolean
  death?: { seg: Seg; cause: string; round: number }

  sex: 'м' | 'ж'
  race: Race
  /** Родная культура. */
  culture: Culture
  /** Приёмная культура (бикультурность) и личный профиль. */
  culture2?: Culture
  ownProfile?: number[]
  birthCountry: number
  country: number
  citizenship: number[]

  /** Шкалы семьи −3…+3. */
  fin: number
  pos: number
  coh: number
  familyCls: Cls
  cls: Cls
  /** Значения при рождении или вступлении наследника. */
  start: { fin: number; pos: number; coh: number; cls: Cls }

  phys: number
  psy: number
  vozm: number
  stats: Record<Stat, number>
  predisp: Stat
  /** Характеристики с вскрытым грифом (потолок 12). */
  unsealed: Stat[]
  /** 7 осей характера, −2…+2; минус — первый полюс. */
  character: number[]

  /** Номер отрезка 0…5 и клетка в нём (с нуля). */
  seg: number
  cell: number
  turns: number
  skip: number

  stazh: number
  /** Стаж найма: без пустых отметок «Дела». */
  stazhHire: number
  donations: number

  items: Held[]
  inst?: {
    kind: InstKind; left: number; tag?: Tag; workoff?: number; turn: number; noStigma?: true
    /** Фронт: тактика этого хода, сторона, номер войны, отпуск по ранению, доброволец на чужой войне. */
    tactic?: 'атака' | 'держать' | 'беречь'; side?: 0 | 1; war?: number; leave?: true; foreign?: true
    /** Плен: страна, взявшая в плен, — карты «Тюрьмы» по её идеологии. */
    captor?: number
  }
  /** Подростковый срыв уже был. */
  teenBreak?: true

  meaning?: { id: string; from: 'рождение' | 'поиск' | 'династия' | 'отказ' | 'кризис' | 'серость' | 'наследник'; locked?: true; verdict: -1 | 0 | 1 }
  /** Пытается отказаться от предназначения Династии. */
  refusing?: true
  crisisDone?: true
  /** Условия «соб.», которые хоть раз выполнились: ключ — текст условия в JSON. */
  achieved: Record<string, true>
  /** Условия текущей карты смысла, за которые культура уже отозвалась. */
  approved: number[]
  happiness: number

  /** Журнал жизни: отметки, счётчики, посещения мест по отрезкам, снимки на входе в отрезок. */
  flags: Record<string, true>
  counters: Record<string, number>
  visits: Record<string, number[]>
  entry: Record<number, EntrySnap>

  mods: TempMod[]
  laters: Later[]
  /** Прибавки к доходу за ход. */
  income: { add: number; until: 'отрезок' | 'конец Молодости' | 'жизнь'; seg: number }[]
  pensionAdd: number
  /** Эффекты на входе в каждый отрезок до конца жизни (`everySeg`). */
  everySeg: Node[][]
  /** Платежи по подсекторам (`installments`). */
  installments: { left: number; each: Node[] }[]
  /** Древность: ходы без потери физ. */
  noAging: number
  /** Жетоны ◆ Рынка молодости: три на входе в Молодость, сгорают на выходе. */
  youthTokens: number
  /** Особые правила, действующие на игрока: имя → значение и отрезок, в конце которого гаснет. */
  rules: Record<string, { arg?: string; seg?: number }>
}

/** Снимок игрока на входе в отрезок — для условий «войти в Старость в браке». */
export interface EntrySnap {
  phys: number; psy: number; vozm: number; cls: Cls; fin: number; pos: number; coh: number
  stats: Record<Stat, number>; items: string[]; spouse: boolean; stazh: number; country: number
}

// ── Партия ──────────────────────────────────────────────────────────────

export interface SeatConfig { name: string; ai?: string }
export interface GameConfig {
  span: Span
  start?: Start
  seats: SeatConfig[]
  seed: number
  rounds?: number
  keepLog?: boolean
  /** Старое имя режима (сохранения до 20.11): «поколение» → one, «род» → lineage. */
  mode?: 'поколение' | 'род'
}

export interface GameState {
  version: 1
  config: GameConfig
  rng: [number, number, number, number]
  phase: 'подготовка' | 'игра' | 'конец'
  /** Сыгранные круги и мировые ходы. */
  round: number
  worldTurns: number
  /** Чей ход (место за столом). */
  current: number
  /** Круг замкнулся на мировом ходе: он идёт следующим шагом. */
  worldDue?: true
  /** Круг замкнулся во время войны: хранитель часов бросает за стороны без солдат-игроков. */
  frontDue?: true
  /** Идёт война (одна на мир) и сколько войн было за партию. */
  war?: War
  wars?: number
  /** «Летопись эпохи»: заголовки карт политики и другие события мира. */
  chronicle?: { worldTurn: number; country: number; text: string }[]
  /** Счётчики партии: войны, итоги, броски хранителя — для сверки с симуляцией. */
  stats?: Record<string, number>
  world: World
  /** Стопки: id стопки → id карт, верхняя первая. */
  piles: Record<string, string[]>
  players: Player[]
  /** Прожитые жизни (режим «Род» и итог). */
  graves: Player[]
  log: LogEvent[]
  /** Счётчик экземпляров предметов и вопросов. */
  uid: number
  asked: number
  /** Особые правила этапа 3, которые встретились и ещё не написаны. */
  todo: Record<string, number>
}

// ── Вопросы и журнал ────────────────────────────────────────────────────

/** Вариант ответа. `effect` — шаги, к которым он ведёт (для ИИ; интерфейсу не нужны). */
export interface Option {
  id: string; label: string; note?: string; off?: string; effect?: Node[]
  /** Проверка в этом варианте: что игрок видит до выбора (характеристика, сложность, поправки, шанс). */
  check?: import('./checks.ts').CheckPreview
}

/** Вопрос к игроку: выбери один вариант. */
export interface Request {
  n: number
  player: number
  /** Что за решение: по нему ИИ и интерфейс понимают смысл вопроса. */
  type:
    | 'ход' | 'карта' | 'характеристика' | 'козырь' | 'отмена' | 'класс' | 'сброс' | 'предмет'
    | 'смысл' | 'действие' | 'проверка' | 'кризис' | 'эмиграция' | 'фронт'
  text: string
  card?: string
  options: Option[]
}

export type LogEvent =
  | { t: 'ход'; p: number; round: number }
  | { t: 'бросок'; p: number; die: number; value: number; why: string }
  | { t: 'клетка'; p: number; seg: Seg; n?: number; type: string }
  | { t: 'карта'; p: number; id: string; title: string; deck: string }
  | { t: 'пропуск'; p: number; id: string; why: string }
  | { t: 'проверка'; p: number; stat: Stat; dice: number[]; kept: number; value: number; mod: number; trump: number; dc: number; ok: boolean; auto?: true; adv: number; what?: string }
  | { t: 'число'; p: number; param: string; from: number; to: number; delta: number }
  | { t: 'предмет'; p: number; name: string; how: 'получен' | 'потерян' | 'сыгран' | 'свадьба' }
  | { t: 'выбор'; p: number; label: string }
  | { t: 'текст'; p: number; text: string }
  | { t: 'отрезок'; p: number; seg: Seg }
  | { t: 'класс'; p: number; from: Cls; to: Cls }
  | { t: 'характер'; p: number; pole: CharPole; value: number }
  | { t: 'институт'; p: number; kind: InstKind; how: 'вход' | 'выход'; turns?: number }
  | { t: 'смысл'; p: number; id: string; from: string }
  | { t: 'счастье'; p: number; from: number; to: number }
  | { t: 'смерть'; p: number; cause: string }
  | { t: 'финал'; p: number }
  | { t: 'мир'; text: string }
  | { t: 'фронт'; text: string; mark?: number; p?: number }
  | { t: 'этап3'; p: number; rule: string }

export interface SaveFile { version: 1; base: string; answers: string[] }
