import type { Dataset, Session } from '../types'
import type { Registry } from '../variables/registry'

export type CellValue = number | string | null

/** One observation. Keys are variable keys from the registry. */
export interface AnalysisRow {
  /** Index into `dataset.sessions`, for tracing a point back to its file. */
  sessionIndex: number
  /** Trial index within the session; absent on session-level rows. */
  trialIndex?: number
  values: Record<string, CellValue>
}

export interface RowOptions {
  /** When false, only first attempts at each Trial No. are included. */
  includeCorrectionTrials: boolean
}

/** Session and subject attributes, shared by trial-level and session-level rows. */
function metadataValues(session: Session, sessionIndex: number): Record<string, CellValue> {
  return {
    genotype: session.genotype,
    sex: session.sex,
    set: session.set,
    delaySec: session.delaySec,
    sessionNumber: session.sessionNumber,
    animalId: session.animalIdRaw || session.animalId,
    ageDays: session.ageDays,
    testDay: session.testDay ? session.testDay.toISOString().slice(0, 10) : null,
    chamber: session.chamber,
    scheduleName: session.scheduleName,
    __sessionIndex: sessionIndex,
    __fileName: session.fileName,
  }
}

/** Trials of a session after the correction-trial filter. */
export function filterTrials(session: Session, opts: RowOptions) {
  return opts.includeCorrectionTrials
    ? session.trials
    : session.trials.filter((t) => !t.isCorrectionTrial)
}

/**
 * Builds one row per trial attempt across all sessions, with session and subject
 * attributes denormalised onto each row so any variable can group any other.
 */
export function buildTrialRows(
  dataset: Dataset,
  registry: Registry,
  opts: RowOptions,
): AnalysisRow[] {
  const rows: AnalysisRow[] = []

  dataset.sessions.forEach((session, sessionIndex) => {
    const meta = metadataValues(session, sessionIndex)

    // Marker name -> variable key, restricted to this session's trial columns.
    const mapping: [string, string][] = []
    for (const markerName of session.trialColumnOrder) {
      const key = registry.markerToKey.get(markerName)
      if (key) mapping.push([markerName, key])
    }

    for (const trial of filterTrials(session, opts)) {
      const values: Record<string, CellValue> = { ...meta }
      for (const [markerName, key] of mapping) {
        values[key] = trial.values[markerName] ?? null
      }
      // Always available, whatever the schedule calls its markers.
      values.attemptNo = trial.attemptNo
      values.isCorrectionTrial = trial.isCorrectionTrial ? 1 : 0

      /*
       * Percent correct is well defined for *any* set of trials, so it is provided at trial
       * level as well: the mean of (correct × 100) over a group of trials is that group's
       * percent correct. Without this, asking for accuracy against separation distance would
       * silently produce an empty figure, because accuracy would only exist on session rows
       * while separation distance only exists on trial rows.
       */
      const correct = values.correct
      values.percentCorrect = typeof correct === 'number' ? correct * 100 : null

      rows.push({ sessionIndex, trialIndex: trial.index, values })
    }
  })

  return rows
}

/**
 * Builds one row per session: metadata, the raw `End Summary` markers, and the derived
 * measures that follow the correction-trial setting.
 *
 * Trial-level variables also get a per-session mean here, so a bar chart of
 * "Reward Collection Latency by Genotype" can average within a session before comparing
 * groups. Latency means skip trials where the event did not occur, since a trial with no
 * reward has no reward latency and treating it as 0 s would bias every group mean.
 */
export function buildSessionRows(
  dataset: Dataset,
  registry: Registry,
  opts: RowOptions,
): AnalysisRow[] {
  const trialDefs = registry.variables.filter((v) => v.level === 'trial' && v.markerName)

  return dataset.sessions.map((session, sessionIndex) => {
    const values: Record<string, CellValue> = metadataValues(session, sessionIndex)

    for (const markerName of session.endSummaryOrder) {
      const key = registry.markerToKey.get(markerName)
      if (key) values[key] = session.endSummary[markerName] ?? null
    }

    const trials = filterTrials(session, opts)

    // Derived session measures.
    const nCorrect = trials.filter((t) => t.correct === 1).length
    values.percentCorrect = trials.length > 0 ? (nCorrect / trials.length) * 100 : null
    values.trialsAnalysed = trials.length
    values.correctionTrialCount = trials.filter((t) => t.isCorrectionTrial).length

    // Per-session means of trial-level variables.
    for (const def of trialDefs) {
      const marker = def.markerName as string
      let sum = 0
      let n = 0
      for (const t of trials) {
        const v = t.values[marker]
        if (v === null || v === undefined) continue
        sum += v
        n++
      }
      // Binary variables stay as proportions here; `aggregate` scales them to percentages
      // in one place, so trial-level and session-level rows share the same units.
      values[def.key] = n > 0 ? sum / n : null
    }

    return { sessionIndex, values }
  })
}
