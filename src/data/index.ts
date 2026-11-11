/** Все колоды карт, собранные из src/data/decks/*.json. */
import { DECKS, DeckFile, type Card, type DeckId } from './schema.ts'

const files = import.meta.glob<{ default: unknown }>('./decks/*.json', { eager: true })

const ORDER = Object.keys(DECKS)

/** Колоды в порядке документа колод: Детство, Юность, … , институты. */
export const decks: DeckFile[] = Object.values(files)
  .map((m) => DeckFile.parse(m.default))
  .sort((a, b) => ORDER.indexOf(a.deck) - ORDER.indexOf(b.deck))
export const deckById = new Map<DeckId, DeckFile>(decks.map((d) => [d.deck, d]))
export const allCards: Card[] = decks.flatMap((d) => d.cards)
