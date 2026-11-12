/** Предметы: каталог, своё дело, «Верхи», «Дно» и отметка «Привычка» (src/data/items.json). */
import raw from './items.json' with { type: 'json' }
import { ItemsFile, type Item } from './schema.ts'

export const items: Item[] = ItemsFile.parse(raw).items
export const itemByName = new Map(items.map((i) => [i.name, i]))

/**
 * Имена, которыми карты называют предметы: имя карты или имя стопки людей
 * («Друг» — любая карта стопки, получить — вслепую). «Супруг(а)» — та же карта, что «Партнёр», после свадьбы.
 */
export const itemNames = new Set<string>([...items.map((i) => i.name), ...items.flatMap((i) => (i.group ? [i.group] : [])), 'Супруг(а)'])
