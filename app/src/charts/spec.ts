import type { AggregationUnit } from '../analysis/aggregate'
import type { BinSpec } from '../analysis/binning'
import type { Registry, VariableDef } from '../variables/registry'

export type ChartType =
  | 'summary'
  | 'histogram'
  | 'bar'
  | 'box'
  | 'line'

export interface ChartTypeInfo {
  type: ChartType
  label: string
  /** Why this chart suits the current selection. Shown under the chart-type buttons. */
  hint: string
}

export const CHART_LABELS: Record<ChartType, string> = {
  summary: 'Summary statistics',
  histogram: 'Histogram',
  bar: 'Bar chart',
  box: 'Box plot',
  line: 'Line graph',
}

export interface ChartSpec {
  type: ChartType
  /** Dependent variables to plot. More than one produces small multiples. */
  measureKeys: string[]
  /** Grouping variable for the x-axis. `null` means "all data in one group". */
  xKey: string | null
  /** Second grouping variable, drawn as colour-coded series. */
  seriesKey: string | null
  unit: AggregationUnit
  /** Bin definitions for continuous variables used as groupings, keyed by variable key. */
  bins: Record<string, BinSpec>
  /** Histogram bin count, when the histogram is not using a custom bin spec. */
  histogramBins: number
  /** Draw mean ± SEM error bars on bars and lines. */
  showErrorBars: boolean
  /** Print the value at each bar end. Off by default: a number on every mark is noise. */
  showValues: boolean
  title: string
  xLabel: string
  yLabel: string
}

export function defaultSpec(): ChartSpec {
  return {
    type: 'summary',
    measureKeys: [],
    xKey: null,
    seriesKey: null,
    unit: 'subject',
    bins: {},
    histogramBins: 20,
    showErrorBars: true,
    showValues: false,
    title: '',
    xLabel: '',
    yLabel: '',
  }
}

/** A grouping variable is "ordered" if a line between its values means anything. */
export function isOrderedGrouping(def: VariableDef | undefined): boolean {
  return def?.ordered === true
}

/**
 * Works out which chart types make sense for the current selection.
 *
 * The rules follow from what each form can honestly show. With no grouping variable there
 * is one distribution, so a histogram or a statistics table is all that is available. Add
 * a categorical grouping and comparing group averages becomes meaningful, which is a bar
 * or a box. A line is only offered when the x-axis has a real order — joining WT to AD
 * with a line would imply a progression that does not exist.
 */
export function availableChartTypes(
  spec: ChartSpec,
  registry: Registry,
): ChartTypeInfo[] {
  const out: ChartTypeInfo[] = []
  if (spec.measureKeys.length === 0) return out

  const multiMeasure = spec.measureKeys.length > 1
  const xDef = spec.xKey ? registry.byKey.get(spec.xKey.replace(/__bin$/, '')) : undefined
  const binnedX = spec.xKey?.endsWith('__bin') ?? false
  const hasGrouping = spec.xKey !== null

  out.push({
    type: 'summary',
    label: CHART_LABELS.summary,
    hint: hasGrouping
      ? 'Mean, SD, SEM, median and quartiles for each group.'
      : 'Mean, SD, SEM, median and quartiles for the selected measure.',
  })

  if (!multiMeasure) {
    out.push({
      type: 'histogram',
      label: CHART_LABELS.histogram,
      hint: hasGrouping
        ? 'The shape of the distribution, one panel per group.'
        : 'The shape of the distribution.',
    })
  }

  if (hasGrouping) {
    out.push({
      type: 'bar',
      label: CHART_LABELS.bar,
      hint: 'Group averages with error bars. Good for comparing conditions.',
    })
    out.push({
      type: 'box',
      label: CHART_LABELS.box,
      hint: 'Median, quartiles and spread. Shows the distribution a bar chart hides.',
    })

    // A line implies "these points are on a continuum". Only offer it when they are.
    if (binnedX || isOrderedGrouping(xDef)) {
      out.push({
        type: 'line',
        label: CHART_LABELS.line,
        hint: multiMeasure
          ? `Change across ${xDef?.label ?? 'the x-axis'}, one panel per measure.`
          : `Change across ${xDef?.label ?? 'the x-axis'}. Use this for longitudinal data.`,
      })
    }
  }

  return out
}

/** Explains why a chart type the user might expect is unavailable. */
export function unavailableReason(
  type: ChartType,
  spec: ChartSpec,
  registry: Registry,
): string | null {
  if (spec.measureKeys.length === 0) return 'Choose a measure to analyse first.'
  if (availableChartTypes(spec, registry).some((t) => t.type === type)) return null

  switch (type) {
    case 'bar':
    case 'box':
      return 'Choose a grouping variable for the x-axis to compare groups.'
    case 'line': {
      if (!spec.xKey) return 'Choose an ordered x-axis, such as Session Number or Separation Distance.'
      const def = registry.byKey.get(spec.xKey.replace(/__bin$/, ''))
      return `${def?.label ?? 'This variable'} has no natural order, so joining its values with a line would imply a progression that is not there. Use a bar chart or box plot instead.`
    }
    case 'histogram':
      return 'Histograms show one measure at a time. Select a single measure.'
    default:
      return null
  }
}

/** Fills in axis titles and a title from the selection, unless the user overrode them. */
export function resolveLabels(
  spec: ChartSpec,
  registry: Registry,
  fallbackY: string,
): { title: string; xLabel: string; yLabel: string } {
  const xDef = spec.xKey ? registry.byKey.get(spec.xKey.replace(/__bin$/, '')) : undefined
  const seriesDef = spec.seriesKey
    ? registry.byKey.get(spec.seriesKey.replace(/__bin$/, ''))
    : undefined

  const autoX = spec.xKey
    ? xDef?.unit && !spec.xKey.endsWith('__bin')
      ? `${xDef.label} (${xDef.unit})`
      : (xDef?.label ?? '')
    : ''

  const parts: string[] = [fallbackY]
  if (xDef) parts.push(`by ${xDef.label}`)
  if (seriesDef) parts.push(`and ${seriesDef.label}`)

  return {
    title: spec.title || parts.join(' '),
    xLabel: spec.xLabel || autoX,
    yLabel: spec.yLabel || fallbackY,
  }
}
