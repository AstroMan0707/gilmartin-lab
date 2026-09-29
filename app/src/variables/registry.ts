import type { Dataset } from '../types'

export type VariableRole = 'IV' | 'DV'
export type VariableType = 'continuous' | 'categorical' | 'ordinal' | 'count'
export type VariableLevel = 'trial' | 'session' | 'subject'
export type VariableSource = 'marker' | 'session-info' | 'ratinfo' | 'derived'

export interface VariableLevelLabel {
  value: number | string
  label: string
}

export interface VariableDef {
  /** Stable key used in analysis rows and chart specs. */
  key: string
  /** Short human label for the UI and axis titles. */
  label: string
  /** Longer explanation shown on hover; the audience does not know ABET's vocabulary. */
  description?: string
  unit?: string
  role: VariableRole
  type: VariableType
  level: VariableLevel
  source: VariableSource
  /**
   * How values combine when several rows collapse into one point.
   *
   * 'mean' suits a rate or a latency. 'sum' suits a count: the number of correct trials for a
   * rat is the total across its trials, not their average. Defaults to 'mean'.
   */
  aggregation?: 'mean' | 'sum'
  /** Raw ABET marker name, where one exists. Used for the spreadsheet export headers. */
  markerName?: string
  /** True when this variable can be cut into ranges and used as a grouping variable. */
  binnable: boolean
  /** True when values have a meaningful order, making it valid as a line-graph x-axis. */
  ordered: boolean
  /**
   * For an ordered variable whose spacing carries meaning — delays of 0, 2 and 20 s, dates a
   * week apart — how a line graph places it: to scale rather than one step per value. Absent
   * for ones that step by one, such as session number, where even spacing is already true.
   */
  scale?: 'linear' | 'date'
  /** Display labels for coded values, e.g. sample side 1 -> "Left". */
  levels?: VariableLevelLabel[]
  /** Hidden from the default variable picker; still available via "show all". */
  advanced?: boolean
}

/**
 * Subject and session attributes. These come from Rat Info.xlsx, from the session
 * information block, or are derived during the join, so they exist for every schedule.
 */
export const METADATA_VARIABLES: VariableDef[] = [
  {
    key: 'genotype',
    label: 'Genotype',
    description: 'From the Rat Info file. WT = wild type, AD = disease model.',
    role: 'IV',
    type: 'categorical',
    level: 'subject',
    source: 'ratinfo',
    binnable: false,
    ordered: false,
  },
  {
    key: 'sex',
    label: 'Sex',
    description: 'Taken from the session file where recorded, otherwise from Rat Info.',
    role: 'IV',
    type: 'categorical',
    level: 'subject',
    source: 'session-info',
    binnable: false,
    ordered: false,
  },
  {
    key: 'set',
    label: 'Set',
    description: 'Cohort number from the Rat Info file.',
    role: 'IV',
    type: 'ordinal',
    level: 'subject',
    source: 'ratinfo',
    binnable: false,
    ordered: true,
  },
  {
    key: 'delaySec',
    label: 'Delay',
    unit: 's',
    description:
      'Retention delay, read from the schedule name (for example "Rat TUNL Full v2 20s" gives 20 s).',
    role: 'IV',
    type: 'ordinal',
    level: 'session',
    source: 'derived',
    binnable: false,
    ordered: true,
    scale: 'linear',
  },
  {
    key: 'sessionNumber',
    label: 'Session Number',
    description:
      "This rat's sessions in date order, numbered from 1. Use as the x-axis for learning curves.",
    role: 'IV',
    type: 'ordinal',
    level: 'session',
    source: 'derived',
    binnable: true,
    ordered: true,
  },
  {
    key: 'animalId',
    label: 'Rat',
    description: 'Animal ID. Group by this to plot individual subjects.',
    role: 'IV',
    type: 'categorical',
    level: 'subject',
    source: 'session-info',
    binnable: false,
    ordered: false,
  },
  {
    key: 'ageDays',
    label: 'Age at Test',
    unit: 'days',
    description: 'Test date minus birthday. Needs a birthday in the Rat Info file.',
    role: 'IV',
    type: 'continuous',
    level: 'session',
    source: 'derived',
    binnable: true,
    ordered: true,
    scale: 'linear',
  },
  {
    key: 'testDay',
    label: 'Test Date',
    description: 'Calendar date of the session.',
    role: 'IV',
    type: 'ordinal',
    level: 'session',
    source: 'session-info',
    binnable: false,
    ordered: true,
    scale: 'date',
  },
  {
    key: 'chamber',
    label: 'Chamber',
    description: 'Which testing chamber the session ran in. Useful for checking apparatus effects.',
    role: 'IV',
    type: 'categorical',
    level: 'session',
    source: 'session-info',
    binnable: false,
    ordered: false,
    advanced: true,
  },
  {
    key: 'scheduleName',
    label: 'Schedule',
    description: 'Full ABET schedule name.',
    role: 'IV',
    type: 'categorical',
    level: 'session',
    source: 'session-info',
    binnable: false,
    ordered: false,
    advanced: true,
  },
]

