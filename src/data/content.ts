/**
 * Всё содержание игры одним объектом для движка.
 * Файлы подключены поимённо, без `import.meta.glob`: так содержание читается и в браузере, и в Node (симуляции).
 */
import type { Content } from '../engine/types.ts'
import { Board } from './board-schema.ts'
import { DeckFile, HeirsFile, ItemsFile, MeaningsFile } from './schema.ts'
import { tables } from './tables.ts'
import board from './board.json' with { type: 'json' }
import heirs from './heirs.json' with { type: 'json' }
import items from './items.json' with { type: 'json' }
import meanings from './meanings.json' with { type: 'json' }
import ageAncient from './decks/age-ancient.json' with { type: 'json' }
import ageChildhood from './decks/age-childhood.json' with { type: 'json' }
import ageMature from './decks/age-mature.json' with { type: 'json' }
import ageOld from './decks/age-old.json' with { type: 'json' }
import ageYoung from './decks/age-young.json' with { type: 'json' }
import ageYouth from './decks/age-youth.json' with { type: 'json' }
import asylum from './decks/asylum.json' with { type: 'json' }
import bondage from './decks/bondage.json' with { type: 'json' }
import cls from './decks/class.json' with { type: 'json' }
import country from './decks/country.json' with { type: 'json' }
import culture from './decks/culture.json' with { type: 'json' }
import fate from './decks/fate.json' with { type: 'json' }
import forks from './decks/forks.json' with { type: 'json' }
import prison from './decks/prison.json' with { type: 'json' }
import relations from './decks/relations.json' with { type: 'json' }
import turmoil from './decks/turmoil.json' with { type: 'json' }
import world from './decks/world.json' with { type: 'json' }

const files = [ageChildhood, ageYouth, ageYoung, ageMature, ageOld, ageAncient, relations, culture, country, cls, fate, forks, turmoil, world, prison, asylum, bondage]
  .map((f) => DeckFile.parse(f))

/** Собрать содержание. Проверка схемой — один раз при загрузке. */
export function loadContent(): Content {
  return {
    decks: Object.fromEntries(files.map((f) => [f.deck, f.cards])),
    polar: files.filter((f) => f.polar).map((f) => f.deck),
    subCodes: Object.fromEntries(files.filter((f) => f.sub).map((f) => [f.deck, Object.keys(f.sub!)])),
    items: ItemsFile.parse(items).items,
    meanings: MeaningsFile.parse(meanings).meanings,
    heirs: HeirsFile.parse(heirs).heirs,
    board: Board.parse(board),
    actions: [],
    buildings: [],
    tables,
  }
}
