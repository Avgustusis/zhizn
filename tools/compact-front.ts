/** Проверить src/data/front.json схемой и записать в читаемом сжатом виде (после tools/build-front.py). */
import { readFileSync, writeFileSync } from 'node:fs'
import { FrontFile } from '../src/data/schema.ts'
import { compactJson } from './json-compact.ts'

const data = FrontFile.parse(JSON.parse(readFileSync('src/data/front.json', 'utf8')))
writeFileSync('src/data/front.json', compactJson(data) + '\n')
console.log(`фронт: схема пройдена, ${data.events.length} событий`)
