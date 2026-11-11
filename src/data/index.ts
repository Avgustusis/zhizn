/** Все колоды карт, собранные из src/data/decks/*.json. */
import { DeckFile, type Card, type DeckId } from './schema.ts'

const files = import.meta.glob<{ default: unknown }>('./decks/*.json', { eager: true })

export const decks: DeckFile[] = Object.values(files).map((m) => DeckFile.parse(m.default))
export const deckById = new Map<DeckId, DeckFile>(decks.map((d) => [d.deck, d]))
export const allCards: Card[] = decks.flatMap((d) => d.cards)
