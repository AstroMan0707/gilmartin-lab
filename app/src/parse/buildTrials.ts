import type {
  AlignmentWarning,
  MarkerSeries,
  ParsedSessionXml,
  TrialRow,
} from '../types'
import { isMeasureSeries } from './parseSessionXml'

/** Column suffixes ABET uses when flattening a `Measure` marker into a spreadsheet. */
export const DURATION_SUFFIX = '_Duration'
export const COUNTS_SUFFIX = '_Counts'

/** The leading segment of a marker name, e.g. "Trial Analysis" or "End Summary". */
export function markerBlock(name: string): string {
  const i = name.indexOf(' - ')
  return i === -1 ? name : name.slice(0, i)
}

export interface TrialStructure {
  /** The marker block that varies per trial, e.g. "Trial Analysis". */
  trialBlock: string | null
  /** Blocks emitted once per session, e.g. ["End Summary"]. */
  sessionBlocks: string[]
  trialCount: number
}

/**
 * Works out which marker block describes trials, without hardcoding "Trial Analysis".
 *
 * Session-level blocks emit each marker exactly once; the trial block emits each marker
 * once per attempt. So the block containing the longest series is the trial block. This
 * keeps the parser working if a schedule renames its blocks, which matters because the
 * lab runs several schedule variants.
 */
export function detectTrialStructure(series: Map<string, MarkerSeries>): TrialStructure {
  const maxByBlock = new Map<string, number>()
  for (const s of series.values()) {
    const block = markerBlock(s.name)
    maxByBlock.set(block, Math.max(maxByBlock.get(block) ?? 0, s.entries.length))
  }

  let trialBlock: string | null = null
  let best = 1
  for (const [block, max] of maxByBlock) {
    if (max > best) {
      best = max
      trialBlock = block
    }
  }

  const sessionBlocks = [...maxByBlock.keys()].filter((b) => b !== trialBlock)
  return { trialBlock, sessionBlocks, trialCount: trialBlock ? best : 0 }
}

/**
 * Index of the first element of `sortedEnds` that is >= `t`, or `sortedEnds.length` if
 * none is. Standard lower-bound binary search.
 */
