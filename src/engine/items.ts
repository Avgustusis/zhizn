/**
 * Этап 3г: особые свойства предметов, которые раньше были только текстом (каталог предметов, «Верхи», «Дно», «Знакомые»).
 * Здесь — пассивные свойства: срабатывают сами в своих точках партии. Розыгрыши «в любой момент» — в tricks.ts.
 * Опись всех свойств и их статус — docs/ITEM-RULES.md.
 */
import { CULTURES } from '../data/schema.ts'
import { countryOf, pick, say, type Flow, type G } from './core.ts'
import { has, held, kindOf, newCtx } from './cond.ts'
import { addParam, count, dropHeld, gainItem, removeHeld, rollDie } from './change.ts'
import type { Cls, Country, Held, Player } from './types.ts'

const T = (g: G) => g.c.tables.itemRules

/** Получена карта: «Ревнивый» и новый Друг; «Друг из другой культуры» — запомнить культуру друга. */
export function* afterGain(g: G, p: Player, h: Held): Flow {
  const item = g.items.get(h.name)
  if (!item) return
  if (item.group === 'Друг' && has(g, p, 'Ревнивый') && rollDie(g, p, 6, '«Ревнивый»: сцена на 1–2') <= 2) {
    say(g, p, '«Ревнивый»: сцена из-за нового друга')
    addParam(g, p, 'псих', -2, newCtx('правило'))
  }
  if (h.name === 'Должник') p.counters[`должник:${h.uid}`] = p.seg
  if (h.name === 'Друг из другой культуры' && !h.person) {
    const others = CULTURES.filter((k) => k !== p.culture && k !== p.culture2)
    h.person = { cls: p.cls, culture: pick(g, others), race: p.race }
    say(g, p, `друг из культуры «${h.person.culture}»`)
  }
}

/**
 * Класс сменился (вызывается из setClass, без вопросов): «Карьерист» уходит, если класс упал (d6 1–3, обычная цена
 * расставания или развода); с Наставником — +1 к первой проверке на новой работе.
 */
export function afterClass(g: G, p: Player, from: Cls, to: Cls): void {
  const ladder = g.c.tables.work.ladder
  mentorStart(g, p, 'новая работа')
  if (ladder[to] >= ladder[from]) return
  const h = p.items.find((x) => x.name === 'Карьерист')
  if (h && rollDie(g, p, 6, '«Карьерист»: класс упал — уходит на 1–3') <= 3) {
    say(g, p, '«Карьерист» уходит: класс упал')
    // У партнёра и супруга цена ухода — только числа, вопросов нет: генератор проходит до конца сразу.
    const flow = dropHeld(g, p, h, true)
    for (let r = flow.next(); !r.done; r = flow.next()) throw new Error('«Карьерист»: неожиданный вопрос')
  }
}

/** Сыграна карта события: #закон и «С тёмным прошлым» — d6 1, стигма «Враг». */
export function* afterCard(g: G, p: Player, tags: string[]): Flow {
  if (tags.includes('#закон') && has(g, p, 'С тёмным прошлым') && rollDie(g, p, 6, '«С тёмным прошлым»: «Враг» на 1') === 1) {
    say(g, p, 'прошлое партнёра пришло за тобой')
    yield* gainItem(g, p, 'Враг')
  }
}

