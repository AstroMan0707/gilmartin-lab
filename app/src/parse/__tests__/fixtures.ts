import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** The lab's real ABET exports, kept outside the app so they stay the canonical samples. */
export const FIXTURE_DIR = join(here, '../../../../tunl-parser/example-files')

export function readFixture(name: string): string {
  // ABET writes a UTF-8 BOM; strip it so the first tag / first header parses cleanly.
  return readFileSync(join(FIXTURE_DIR, name), 'utf8').replace(/^﻿/, '')
}

/** The three XML/CSV pairs ABET produced from the same sessions. */
export const FIXTURE_PAIRS = [
  { xml: 'example-input_1.xml', csv: 'example-output_1.csv', animalId: 'LZ039', trials: 99 },
  { xml: 'example-output_2.xml', csv: 'example-output_2.csv', animalId: 'LZ041', trials: 86 },
  { xml: 'example-output_3.xml', csv: 'example-output_3.csv', animalId: 'LZ122', trials: 31 },
] as const

/** Minimal RFC4180 CSV reader: quoted fields with doubled quotes, no embedded newlines. */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l !== '')
  const parseLine = (line: string): string[] => {
    const out: string[] = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            field += '"'
            i++
          } else inQuotes = false
        } else field += c
      } else if (c === '"') inQuotes = true
      else if (c === ',') {
        out.push(field)
        field = ''
      } else field += c
    }
    out.push(field)
    return out
  }
  const [head, ...rest] = lines
  return { header: parseLine(head), rows: rest.map(parseLine) }
}