function lowerBound(sortedEnds: number[], t: number): number {
  let lo = 0
  let hi = sortedEnds.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sortedEnds[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface BuiltTrials {
  trials: TrialRow[]
  /** Trial-level export columns in document order, `Measure` markers already expanded. */
  columnOrder: string[]
  warnings: AlignmentWarning[]
  structure: TrialStructure
}

/**
 * Builds one row per trial attempt, attributing each timed `Measure` event to the trial
 * it actually occurred in.
 *
 * This is the correctness fix at the heart of the app. ABET's own CSV export packs the
 * latency columns positionally — the first reward latency into row 1, the second into
 * row 2 — but a reward latency only exists for trials that earned a reward, so in a
 * session with 99 attempts and 67 rewards every latency after the first miss sits in the
 * wrong row, and the last 32 rows are blank. The `<Time>` field on each Measure marker
 * says when the event happened, and `Trial Analysis - Condition` gives each trial's end
 * timestamp, so an event belongs to the first trial that had not yet ended when it fired.
 *
 * Per-trial Evaluation/Count markers need no such treatment: ABET emits them once per
 * attempt whether or not anything happened, so they are already index-aligned. For those,
 * an absent value means zero (the rat made no blank touches). For Measure markers an
 * absent value means the event did not occur, which stays `null` — recording it as 0 s
 * would drag every latency mean towards zero.
 */
export function buildTrials(parsed: ParsedSessionXml): BuiltTrials {
  const structure = detectTrialStructure(parsed.series)
  const warnings: AlignmentWarning[] = []

  if (!structure.trialBlock || structure.trialCount === 0) {
    return { trials: [], columnOrder: [], warnings, structure }
  }

  const trialSeries: MarkerSeries[] = []
  for (const s of parsed.series.values()) {
    if (markerBlock(s.name) === structure.trialBlock) trialSeries.push(s)
  }

  // `Condition` is the trial-end timestamp in seconds and defines the trial windows.
  const conditionName = `${structure.trialBlock} - Condition`
  const conditionSeries = parsed.series.get(conditionName)
  const n = structure.trialCount

  const endSec: number[] = new Array(n).fill(Number.NaN)
  if (conditionSeries) {
    for (let i = 0; i < Math.min(n, conditionSeries.entries.length); i++) {
      endSec[i] = conditionSeries.entries[i].value ?? Number.NaN
    }
  }

  // Sort trial ends so the binary search is valid even if a schedule emits them out of
  // order. In every file we have seen they are already ascending, so this is a no-op.
  const orderByEnd = Array.from({ length: n }, (_, i) => i)
    .filter((i) => Number.isFinite(endSec[i]))
    .sort((a, b) => endSec[a] - endSec[b])
  const sortedEnds = orderByEnd.map((i) => endSec[i])

  // --- Column order, mirroring ABET's own flattening --------------------------------
  const columnOrder: string[] = []
  for (const s of trialSeries) {
    if (isMeasureSeries(s)) {
      columnOrder.push(`${s.name}${DURATION_SUFFIX}`, `${s.name}${COUNTS_SUFFIX}`)
    } else {
      columnOrder.push(s.name)
    }
  }

  // --- Per-trial values -------------------------------------------------------------
  const values: Record<string, (number | null)[]> = {}
  for (const col of columnOrder) values[col] = new Array(n).fill(null)

  for (const s of trialSeries) {
    if (isMeasureSeries(s)) {
      const durCol = `${s.name}${DURATION_SUFFIX}`
      const cntCol = `${s.name}${COUNTS_SUFFIX}`
      for (const entry of s.entries) {
        if (entry.timeSec === null) continue
        const pos = lowerBound(sortedEnds, entry.timeSec)
        if (pos >= sortedEnds.length) {
          // Fired after the last trial ended: usually a reward collected during the
          // shutdown sequence. There is no trial to attribute it to.
          warnings.push({
            markerName: s.name,
            timeSec: entry.timeSec,
            reason: 'after-last-trial',
          })
          continue
        }
        const trialIndex = orderByEnd[pos]
        if (values[durCol][trialIndex] !== null) {
          // Two events of the same kind inside one trial window. Never happens in the
          // known schedules; if it starts happening the window logic needs revisiting,
          // so surface it rather than silently overwriting.
          warnings.push({
            markerName: s.name,
            timeSec: entry.timeSec,
            reason: 'collision',
            trialIndex,
          })
          continue
        }
        values[durCol][trialIndex] = entry.durationSec
        // ABET writes 0 in the companion `_Counts` column wherever the event occurred and
        // leaves it blank otherwise. Reproduced for column-for-column compatibility.
        values[cntCol][trialIndex] = 0
      }
    } else {
      // Index-aligned: an absent value means zero for a per-trial counter.
      for (let i = 0; i < n; i++) {
        values[s.name][i] = i < s.entries.length ? (s.entries[i].value ?? 0) : 0
      }
    }
  }

  // --- Attempt numbering and scoring ------------------------------------------------
  const trialNoCol = `${structure.trialBlock} - Trial No.`
  const correctCol = `${structure.trialBlock} - No. Correct`
  const correctResponseCol = `${structure.trialBlock} - Correct Image Response Latency${DURATION_SUFFIX}`
  const hasCorrectResponse = correctResponseCol in values
  const seenTrialNo = new Map<number, number>()

  const trials: TrialRow[] = []
  for (let i = 0; i < n; i++) {
    const trialNo = values[trialNoCol]?.[i] ?? i + 1
    const attemptNo = (seenTrialNo.get(trialNo) ?? 0) + 1
    seenTrialNo.set(trialNo, attemptNo)

    const row: Record<string, number | null> = {}
    for (const col of columnOrder) row[col] = values[col][i]

    /*
     * ABET's `No. Correct` scores first attempts only: it is 0 on every correction attempt,
     * including the one the rat finally gets right, which is how its Percentage Correct
     * leaves corrections out. Taken at face value it would count every correct correction
     * as an error once correction trials are included. So first attempts keep ABET's own
     * score, and correction attempts are scored by whether the correct image was touched —
     * an event that agrees with `No. Correct` on every first attempt in the sample files.
     */
    const isCorrectionTrial = attemptNo > 1
    const correct =
      isCorrectionTrial && hasCorrectResponse
        ? Number(values[correctResponseCol][i] !== null)
        : (values[correctCol]?.[i] ?? 0)

    trials.push({
      index: i,
      trialNo,
      attemptNo,
      isCorrectionTrial,
      endSec: endSec[i],
      correct,
      values: row,
    })
  }

  return { trials, columnOrder, warnings, structure }
}
