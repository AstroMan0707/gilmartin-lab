import type { ParsedSession } from '../types'

export type Cell = number | string | null

export interface FlatTable {
  columns: string[]
  rows: Cell[][]
  /** Parallel to `rows`: which session each row came from, for joining metadata. */
  rowSession: ParsedSession[]
}

/**
 * Builds the flat, one-row-per-trial-attempt table in ABET's own column layout:
 *
 *   [session information] [End Summary - *] [Trial Analysis - *]
 *
 * Session information repeats on every row of a session. End Summary values appear only
 * on the session's first row and are blank thereafter — that is what ABET does, and
 * repeating them would make every session-level mean weight by trial count.
 *
 * Session-information keys that are empty in every session are dropped. That is how the
 * reference CSV comes to omit `Guid`, which ABET always exports as an empty element; the
 * rule is preferable to hardcoding the key name because it also drops whatever other
 * fields a given schedule leaves blank.
 */
export function buildFlatTable(sessions: ParsedSession[]): FlatTable {
  if (sessions.length === 0) return { columns: [], rows: [], rowSession: [] }

  // --- Session-information columns: document order, union across sessions ------------
  const infoKeys: string[] = []
  const nonEmpty = new Set<string>()
  for (const s of sessions) {
    for (const { name, value } of s.sessionInfo.ordered) {
      if (!infoKeys.includes(name)) infoKeys.push(name)
      if (value !== '') nonEmpty.add(name)
    }
  }
  const infoColumns = infoKeys.filter((k) => nonEmpty.has(k))

  // --- Marker columns: document order, union across sessions -------------------------
  const summaryColumns: string[] = []
  const trialColumns: string[] = []
  for (const s of sessions) {
    for (const name of s.endSummaryOrder) {
      if (!summaryColumns.includes(name)) summaryColumns.push(name)
    }
    for (const name of s.trialColumnOrder) {
      if (!trialColumns.includes(name)) trialColumns.push(name)
    }
  }

  const columns = [...infoColumns, ...summaryColumns, ...trialColumns]
  const rows: Cell[][] = []
  const rowSession: ParsedSession[] = []

  for (const s of sessions) {
    // A session with no trials still deserves a row, so its End Summary is not lost.
    const trialCount = Math.max(s.trials.length, 1)
    for (let i = 0; i < trialCount; i++) {
      const trial = s.trials[i]
      const row: Cell[] = []

      for (const key of infoColumns) row.push(s.sessionInfo.get(key) ?? null)
      for (const key of summaryColumns) row.push(i === 0 ? (s.endSummary[key] ?? null) : null)
      for (const key of trialColumns) row.push(trial ? (trial.values[key] ?? null) : null)

      rows.push(row)
      rowSession.push(s)
    }
  }

  return { columns, rows, rowSession }
}