/**
 * Values computed from the trial data rather than read off the machine's own summary, so they
 * follow the correction-trial setting.
 *
 * These deliberately supersede the equivalent `End Summary - *` markers, which are fixed at
 * "first attempts only" and exist only per session. Offering both produced pairs of chips with
 * the same name and the same numbers, which is what this set replaces.
 */
export const DERIVED_SESSION_VARIABLES: VariableDef[] = [
  {
    key: 'correctTrials',
    label: 'Correct Trials',
    description:
      'How many trials the rat got right, as a whole number. Pair it with Trials Analysed for the denominator, or use Percent Correct for the rate.',
    role: 'DV',
    type: 'count',
    level: 'session',
    source: 'derived',
    // A count totals across trials; averaging would turn it back into a proportion.
    aggregation: 'sum',
    binnable: true,
    ordered: false,
  },
  {
    key: 'percentCorrect',
    label: 'Percent Correct',
    unit: '%',
    description:
      'Correct trials as a percentage of trials analysed, recomputed from the trial data so it follows your correction-trial setting. Also available per trial, so it can be plotted against Separation Distance.',
    role: 'DV',
    type: 'continuous',
    level: 'session',
    source: 'derived',
    binnable: true,
    ordered: false,
  },
  {
    key: 'trialsAnalysed',
    label: 'Trials Analysed',
    description:
      'How many trial attempts went into this session, after the correction-trial setting is applied.',
    role: 'DV',
    type: 'count',
    level: 'session',
    source: 'derived',
    aggregation: 'sum',
    binnable: true,
    ordered: false,
  },
  {
    key: 'correctionTrialCount',
    label: 'Correction Trials',
    description:
      'Repeat attempts after an error — a measure of perseveration. Always counted from the full session, so it stays meaningful whether or not correction trials are included in the analysis. Trials Analysed plus this gives the total attempt count.',
    role: 'DV',
    type: 'count',
    level: 'session',
    source: 'derived',
    aggregation: 'sum',
    binnable: true,
    ordered: false,
  },
]

/**
 * Trial-level marker definitions, keyed by the exact ABET marker name (already
 * `_Duration`-expanded where relevant).
 *
 * Marker names are unusably verbose in a UI — "Trial Analysis - Centre Blank Touches -
 * Centre Blank" — so every known one gets a short label here. Markers absent from this
 * table still appear, with an auto-generated label, so an unfamiliar schedule is usable
 * rather than blocked.
 */
/** Shown on every per-trial touch counter, as the counterpart to SESSION_TOTAL_NOTE. */
const PER_TRIAL_TOUCH_NOTE =
  'Counted per trial, so the mean is touches per trial and the summary table\u2019s Total column ' +
  'gives the number altogether. Grouping by this normalises for how many trials a rat ran, ' +
  'which a whole-session total does not.'

