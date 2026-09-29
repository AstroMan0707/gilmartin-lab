import { mean as ssMean, quantileSorted, sampleStandardDeviation } from 'simple-statistics'
import type { Registry, VariableDef } from '../variables/registry'
import { formatValue } from '../variables/registry'
import type { AnalysisRow, CellValue } from './rows'

/**
 * What one data point represents.
 *
 * The default is 'subject'. Comparing genotypes on trial-level rows treats each trial as
 * an independent observation, which inflates n from tens of rats to thousands of trials
 * and makes any difference look significant — the classic pseudo-replication mistake. So
 * values are averaged within each rat first, and n is the number of rats.
 */
export type AggregationUnit = 'trial' | 'session' | 'subject'

export const AGGREGATION_LABELS: Record<AggregationUnit, string> = {
  trial: 'Each trial',
  session: 'Each session',
  subject: 'Each rat',
}

export const AGGREGATION_DESCRIPTIONS: Record<AggregationUnit, string> = {
  trial: 'Every trial is its own data point. n is the number of trials.',
  session: 'Trials are averaged within each session. n is the number of sessions.',
  subject: 'Trials are averaged within each session, then sessions within each rat, so every session counts equally. n is the number of rats — the usual choice for comparing groups.',
}

export interface Stats {
  n: number
  /** Rows in the group where the variable had no value, and so were not counted. */
  missing: number
  mean: number | null
  sd: number | null
  /** Standard error of the mean; the error bar most papers use. */
  sem: number | null
  median: number | null
  q1: number | null
  q3: number | null
  iqr: number | null
  min: number | null
  max: number | null
  /**
   * Sum of every underlying observation in the group, before collapsing to the chosen unit.
   *
   * Independent of "each trial / session / rat", so it answers "how many altogether" while the
   * mean answers "how many each". Only meaningful for counts; null for rates and percentages,
   * where a total would be arithmetic nonsense.
   */
  total: number | null
  /** The raw values, needed by box plots and histograms. */
  values: number[]
}

export const EMPTY_STATS: Stats = {
  n: 0,
  missing: 0,
  mean: null,
  sd: null,
  sem: null,
  median: null,
  q1: null,
  q3: null,
  iqr: null,
  min: null,
  max: null,
  total: null,
  values: [],
}

/** Descriptive statistics for a set of values. Non-numeric entries are counted as missing. */
export function describe(raw: CellValue[]): Stats {
  const values: number[] = []
  let missing = 0
  for (const v of raw) {
    if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
    else missing++
  }
  if (values.length === 0) return { ...EMPTY_STATS, missing }

  const sorted = [...values].sort((a, b) => a - b)
  const m = ssMean(values)
  // Sample SD (n − 1 denominator): each group is a sample of rats, not the whole population.
  // simple-statistics' `standardDeviation` is the population form, which understates SD and
  // SEM by √((n − 1)/n) — 18% at n = 3. Sample SD is undefined for n=1; report null rather
  // than 0, which would draw a misleadingly confident error bar of zero length.
  const sd = values.length > 1 ? sampleStandardDeviation(values) : null
  const q1 = quantileSorted(sorted, 0.25)
  const q3 = quantileSorted(sorted, 0.75)

  return {
    n: values.length,
    missing,
    mean: m,
    sd,
    sem: sd === null ? null : sd / Math.sqrt(values.length),
    median: quantileSorted(sorted, 0.5),
    q1,
    q3,
    iqr: q3 - q1,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    total: null,
    values,
  }
}

/**
 * Sums a measure over rows as they stand, before any collapsing.
 *
 * Deliberately independent of the aggregation unit: the number of blank touches a group of rats
 * made is the same number whether you are treating each trial, each session or each rat as the
 * data point.
 */
export function rawTotal(rows: AnalysisRow[], measureKey: string): number | null {
  let sum = 0
  let seen = 0
  for (const row of rows) {
    const v = row.values[measureKey]
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v
      seen++
    }
  }
  return seen === 0 ? null : sum
}

/** How a variable's values combine when rows collapse into one point. */
export type Combine = 'mean' | 'sum'

/**
 * Counts total; everything else averages.
 *
 * The number of correct trials for a rat is the sum across its trials — averaging would turn a
 * count back into the proportion that Percent Correct already reports, which is exactly the
 * duplication this replaces.
 */
export function combineFor(def: VariableDef | undefined): Combine {
  return def?.aggregation ?? 'mean'
}

/** The unit to show on an axis. */
export function effectiveUnit(def: VariableDef | undefined): string | undefined {
  return def?.unit
}

export interface GroupKeyPart {
  variableKey: string
  value: CellValue
  label: string
}

export interface Group {
  /** Stable identity for the group, built from its grouping values. */
  id: string
  /** One entry per grouping variable, in the order the user chose them. */
  key: GroupKeyPart[]
  /** Combined label, e.g. "WT · 20 s". */
  label: string
  rows: AnalysisRow[]
}

/** The separator between grouping variables in a combined group label. */
const LABEL_SEPARATOR = ' · '

/**
 * Explicit level ordering for grouping variables whose values do not sort themselves.
 *
 * Keyed by grouping variable key; the array lists that variable's values in the order they
 * should appear. Needed for binned variables, whose values are labels like "< 6 s" and
 * "6–12 s" — sorted as text those come out in a meaningless order.
 */
export type LevelOrder = Record<string, string[]>

