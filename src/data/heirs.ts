/** Стандартные наследники режима «Род»: по два на класс (src/data/heirs.json). */
import raw from './heirs.json' with { type: 'json' }
import { HeirsFile, type Heir } from './schema.ts'

export const heirs: Heir[] = HeirsFile.parse(raw).heirs
