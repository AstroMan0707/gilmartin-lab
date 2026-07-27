import type { Session, TrialRow } from '../types'

export interface SessionSummary {
  /** Number of trial attempts the summary was computed from, after filtering. */
  nTrials: number
  /** Distinct `Trial No.` values, i.e. trials the rat reached. */
  nTrialsUnique: number
  nCorrectionTrials: number
  percentCorrect: number | null
  /** Percent correct at each separation distance present in the session. */
  percentCorrectByDistance: Record<number, number>
  /** Mean of each latency measure over the trials where the event occurred. */
  meanLatency: Record<string, number | null>
  /** Sum of each per-trial counter (ITI touches, blank touches). */
  totalCounts: Record<string, number>
}

/** Marker-name fragments identifying the trial-level counters worth totalling. */
const COUNTER_FRAGMENTS = ['ITI Touches', 'ITI touches', 'Blank Touches']

function isLatencyColumn(col: string): boolean {
  return col.endsWith('_Duration')
}

function isCounterColumn(col: string): boolean {
  return COUNTER_FRAGMENTS.some((f) => col.includes(f))
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/**
 * Computes per-session aggregates from trial rows.
 *
 * Deliberately derived from the (already filtered) trials rather than read off the
 * `End Summary - *` markers, so that the numbers respect the user's correction-trial
 * setting. The raw End Summary values are kept alongside as separate variables, which is
 * what lets the test suite check these derivations against the machine's own figures.
 */
export function deriveSessionSummary(session: Session, trials: TrialRow[]): SessionSummary {
  const block = 'Trial Analysis'
  const distanceCol = `${block} - Distance gp`

  const nCorrect = trials.filter((t) => t.correct === 1).length
  const percentCorrect = trials.length > 0 ? (nCorrect / trials.length) * 100 : null

  // --- Accuracy as a function of separation distance --------------------------------
  const byDistance = new Map<number, { n: number; correct: number }>()
  for (const t of trials) {
    const d = t.values[distanceCol]
    if (d === null || d === undefined) continue
    const cell = byDistance.get(d) ?? { n: 0, correct: 0 }
    cell.n++
    if (t.correct === 1) cell.correct++
    byDistance.set(d, cell)
  }
  const percentCorrectByDistance: Record<number, number> = {}
  for (const [d, { n, correct }] of byDistance) {
    percentCorrectByDistance[d] = (correct / n) * 100
  }

  // --- Latency means and counter totals ----------------------------------------------
  const meanLatency: Record<string, number | null> = {}
  const totalCounts: Record<string, number> = {}

  for (const col of session.trialColumnOrder) {
    if (isLatencyColumn(col)) {
      // Only trials where the event actually occurred contribute. Trials with no reward
      // have a null latency, and counting those as zero would drag the mean down.
      const present: number[] = []
      for (const t of trials) {
        const v = t.values[col]
        if (v !== null && v !== undefined) present.push(v)
      }
      meanLatency[col] = mean(present)
    } else if (isCounterColumn(col)) {
      let sum = 0
      for (const t of trials) sum += t.values[col] ?? 0
      totalCounts[col] = sum
    }
  }

  return {
    nTrials: trials.length,
    nTrialsUnique: new Set(trials.map((t) => t.trialNo)).size,
    nCorrectionTrials: trials.filter((t) => t.isCorrectionTrial).length,
    percentCorrect,
    percentCorrectByDistance,
    meanLatency,
    totalCounts,
  }
}
