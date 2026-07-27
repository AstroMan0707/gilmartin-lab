import type { ParsedSession } from '../types'
import { buildTrials, markerBlock } from './buildTrials'
import { parseSessionXml } from './parseSessionXml'

/**
 * Join key for animal identifiers.
 *
 * The XML writes `LZ039` while Rat Info.xlsx writes `LZ 084` — and inconsistently even
 * within itself, since one of the 48 rows is `LZ127` with no space. Stripping all
 * whitespace and upper-casing is what makes the two sources meet.
 */
export function normalizeAnimalId(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

/** 'female' / 'F' / 'f' -> 'F'. Unrecognised values return null rather than guessing. */
export function normalizeSex(raw: string | null | undefined): 'F' | 'M' | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (s === 'f' || s === 'female') return 'F'
  if (s === 'm' || s === 'male') return 'M'
  return null
}

/**
 * Parses ABET's `Test Day` field, which is US-style `M/D/YYYY`.
 *
 * `new Date(string)` is not used because its handling of `7/14/2026` is
 * implementation-defined, and a silent off-by-one in the date would silently reorder
 * every subject's session numbering.
 */
export function parseTestDay(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const trimmed = raw.trim()

  const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(trimmed)
  if (usDate) {
    const [, m, d, y] = usDate
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }

  // `Schedule_Start_Time` style: 2026-07-14T10:39:36.445
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (iso) {
    const [, y, m, d] = iso
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }

  return null
}

/**
 * The delay condition exists nowhere in the XML except the schedule name, e.g.
 * "Rat TUNL Full v2 0s" vs "Rat TUNL Full v2 20s". It is a primary independent variable,
 * so it has to be recovered from the string.
 */
export function parseDelaySec(scheduleName: string): number | null {
  const m = /(\d+)\s*s(?:ec)?\s*$/i.exec(scheduleName.trim())
  return m ? Number(m[1]) : null
}

/**
 * Parses one session XML into the app's canonical form: trials with time-aligned
 * latencies, session-level End Summary values, and the identifying fields needed to join
 * subject metadata and order sessions over time.
 */
export function parseSession(fileName: string, xmlText: string): ParsedSession {
  const parsed = parseSessionXml(xmlText)
  const { trials, columnOrder, warnings, structure } = buildTrials(parsed)
  const info = parsed.sessionInfo

  // Session-level markers: every block other than the trial block. In the known
  // schedules that is exactly "End Summary".
  const endSummary: Record<string, number | null> = {}
  const endSummaryOrder: string[] = []
  for (const s of parsed.series.values()) {
    if (structure.trialBlock && markerBlock(s.name) === structure.trialBlock) continue
    endSummaryOrder.push(s.name)
    // Session-level markers emit once; an absent value means zero, as for trial counters.
    endSummary[s.name] = s.entries[0]?.value ?? 0
  }

  const animalIdRaw = info.get('Animal ID')?.trim() ?? ''
  const scheduleName = info.get('Schedule Name')?.trim() ?? ''

  return {
    fileName,
    sessionInfo: info,
    animalIdRaw,
    animalId: normalizeAnimalId(animalIdRaw),
    testDay: parseTestDay(info.get('Test Day')) ?? parseTestDay(info.get('Schedule_Start_Time')),
    scheduleName,
    delaySec: parseDelaySec(scheduleName),
    chamber: info.get('Environment')?.trim() ?? '',
    sexXml: normalizeSex(info.get('Sex')),
    scheduleRunId: info.get('Schedule Run ID')?.trim() ?? '',
    endSummary,
    endSummaryOrder,
    trialColumnOrder: columnOrder,
    trials,
    alignmentWarnings: warnings,
  }
}