const KNOWN_TRIAL_MARKERS: Record<string, Partial<VariableDef> & { label: string }> = {
  'Trial Analysis - Distance gp': {
    key: 'distance',
    label: 'Separation Distance',
    description:
      'How far apart the sample and choice locations were, 1 (hardest) to 13 (easiest). The classic TUNL difficulty axis.',
    role: 'IV',
    type: 'ordinal',
    ordered: true,
  },
  'Trial Analysis - Sample side': {
    key: 'sampleSide',
    label: 'Sample Side',
    description: 'Which side the sample image appeared on.',
    role: 'IV',
    type: 'categorical',
    levels: [
      { value: 1, label: 'Left' },
      { value: 2, label: 'Right' },
    ],
  },
  'Trial Analysis - Trial No.': {
    key: 'trialNo',
    label: 'Trial Number',
    description: 'Position within the session. Use as an x-axis for within-session changes.',
    role: 'IV',
    type: 'ordinal',
    ordered: true,
    binnable: true,
  },
  'Trial Analysis - Pattern No.': {
    key: 'patternNo',
    label: 'Pattern Number',
    description: 'Which stimulus pattern was shown.',
    role: 'IV',
    type: 'categorical',
    advanced: true,
  },
  'Trial Analysis - Condition': {
    key: 'trialEndSec',
    label: 'Time in Session',
    unit: 's',
    description: 'When this trial ended, in seconds from session start.',
    role: 'IV',
    type: 'continuous',
    ordered: true,
    scale: 'linear',
    binnable: true,
    advanced: true,
  },
  'Trial Analysis - Reward Collection Latency_Duration': {
    key: 'rewardLatency',
    label: 'Reward Collection Latency',
    unit: 's',
    description:
      'Time to collect the reward. Blank on trials with no reward — those trials are left out of averages rather than counted as zero.',
    role: 'DV',
    type: 'continuous',
    binnable: true,
  },
  'Trial Analysis - Correct Image Response Latency_Duration': {
    key: 'correctImageLatency',
    label: 'Correct Response Latency',
    unit: 's',
    description: 'Time to touch the correct image. Only present on correct trials.',
    role: 'DV',
    type: 'continuous',
    binnable: true,
  },
  'Trial Analysis - Incorrect Image Latency_Duration': {
    key: 'incorrectImageLatency',
    label: 'Incorrect Response Latency',
    unit: 's',
    description: 'Time to touch the incorrect image. Only present on error trials.',
    role: 'DV',
    type: 'continuous',
    binnable: true,
  },
  'Trial Analysis - Left ITI Touches': {
    key: 'leftItiTouches',
    label: 'Left ITI Touches',
    description: PER_TRIAL_TOUCH_NOTE,
  },
  'Trial Analysis - Centre ITI touches': {
    key: 'centreItiTouches',
    label: 'Centre ITI Touches',
    description: PER_TRIAL_TOUCH_NOTE,
  },
  'Trial Analysis - Right ITI Touches': {
    key: 'rightItiTouches',
    label: 'Right ITI Touches',
    description: PER_TRIAL_TOUCH_NOTE,
  },
  'Trial Analysis - Left Blank Touches - Generic Counter': {
    key: 'leftBlankTouches',
    label: 'Left Blank Touches',
    description: PER_TRIAL_TOUCH_NOTE,
  },
  'Trial Analysis - Centre Blank Touches - Centre Blank': {
    key: 'centreBlankTouches',
    label: 'Centre Blank Touches',
    description: PER_TRIAL_TOUCH_NOTE,
  },
  'Trial Analysis - Right Blank Touches - Generic Counter': {
    key: 'rightBlankTouches',
    label: 'Right Blank Touches',
    description: PER_TRIAL_TOUCH_NOTE,
  },
}

/** Shown on every whole-session touch counter, since the difference surprises people. */
const SESSION_TOTAL_NOTE =
  "ABET's own count for the whole session. This can be higher than the sum of the per-trial " +
  'counts, because some touches are tallied session-wide without being attributed to any ' +
  'trial. Use the per-trial version for analysis; use this when you need the whole-session ' +
  'figure exactly as the machine reported it.'

