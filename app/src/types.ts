/**
 * Shared domain types for the TUNL parser.
 *
 * Terminology, as it maps onto the ABET II export:
 *  - "session"  = one XML file = one rat in one chamber for one schedule run.
 *  - "trial"    = one row of `Trial Analysis - *` markers. Note that ABET emits one of
 *                 these per *attempt*, so a trial the rat got wrong and repeated appears
 *                 several times with the same `Trial No.`. See `attemptNo` below.
 *  - "marker"   = one `<Marker>` element. Markers are grouped in the XML by name, not by
 *                 trial, so the Nth entry of every `Trial Analysis - *` series describes
 *                 the same attempt.
 */

/** How a marker carries its value. Anything else is passed through as an unknown string. */
export type MarkerSourceType = 'Evaluation' | 'Count' | 'Measure' | (string & {})

/**
 * One `<Marker>` emission.
 *
 * `value` is null when the element carried no value child at all. That is meaningful:
 * ABET omits the child rather than writing a zero, so `null` here becomes `0` for
 * per-trial counters (a trial where the rat made no blank touches) but stays absent for
 * Measure events (a trial where the rat never collected a reward has no latency, and
 * calling that 0 s would corrupt every latency mean).
 */
export interface MarkerEntry {
  value: number | null
  /** Measure only: event onset, seconds from session start. */
  timeSec: number | null
  /** Measure only: measured interval, seconds. */
  durationSec: number | null
}

export interface MarkerSeries {
  name: string
  sourceType: MarkerSourceType
  entries: MarkerEntry[]
}

/** `SessionInformation` as an ordered list plus a lookup, since column order matters. */
export interface SessionInfo {
  /** Key/value pairs in document order, so the export can reproduce ABET's column order. */
  ordered: { name: string; value: string }[]
  get(name: string): string | undefined
}

export interface ParsedSessionXml {
  sessionInfo: SessionInfo
  /** Marker series keyed by marker name, in first-appearance order. */
  series: Map<string, MarkerSeries>
  exportInfo: { date?: string; dllVersion?: string; sessionLengthSec?: number }
}

/** One trial attempt, with latencies mapped to the trial they actually belong to. */
export interface TrialRow {
  /** 0-based position in the session's attempt sequence. */
  index: number
  /** ABET's `Trial No.`; repeats across correction attempts. */
  trialNo: number
  /** 1 for the first attempt at `trialNo`, 2+ for correction attempts. */
  attemptNo: number
  isCorrectionTrial: boolean
  /** Trial end timestamp, seconds from session start (`Trial Analysis - Condition`). */
  endSec: number
  /**
   * 1 if the rat chose correctly on this attempt, else 0. Unlike ABET's `No. Correct`,
   * which is 0 on every correction attempt, this also scores correction attempts.
   */
  correct: number
  /**
   * All trial-level values keyed by raw marker name. Index-aligned Evaluation/Count
   * markers are always numbers; Measure markers appear as `<name>_Duration` /
   * `<name>_Counts` and are `null` when the event did not occur in this trial.
   */
  values: Record<string, number | null>
}

/** A latency event that could not be attributed to exactly one trial. */
export interface AlignmentWarning {
  markerName: string
  timeSec: number
  reason: 'after-last-trial' | 'collision'
  /** For collisions, the trial index already holding an event. */
  trialIndex?: number
}

export interface ParsedSession {
  /** Source filename, for provenance and error messages. */
  fileName: string
  sessionInfo: SessionInfo
  /** Raw `Animal ID` as written in the XML, e.g. "LZ039". */
  animalIdRaw: string
  /** Whitespace-stripped, uppercased join key, e.g. "LZ039". */
  animalId: string
  /** Parsed from `Test Day`, or `Schedule_Start_Time` when `Test Day` is absent. */
  testDay: Date | null
  scheduleName: string
  /** Delay in seconds parsed from the schedule name ("... 20s" -> 20), else null. */
  delaySec: number | null
  chamber: string
  /** `Sex` as recorded by ABET, normalised to 'F' | 'M' where recognisable. */
  sexXml: 'F' | 'M' | null
  scheduleRunId: string
  /** `End Summary - *` values keyed by raw marker name, in document order. */
  endSummary: Record<string, number | null>
  endSummaryOrder: string[]
  /** Trial-level marker names in document order, already `_Duration`/`_Counts` expanded. */
  trialColumnOrder: string[]
  trials: TrialRow[]
  alignmentWarnings: AlignmentWarning[]
}

/** One row of `Rat Info.xlsx`. */
export interface SubjectInfo {
  /** Raw `Rat ID` as written, e.g. "LZ 084". */
  ratIdRaw: string
  /** Whitespace-stripped, uppercased join key, e.g. "LZ084". */
  ratId: string
  genotype: string | null
  sex: 'F' | 'M' | null
  birthday: Date | null
  set: number | null
}

export type WarningKind =
  | 'unmatched-animal'
  | 'unused-subject'
  | 'sex-conflict'
  | 'latency-collision'
  | 'duplicate-session'
  | 'missing-test-day'
  | 'unknown-schedule'
  | 'parse-failed'

export interface DatasetWarning {
  kind: WarningKind
  message: string
  /** Files or subject IDs the warning concerns, for grouping in the UI. */
  subjects?: string[]
  files?: string[]
}

/**
 * A session with subject metadata joined in and cross-session fields derived.
 * This is the unit the analysis layer works from.
 */
export interface Session extends ParsedSession {
  subject: SubjectInfo | null
  genotype: string | null
  /** Resolved sex: XML wins where present, Rat Info fills gaps. */
  sex: 'F' | 'M' | null
  set: number | null
  /** Days between birthday and test day; null if either is unknown. */
  ageDays: number | null
  /** 1-based rank of this session among the same subject's sessions, date-ordered. */
  sessionNumber: number
}

/** Everything the app holds after a successful load. Lives in memory only. */
export interface Dataset {
  sessions: Session[]
  subjects: SubjectInfo[]
  warnings: DatasetWarning[]
  loadedAt: Date
  xmlFileNames: string[]
  ratInfoFileName: string | null
}
