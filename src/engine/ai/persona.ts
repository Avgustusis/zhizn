/**
 * Характер ИИ (решено 23.11): решения следуют той же таблице характера, что у игрока, — 7 черт от −2 до +2.
 * Архетип — заданный характер с именем-словом из другого языка, означающим манеру поведения. В «Были» архетип
 * тянет решения ИИ в свою сторону вместе с чертами, которые жизнь уже дала; в «Сказке» по нему собирают героя ИИ.
 */
import { CHAR_AXES } from '../../data/schema.ts'
import type { Player } from '../types.ts'
import type { W } from './goal.ts'

export interface Archetype {
  id: string
  /** Имя на экране и в псевдониме: «№ 522040711345 «Савант»». */
  name: string
  /** Язык и значение слова. */
  lang: string
  meaning: string
  /** 7 осей, как Player.character: минус — первый полюс (Самолюбие, Хватка, Влюбчивость, Соперничество, Аппетит, Вспыльчивость, Беспечность). */
  character: number[]
}

//                                         Самол./Скром. Хватка/Щедр. Влюбч./Верн. Сопер./Участ. Аппет./Мера Вспыл./Выдер. Беспеч./Усерд.
export const ARCHETYPES: Archetype[] = [
  { id: 'савант', name: 'Савант', lang: 'франц. savant', meaning: 'учёный: знание дороже денег', character: [1, 0, 0, 0, 1, 1, 2] },
  { id: 'бонвиван', name: 'Бонвиван', lang: 'франц. bon vivant', meaning: 'живёт в своё удовольствие', character: [0, 1, -1, 0, -2, 0, -1] },
  { id: 'хуцпа', name: 'Хуцпа', lang: 'иврит chutzpah', meaning: 'дерзость без оглядки', character: [-2, -1, 0, -2, 0, -1, 0] },
  { id: 'менш', name: 'Менш', lang: 'идиш mensch', meaning: 'порядочный человек, на которого можно опереться', character: [1, 1, 1, 2, 0, 0, 0] },
  { id: 'сису', name: 'Сису', lang: 'финск. sisu', meaning: 'упорство, которое не сдаётся', character: [0, 0, 1, 0, 1, 2, 1] },
  { id: 'убунту', name: 'Убунту', lang: 'зулу ubuntu', meaning: 'я есть, потому что есть мы', character: [1, 2, 0, 2, 0, 0, 0] },
  { id: 'мачо', name: 'Мачо', lang: 'исп. macho', meaning: 'сила, гордость, вспыльчивость', character: [-2, 0, -1, -1, 0, -2, 0] },
  { id: 'хюгге', name: 'Хюгге', lang: 'датск. hygge', meaning: 'уют и свои рядом', character: [0, 0, 2, 1, 2, 0, 0] },
  { id: 'гешефт', name: 'Гешефт', lang: 'идиш/нем. Geschäft', meaning: 'делец: всё — сделка', character: [-1, -2, 0, -1, 0, 0, 1] },
  { id: 'стоик', name: 'Стоик', lang: 'греч. stōikos', meaning: 'спокойствие и мера во всём', character: [1, 0, 0, 0, 2, 2, 0] },
  { id: 'фланёр', name: 'Фланёр', lang: 'франц. flâneur', meaning: 'праздный гуляка, смотрит на жизнь со стороны', character: [0, 0, -1, 0, -1, 0, -2] },
  { id: 'ронин', name: 'Ронин', lang: 'япон. rōnin', meaning: 'сам по себе: без господина и без стаи', character: [1, -1, 0, -2, 0, 1, 0] },
]

export const archetypeOf = (id: string | undefined): Archetype | undefined => ARCHETYPES.find((a) => a.id === id)

/** Черта сейчас: жизнь (Player.character) плюс половина архетипа; −2…+2. */
function traits(p: Player, a?: Archetype): number[] {
  return CHAR_AXES.map((_, i) => Math.max(-2, Math.min(2, (p.character[i] ?? 0) + (a ? a.character[i] / 2 : 0))))
}

export type Taste = Partial<typeof W> & { phys?: number; psy?: number; vozm?: number }

/**
 * Поправки характера к оценке положения (goal.ts: outlook). Плюс — второй полюс, минус — первый:
 * Самолюбие ценит класс и статусы, Скромность — меньше; Хватка ценит деньги, Щедрость — связи; Влюбчивость — партнёра,
 * Верность — брак; Соперничество — класс, Участие — связи; Аппетит — психику (удовольствия), Мера — здоровье;
 * Вспыльчивость меньше боится тюрьмы и стигм, Выдержка — больше; Беспечность меньше бережёт здоровье, Усердие ценит рост.
 */
export function tasteOf(p: Player, a?: Archetype): Taste {
  const [ego, grip, love, rival, appetite, temper, care] = traits(p, a)
  return {
    cls: 1.5 * (1 - 0.2 * ego) * (1 - 0.15 * rival),
    status: 1.5 * (1 - 0.2 * ego),
    vozm: 1 - 0.15 * grip,
    link: 1.2 * (1 + 0.15 * grip) * (1 + 0.15 * rival),
    partner: 2 * (1 - 0.2 * love),
    spouse: 5 * (1 + 0.15 * love),
    psy: 1 - 0.1 * appetite,
    phys: (1 + 0.1 * appetite) * (1 + 0.15 * care),
    stigma: 2.5 * (1 + 0.2 * temper),
    inst: 4 * (1 + 0.15 * temper),
    stat: 0.8 * (1 + 0.2 * care),
  }
}

/** Склонности на рынке: пороки (Аппетит), помощь (Щедрость, Участие), риск (Вспыльчивость), лечение (Беспечность — реже). */
export function leanings(p: Player, a?: Archetype): { vice: number; help: number; risk: number; care: number } {
  const t = traits(p, a)
  return { vice: Math.max(0, -t[4]), help: Math.max(0, t[1]) + Math.max(0, t[3]), risk: Math.max(0, -t[5]), care: t[6] }
}

/** Случайный псевдоним, как номер в Бюро: «№ 522040711345 «Савант»». rand — генератор экрана, не движка. */
export function bureauName(rand: () => number = Math.random): string {
  const digits = Array.from({ length: 12 }, (_, i) => (i === 0 ? 1 + Math.floor(rand() * 9) : Math.floor(rand() * 10))).join('')
  return `№ ${digits} «${ARCHETYPES[Math.floor(rand() * ARCHETYPES.length)].name}»`
}