const KNOWN_SESSION_MARKERS: Record<string, Partial<VariableDef> & { label: string }> = {
  'End Summary - Condition': {
    key: 'sessionTimeLimit',
    label: 'Session Time Limit',
    unit: 's',
    type: 'count',
    advanced: true,
  },
  // --- Whole-session touch counters -----------------------------------------------------
  //
  // These are hidden from the default picker rather than removed, because they are NOT simply
  // the sum of the matching per-trial counters. ABET tallies some touches session-wide that it
  // never attributes to any trial, so the session figure can exceed the per-trial sum — in the
  // reference data by up to 6 touches, which on one measure is 17% of the total. Deleting them
  // would quietly discard those touches; the per-trial versions plus the summary table's Total
  // column cover the common case, and these remain under "Show all" when the whole-session
  // number is what is wanted.
  'End Summary - Left ITI touches': {
    key: 'sessionLeftItiTouches',
    label: 'Left ITI Touches (whole session)',
    description: SESSION_TOTAL_NOTE,
    advanced: true,
  },
  'End Summary - Centre ITI touches': {
    key: 'sessionCentreItiTouches',
    label: 'Centre ITI Touches (whole session)',
    description: SESSION_TOTAL_NOTE,
    advanced: true,
  },
  'End Summary - Right ITI touches': {
    key: 'sessionRightItiTouches',
    label: 'Right ITI Touches (whole session)',
    description: SESSION_TOTAL_NOTE,
    advanced: true,
  },
  'End Summary - Left Blank Touches - Generic Counter': {
    key: 'sessionLeftBlankTouches',
    label: 'Left Blank Touches (whole session)',
    description: SESSION_TOTAL_NOTE,
    advanced: true,
  },
  'End Summary - Centre Blank Touches - Centre Blank': {
    key: 'sessionCentreBlankTouches',
    label: 'Centre Blank Touches (whole session)',
    description: SESSION_TOTAL_NOTE,
    advanced: true,
  },
  'End Summary - Right Blank Touches - Generic Counter': {
    key: 'sessionRightBlankTouches',
    label: 'Right Blank Touches (whole session)',
    description: SESSION_TOTAL_NOTE,
    advanced: true,
  },
}

/** "End Summary - Corrects at Distance 7 - Generic Counter" -> distance 7. */
const CORRECTS_AT_DISTANCE = /^End Summary - Corrects at Distance (\d+)\b/