/** Вход в отрезок: дети, «Должник», «Имя в искусстве» в диктатурах. */
export function* atSegment(g: G, p: Player): Flow {
  const c = countryOf(g, p)
  const ctx = newCtx('правило')
  for (const h of [...p.items]) {
    if (!p.alive) return
    if (h.name === 'Болезненный' && c.pos === 'периферия' && rollDie(g, p, 6, '«Болезненный»: на периферии утрата на 1') === 1) {
      say(g, p, 'утрата: больной ребёнок не выжил')
      count(p, 'утрата')
      yield* dropHeld(g, p, h, true, true)
    }
    if (h.name === 'Трудный' && p.seg === 4) {
      const r = rollDie(g, p, 6, '«Трудный»: при входе в Старость')
      if (r >= 4) {
        say(g, p, 'с трудным ребёнком всё наладилось: он теперь «Тихий»')
        addParam(g, p, 'псих', 3, ctx)
        removeHeld(g, p, h)
        yield* gainItem(g, p, 'Тихий')
      } else yield* gainItem(g, p, 'Дурная слава')
    }
    // «Должник»: долг не стребован до конца отрезка — d6 1–2, исчез вместе с долгом.
    if (h.name === 'Должник' && (p.counters[`должник:${h.uid}`] ?? p.seg) < p.seg && rollDie(g, p, 6, '«Должник» исчезает на 1–2') <= 2) {
      say(g, p, '«Должник» исчез вместе с долгом')
      removeHeld(g, p, h)
    }
    if (h.name === 'Имя в искусстве' && T(g).artDanger.includes(c.ideology) && rollDie(g, p, 6, '«Имя в искусстве»: «не та песня» на 1') === 1) {
      say(g, p, '«не та песня»')
      yield* gainItem(g, p, 'Враг')
    }
  }
}

/** Смена власти: «Партбилет» на d6 1–3 становится «Дурной славой»; Покровитель проигравшей стороны уходит (d6 1–2 — ещё «Враг»). */
export function* atPowerChange(g: G, p: Player, c: Country, oldDom: Cls): Flow {
  for (const h of held(g, p, 'Партбилет')) {
    if (rollDie(g, p, 6, '«Партбилет» при смене власти: на 1–3 — «Дурная слава»') <= 3) {
      say(g, p, '«Партбилет» теперь — пятно в биографии')
      removeHeld(g, p, h)
      yield* gainItem(g, p, 'Дурная слава')
    }
  }
  for (const h of p.items.filter((x) => g.items.get(x.name)?.group === 'Покровитель')) {
    const side = T(g).patronSide[h.name]
    // Сторона покровителя — власть (её класс правил до смены): власть сменилась — покровитель проиграл.
    if (side !== 'власть' && side !== oldDom) continue
    say(g, p, `«${h.name}»: сторона покровителя проиграла — связь потеряна`)
    removeHeld(g, p, h)
    if (rollDie(g, p, 6, 'обида покровителя: «Враг» на 1–2') <= 2) yield* gainItem(g, p, 'Враг')
  }
  void c
}

/** Новое место: с Наставником +1 к первой проверке на новой работе или в новой стране. */
export function mentorStart(g: G, p: Player, why: string): void {
  if (!p.items.some((h) => T(g).mentors.includes(h.name))) return
  p.mods.push({ add: 1, until: 'проверка', seg: p.seg })
  say(g, p, `Наставник: +1 к первой проверке (${why})`)
}

/** Возвращение на родину с «Другом детства» — +2 псих.; переезд в страну культуры «Друга из другой культуры» — аккультурация с шага 1. */
export function onArrive(g: G, p: Player, back: boolean): void {
  if (back && has(g, p, 'Друг детства')) { say(g, p, 'дома ждёт друг детства'); addParam(g, p, 'псих', 2, newCtx('правило')) }
  const friend = p.items.find((h) => h.name === 'Друг из другой культуры')
  if (!back && friend?.person && countryOf(g, p).mainCultures.includes(friend.person.culture)) {
    p.counters['аккультурация'] = Math.max(1, p.counters['аккультурация'] ?? 0)
    say(g, p, 'друг из этой культуры: аккультурация с шага 1')
  }
}

/** Пенсия: «Мастер цеха» — Стаж 5 даёт пенсию как Стаж 7. */
export const pensionStazh = (g: G, p: Player): number => (has(g, p, 'Мастер цеха') && p.stazhHire >= 5 ? Math.max(p.stazhHire, 7) : p.stazhHire)

/** Эпидемия в стране: «Фильтр-бочка» — потеря физ. на 1 мягче. */
export const epidemicSoft = (g: G, p: Player, card?: string): number => (card && T(g).epidemics.includes(card) && has(g, p, 'Фильтр-бочка Олан') ? 1 : 0)

/** Вещь в постоянном пользовании (для подсказок). */
export const owns = (g: G, p: Player, name: string): boolean => p.items.some((h) => h.name === name && kindOf(g, h) === 'вещь')