/**
 * Splits rows into groups by one or more grouping variables.
 *
 * Groups appear in the natural order of their values — numerically where the values are
 * numbers, by an explicit `levelOrder` where one is supplied, alphabetically otherwise —
 * rather than in the order encountered, so a distance axis reads 1, 2, 3 and not whatever
 * order the trials happened to occur in.
 */
export function groupBy(
  rows: AnalysisRow[],
  groupingKeys: string[],
  registry: Registry,
  levelOrder: LevelOrder = {},
): Group[] {
  if (groupingKeys.length === 0) {
    return [{ id: '', key: [], label: 'All data', rows }]
  }

  const map = new Map<string, Group>()
  for (const row of rows) {
    const key: GroupKeyPart[] = groupingKeys.map((variableKey) => {
      const value = row.values[variableKey] ?? null
      const def = registry.byKey.get(variableKey.replace(/__bin$/, ''))
      // A binned variable already carries its label as its value.
      const label = variableKey.endsWith('__bin')
        ? (value === null ? '—' : String(value))
        : formatValue(def, value)
      return { variableKey, value, label }
    })

    const id = key.map((k) => String(k.value)).join('\u0000')
    const existing = map.get(id)
    if (existing) existing.rows.push(row)
    else map.set(id, { id, key, label: key.map((k) => k.label).join(LABEL_SEPARATOR), rows: [row] })
  }

  const groups = [...map.values()]
  groups.sort((a, b) => {
    for (let i = 0; i < groupingKeys.length; i++) {
      const key = groupingKeys[i]
      const av = a.key[i].value
      const bv = b.key[i].value

      // Groups with no value sort last, so "—" does not lead the axis.
      if (av === null && bv !== null) return 1
      if (bv === null && av !== null) return -1
      if (av === null && bv === null) continue

      const order = levelOrder[key]
      if (order) {
        // Values absent from the order sort after those present, rather than at index -1.
        const ai = order.indexOf(String(av))
        const bi = order.indexOf(String(bv))
        const an = ai === -1 ? order.length : ai
        const bn = bi === -1 ? order.length : bi
        if (an !== bn) return an - bn
        continue
      }

      if (typeof av === 'number' && typeof bv === 'number') {
        if (av !== bv) return av - bv
      } else {
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
        if (cmp !== 0) return cmp
      }
    }
    return 0
  })

  return groups
}

/**
 * Reduces rows to one value per unit of aggregation, so that downstream statistics treat
 * the right thing as an independent observation.
 *
 * 'trial' leaves rows alone. 'session' combines the measure within each session. 'subject'
 * does that first and then combines each rat's sessions, so every session counts once
 * however many trials it had. That keeps a rat's value the same whether it comes from
 * trial rows or session rows: the playground switches to trial rows as soon as any
 * trial-level variable is selected, and averaging a rat's trials directly used to make
 * Percent Correct change meaning when an unrelated variable was added.
 *
 * Combining skips missing values, so a session's reward latency is the mean over the
 * trials where the rat actually collected a reward, and a session with no value at all
 * does not count towards the rat.
 */
export function collapseToUnit(
  rows: AnalysisRow[],
  measureKey: string,
  unit: AggregationUnit,
  combine: Combine = 'mean',
): CellValue[] {
  if (unit === 'trial') return rows.map((r) => r.values[measureKey] ?? null)

  const combineValues = (vals: number[]) =>
    combine === 'sum' ? vals.reduce((a, b) => a + b, 0) : ssMean(vals)

  const bySession = new Map<string, { subject: string; values: number[] }>()
  for (const row of rows) {
    const v = row.values[measureKey]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const id = String(row.values.__sessionIndex ?? row.sessionIndex)
    const session = bySession.get(id)
    if (session) session.values.push(v)
    else bySession.set(id, { subject: String(row.values.__subjectKey), values: [v] })
  }
  const sessions = [...bySession.values()].map((s) => ({
    subject: s.subject,
    value: combineValues(s.values),
  }))
  if (unit === 'session') return sessions.map((s) => s.value)

  const bySubject = new Map<string, number[]>()
  for (const s of sessions) {
    const list = bySubject.get(s.subject)
    if (list) list.push(s.value)
    else bySubject.set(s.subject, [s.value])
  }
  return [...bySubject.values()].map(combineValues)
}

export interface AggregatedCell {
  group: Group
  stats: Stats
}

/**
 * Groups rows, collapses each group to the chosen unit of aggregation, and describes it.
 * This is the single path every chart and the summary table go through.
 */
export function aggregate(
  rows: AnalysisRow[],
  measureKey: string,
  groupingKeys: string[],
  unit: AggregationUnit,
  registry: Registry,
  levelOrder: LevelOrder = {},
): AggregatedCell[] {
  const def = registry.byKey.get(measureKey)
  const combine = combineFor(def)
  // A total is only meaningful for a count. Summing percentages or latencies across rats would
  // produce a number with no interpretation, so those report no total at all.
  const wantsTotal = def?.type === 'count'

  return groupBy(rows, groupingKeys, registry, levelOrder).map((group) => ({
    group,
    stats: {
      ...describe(collapseToUnit(group.rows, measureKey, unit, combine)),
      total: wantsTotal ? rawTotal(group.rows, measureKey) : null,
    },
  }))
}

/** Formats a statistic for display, or an em dash when it could not be computed. */
export function fmt(value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits
  return String(rounded)
}