/** Turns an unrecognised marker name into a usable key and label. */
function autoLabel(markerName: string): { key: string; label: string } {
  // Drop the block prefix and ABET's trailing counter-type noise
  // ("- Generic Counter", "- Count #1", "- Centre Blank").
  let label = markerName.replace(/^[^-]+ - /, '')
  label = label.replace(/ - (Generic Counter|Generic Point|Count #\d+|Centre Blank)$/i, '')
  label = label.replace(/_Duration$/, '').trim()
  const key = label
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toLowerCase())
  return { key: key || markerName, label: label || markerName }
}

/**
 * Markers superseded by a derived variable that reports the same thing better.
 *
 * Each of these produced a second chip with the same name and the same numbers as one of the
 * derived measures, which made the picker ambiguous. The derived versions win because they
 * follow the correction-trial setting and, for accuracy, exist per trial as well as per
 * session — so they can be plotted against Separation Distance, which a session-level summary
 * value cannot.
 *
 * They are hidden from the analysis UI only. Every one of these values is still written to the
 * Excel export, which reads the markers straight from the parsed session, so the machine's own
 * figures remain available for cross-checking.
 */
const SUPERSEDED_MARKERS = new Set([
  // -> percentCorrect and correctTrials
  'Trial Analysis - No. Correct',
  'End Summary - Percentage Correct',
  // -> trialsAnalysed
  'End Summary - Trials Completed',
  // -> trialsAnalysed + correctionTrialCount
  'End Summary - All Trials Completed',
])

/**
 * Markers with nothing to analyse.
 *
 * `_Counts` companion columns carry no information — ABET writes 0 wherever the event occurred
 * and nothing elsewhere — so they are kept in the spreadsheet export for column-for-column
 * compatibility but hidden from the analysis UI.
 */
function isAnalyticallyEmpty(markerName: string): boolean {
  return markerName.endsWith('_Counts') || SUPERSEDED_MARKERS.has(markerName)
}

export interface Registry {
  variables: VariableDef[]
  byKey: Map<string, VariableDef>
  /** Maps a raw ABET marker name to the variable key it became. */
  markerToKey: Map<string, string>
}

/** Identity fields, shown first in the Data table. */
const DATA_TABLE_IDENTITY = ['animalId', 'genotype', 'sex', 'set', 'sessionNumber', 'delaySec', 'testDay']

/**
 * The columns of the Data table at each level, identity fields first. The trial view leaves
 * out session-level variables, which trial rows do not carry; the session view shows all.
 */
export function dataTableKeys(registry: Registry, level: 'trial' | 'session'): string[] {
  const rest = registry.variables
    .filter((v) => !DATA_TABLE_IDENTITY.includes(v.key))
    .filter((v) => level === 'session' || v.level !== 'session')
    .map((v) => v.key)
  return [...DATA_TABLE_IDENTITY, ...rest].filter((k) => registry.byKey.has(k))
}

/**
 * Builds the variable list for a loaded dataset.
 *
 * Driven by the markers actually present rather than a fixed list, because the lab runs
 * several schedule variants and a variable that does not exist in the data should not
 * appear as a clickable option.
 */
export function buildRegistry(dataset: Dataset): Registry {
  const variables: VariableDef[] = []
  const markerToKey = new Map<string, string>()
  const seenKeys = new Set<string>()

  const push = (def: VariableDef, markerName?: string) => {
    if (seenKeys.has(def.key)) return
    seenKeys.add(def.key)
    variables.push(def)
    if (markerName) markerToKey.set(markerName, def.key)
  }

  // --- Metadata, filtered to what the loaded sessions actually populate --------------
  const has = (predicate: (s: Dataset['sessions'][number]) => boolean) =>
    dataset.sessions.some(predicate)

  for (const def of METADATA_VARIABLES) {
    const populated =
      def.key === 'genotype' ? has((s) => s.genotype !== null)
      : def.key === 'set' ? has((s) => s.set !== null)
      : def.key === 'sex' ? has((s) => s.sex !== null)
      : def.key === 'ageDays' ? has((s) => s.ageDays !== null)
      : def.key === 'delaySec' ? has((s) => s.delaySec !== null)
      : def.key === 'testDay' ? has((s) => s.testDay !== null)
      : true
    if (populated) push(def)
  }

  for (const def of DERIVED_SESSION_VARIABLES) push(def)

  // --- Markers present in the loaded sessions ----------------------------------------
  const trialMarkers: string[] = []
  const sessionMarkers: string[] = []
  for (const s of dataset.sessions) {
    for (const name of s.trialColumnOrder) if (!trialMarkers.includes(name)) trialMarkers.push(name)
    for (const name of s.endSummaryOrder) if (!sessionMarkers.includes(name)) sessionMarkers.push(name)
  }

  for (const markerName of trialMarkers) {
    if (isAnalyticallyEmpty(markerName)) continue
    const known = KNOWN_TRIAL_MARKERS[markerName]
    const auto = autoLabel(markerName)
    push(
      {
        key: known?.key ?? auto.key,
        label: known?.label ?? auto.label,
        description: known?.description,
        unit: known?.unit,
        // Unrecognised trial markers are counters far more often than anything else.
        role: known?.role ?? 'DV',
        type: known?.type ?? 'count',
        level: 'trial',
        source: 'marker',
        markerName,
        binnable: known?.binnable ?? (known?.type === 'continuous' || !known),
        ordered: known?.ordered ?? false,
        scale: known?.scale,
        levels: known?.levels,
        advanced: known?.advanced,
      },
      markerName,
    )
  }

  for (const markerName of sessionMarkers) {
    if (isAnalyticallyEmpty(markerName)) continue
    const known = KNOWN_SESSION_MARKERS[markerName]
    const distanceMatch = CORRECTS_AT_DISTANCE.exec(markerName)
    const auto = autoLabel(markerName)

    const key = known?.key ?? (distanceMatch ? `correctsAtDistance${distanceMatch[1]}` : auto.key)
    const label =
      known?.label ?? (distanceMatch ? `Corrects at Distance ${distanceMatch[1]}` : auto.label)

    push(
      {
        key,
        label,
        description: known?.description,
        unit: known?.unit,
        role: known?.role ?? 'DV',
        type: known?.type ?? 'count',
        level: 'session',
        source: 'marker',
        markerName,
        binnable: true,
        ordered: false,
        levels: known?.levels,
        // The 13 per-distance counters would swamp the picker; the same information is
        // available more usefully by plotting accuracy against Separation Distance.
        advanced: known?.advanced ?? distanceMatch !== null,
      },
      markerName,
    )
  }

  return { variables, byKey: new Map(variables.map((v) => [v.key, v])), markerToKey }
}

/** Formats a value using a variable's coded level labels, for axis ticks and legends. */
export function formatValue(def: VariableDef | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (def?.levels) {
    const match = def.levels.find((l) => l.value === value)
    if (match) return match.label
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000)
  }
  return String(value)
}

/** Axis title including units, e.g. "Reward Collection Latency (s)". */
export function axisTitle(def: VariableDef | undefined): string {
  if (!def) return ''
  return def.unit ? `${def.label} (${def.unit})` : def.label
}
