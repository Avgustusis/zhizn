/** Карты смысла жизни: Серость, 70 Случайных, 30 Династий (src/data/meanings.json). */
import raw from './meanings.json' with { type: 'json' }
import { MeaningsFile, type Meaning } from './schema.ts'

export const meanings: Meaning[] = MeaningsFile.parse(raw).meanings
export const grey: Meaning = meanings.find((m) => m.deck === 'Серость')!
