import { quantileSorted } from 'simple-statistics'
import type { AnalysisRow, CellValue } from './rows'

export type BinMode = 'equal-width' | 'equal-count' | 'custom'

export interface BinSpec {
  /** Variable key being cut into ranges. */
  variableKey: string
  mode: BinMode
  /** Number of bins for 'equal-width' and 'equal-count'. */
  binCount: number
  /**
   * Interior boundaries for 'custom', ascending, in the variable's own units.
   * `[6, 12]` gives three bins: up to 6, 6 to 12, over 12.
   */
  edges: number[]
  /** Per-bin label overrides; blank entries fall back to the generated range label. */
  labels?: (string | null)[]
}

export interface Bin {
  index: number
  label: string
  /** Inclusive lower bound; -Infinity for the first bin. */
  min: number
  /** Exclusive upper bound; +Infinity for the last bin. */
  max: number
}

export interface BinResult {
  bins: Bin[]
  /** Values that fell outside every bin, which happens only with custom edges. */
  excludedCount: number
  /** Rows where the variable had no value at all (e.g. a trial with no reward). */
  missingCount: number
  /** Assigns a value to a bin index, or null if it belongs to none. */
  assign(value: CellValue): number | null
}

function formatEdge(v: number): string {
  const rounded = Math.round(v * 1000) / 1000
  return String(rounded)
}

function defaultLabel(min: number, max: number, unit?: string): string {
  const u = unit ? ` ${unit}` : ''
  if (!Number.isFinite(min)) return `< ${formatEdge(max)}${u}`
  if (!Number.isFinite(max)) return `≥ ${formatEdge(min)}${u}`
  return `${formatEdge(min)}–${formatEdge(max)}${u}`
}

/** Ascending, de-duplicated finite numbers. */
function cleanEdges(edges: number[]): number[] {
  return [...new Set(edges.filter((e) => Number.isFinite(e)))].sort((a, b) => a - b)
}

/**
 * Drops cut points that could not contain any data, given unbounded outer bins.
 *
 * With boundaries `[-inf, e1, ..., ek, +inf]`, the first bin holds values `< e1` and is
 * empty when `e1 <= min`; the last holds values `>= ek` and is empty when `ek > max`. This
 * matters for tied data: a variable with one distinct value has every quantile equal to
 * that value, which would otherwise produce an empty bin below it. Only applied to derived
 * cut points — explicit custom edges are honoured as the user wrote them.
 */
function dropDegenerateEdges(edges: number[], min: number, max: number): number[] {
  return edges.filter((e) => e > min && e <= max)
}

/**
 * Cuts a continuous variable into labelled ranges so it can be used as a grouping
 * variable.
 *
 * This is what turns a measure like Correct Response Latency into an independent variable:
 * the user says "1–6 s, 7–12 s, over 12 s" and every trial is assigned to one of those
 * groups, which then works as the x-axis of a bar chart or the series of a line graph.
 *
 * Bins are half-open, `[min, max)`, so a value exactly on a boundary lands in the upper
 * bin and no value can be counted twice. With 'custom' edges the outer bins are unbounded
 * unless the user's edges already cover the data, so nothing is silently dropped; anything
 * that still falls outside is reported in `excludedCount`.
 */
export function computeBins(
  spec: BinSpec,
  rows: AnalysisRow[],
  unit?: string,
): BinResult {
  const numeric: number[] = []
  let missingCount = 0
  for (const row of rows) {
    const v = row.values[spec.variableKey]
    if (typeof v === 'number' && Number.isFinite(v)) numeric.push(v)
    else missingCount++
  }

  let boundaries: number[]

  if (spec.mode === 'custom') {
    // Unbounded outer bins: the user gives interior cut points only.
    boundaries = [Number.NEGATIVE_INFINITY, ...cleanEdges(spec.edges), Number.POSITIVE_INFINITY]
  } else if (numeric.length === 0) {
    boundaries = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
  } else if (spec.mode === 'equal-count') {
    // Quantile cut points: 4 bins -> quartiles. Duplicate and degenerate cut points are
    // dropped, so a heavily tied variable yields fewer bins rather than empty ones.
    const sorted = [...numeric].sort((a, b) => a - b)
    const interior: number[] = []
    for (let i = 1; i < spec.binCount; i++) {
      interior.push(quantileSorted(sorted, i / spec.binCount))
    }
    const usable = dropDegenerateEdges(cleanEdges(interior), sorted[0], sorted[sorted.length - 1])
    boundaries = [Number.NEGATIVE_INFINITY, ...usable, Number.POSITIVE_INFINITY]
  } else {
    const min = Math.min(...numeric)
    const max = Math.max(...numeric)
    const width = (max - min) / spec.binCount
    const interior: number[] = []
    for (let i = 1; i < spec.binCount; i++) interior.push(min + i * width)
    const usable = dropDegenerateEdges(cleanEdges(interior), min, max)
    boundaries = [Number.NEGATIVE_INFINITY, ...usable, Number.POSITIVE_INFINITY]
  }

  const bins: Bin[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const min = boundaries[i]
    const max = boundaries[i + 1]
    const override = spec.labels?.[i]
    bins.push({
      index: i,
      label: override && override.trim() !== '' ? override : defaultLabel(min, max, unit),
      min,
      max,
    })
  }

  let excludedCount = 0
  const assign = (value: CellValue): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    for (const bin of bins) {
      if (value >= bin.min && value < bin.max) return bin.index
    }
    return null
  }
  for (const v of numeric) {
    if (assign(v) === null) excludedCount++
  }

  return { bins, excludedCount, missingCount, assign }
}

/** Sensible starting point when a user first turns a variable into bins. */
export function defaultBinSpec(variableKey: string): BinSpec {
  return { variableKey, mode: 'equal-count', binCount: 4, edges: [] }
}

/** Derived key under which a binned variable's group label is stored on a row. */
export function binnedKey(variableKey: string): string {
  return `${variableKey}__bin`
}

/**
 * Writes a bin label onto each row under a derived key, so binned variables group exactly
 * like categorical ones downstream.
 *
 * Rows the bins could not accept — a trial with no reward has no reward latency — are
 * dropped rather than collected into an unlabelled group, because an empty category on the
 * x-axis of a figure reads as a real condition. Their count is reported separately by
 * `computeBins`, so nothing disappears silently.
 */
export function applyBins(
  rows: AnalysisRow[],
  spec: BinSpec,
  result: BinResult,
): AnalysisRow[] {
  const key = binnedKey(spec.variableKey)
  const out: AnalysisRow[] = []
  for (const row of rows) {
    const bin = result.assign(row.values[spec.variableKey])
    if (bin === null) continue
    out.push({ ...row, values: { ...row.values, [key]: result.bins[bin].label } })
  }
  return out
}

/**
 * Bin labels in bin order.
 *
 * Needed because bin labels are strings, and sorting them as text puts "≥ 12 s" before
 * "6–12 s". Grouping is told this order explicitly so ranges appear on an axis in the order
 * the user defined them.
 */
export function binLabelOrder(result: BinResult): string[] {
  return result.bins.map((b) => b.label)
}
