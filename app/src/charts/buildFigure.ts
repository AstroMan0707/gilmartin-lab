import {
  aggregate,
  collapseToUnit,
  combineFor,
  effectiveUnit,
  groupBy,
  type LevelOrder,
} from '../analysis/aggregate'
import { applyBins, binLabelOrder, computeBins } from '../analysis/binning'
import type { AnalysisRow } from '../analysis/rows'
import type { Registry, VariableDef } from '../variables/registry'
import { axisTitle } from '../variables/registry'
import type { ChartSpec } from './spec'
import { measuresLabel, resolveLabels } from './spec'
import {
  assignSeriesColours,
  axisStyle,
  baseLayout,
  exceedsColourCapacity,
  FONT_FAMILY,
  type ChartTheme,
} from './theme'

// Plotly's typings are broad; figures are plain data so `unknown`-keyed records are the
// honest shape here rather than a fabricated narrow type.
type PlotlyTrace = Record<string, unknown>
type PlotlyLayout = Record<string, unknown>

export interface Figure {
  data: PlotlyTrace[]
  layout: PlotlyLayout
  /** Rows behind the figure, offered as a CSV download so any figure is reproducible. */
  plottedValues: { columns: string[]; rows: (string | number | null)[][] }
  /** Messages to show beside the chart: dropped values, capacity limits, unit mixing. */
  notices: string[]
}

/**
 * Applies every bin spec the current selection uses, and reports the order its ranges should
 * appear in. Exported so the summary table describes exactly what the figure plots.
 */
export function withBins(
  rows: AnalysisRow[],
  spec: ChartSpec,
  registry: Registry,
): { rows: AnalysisRow[]; notices: string[]; levelOrder: LevelOrder } {
  const notices: string[] = []
  const levelOrder: LevelOrder = {}
  let out = rows

  const usedKeys = [spec.xKey, spec.seriesKey]
    .filter((k): k is string => k !== null && k.endsWith('__bin'))
    .map((k) => k.replace(/__bin$/, ''))

  for (const variableKey of usedKeys) {
    const binSpec = spec.bins[variableKey]
    if (!binSpec) continue
    const def = registry.byKey.get(variableKey)
    const result = computeBins(binSpec, out, effectiveUnit(def))
    out = applyBins(out, binSpec, result)
    levelOrder[binnedKeyOf(variableKey)] = binLabelOrder(result)

    if (result.missingCount > 0) {
      notices.push(
        `${result.missingCount} row(s) have no ${def?.label ?? variableKey} value and are left out of the grouping.`,
      )
    }
    if (result.excludedCount > 0) {
      notices.push(
        `${result.excludedCount} value(s) fall outside your ${def?.label ?? variableKey} ranges and are not shown.`,
      )
    }
  }

  return { rows: out, notices, levelOrder }
}

/** Local mirror of `binnedKey`, kept here to avoid a circular import. */
function binnedKeyOf(variableKey: string): string {
  return `${variableKey}__bin`
}

/** Distinct levels of a grouping variable across the unfiltered dataset. */
export function levelsOf(
  rows: AnalysisRow[],
  groupingKey: string,
  registry: Registry,
  levelOrder: LevelOrder = {},
): string[] {
  return groupBy(rows, [groupingKey], registry, levelOrder).map((g) => g.label)
}

/**
 * Mean ± SEM error bars. A group of one has no SEM, so it gets NaN, which Plotly skips.
 * Mapping it to 0 drew a flat cap that read as certainty, contradicting the notice that the
 * group has no error bar; null does the same, because Plotly converts it with `+null`.
 */
function errorBar(values: (number | null)[], theme: ChartTheme) {
  return {
    type: 'data' as const,
    array: values.map((v) => (v === null ? Number.NaN : v)),
    visible: true,
    color: theme.textSecondary,
    thickness: 1.5,
    width: 4,
  }
}

/**
 * Whisker ends for a box: the most extreme values within 1.5 × IQR of the quartiles, Tukey's
 * rule and the one Plotly applies to raw data. Computed here, from the summary table's own
 * quartiles, so the whiskers follow the same numbers as the box.
 */
export function tukeyFences(values: number[], q1: number, q3: number): { lower: number; upper: number } {
  const reach = 1.5 * (q3 - q1)
  const inside = values.filter((v) => v >= q1 - reach && v <= q3 + reach)
  return { lower: Math.min(...inside), upper: Math.max(...inside) }
}

/** Y-axis label for a measure, including its unit. */
function measureLabel(def: VariableDef | undefined): string {
  return def ? axisTitle(def) : ''
}

/**
 * Builds a Plotly figure from a chart spec.
 *
 * Two rules are enforced structurally rather than left to the user:
 *
 *  - **Never two y-scales on one plot.** Selecting measures with different units produces
 *    small multiples, one panel per measure, each with its own axis. A shared axis across
 *    seconds and percentages would invent a relationship that is not in the data.
 *  - **Never more than eight colour-coded series.** Beyond that, hues stop being
 *    distinguishable under colour-vision deficiency, so the chart drops to a single hue and
 *    says so, rather than cycling the palette and implying identities it cannot convey.
 */
export function buildFigure(
  allRows: AnalysisRow[],
  spec: ChartSpec,
  registry: Registry,
  theme: ChartTheme,
): Figure {
  const { rows, notices, levelOrder } = withBins(allRows, spec, registry)

  const measureDefs = spec.measureKeys.map((k) => registry.byKey.get(k))
  const units = new Set(measureDefs.map((d) => effectiveUnit(d) ?? ''))
  const needsPanels = spec.measureKeys.length > 1

  if (needsPanels && units.size > 1) {
    notices.push(
      'The measures you selected use different units, so each is drawn in its own panel with its own axis. Two scales on one axis would suggest a relationship that is not in the data.',
    )
  }

  /*
   * A measure recorded once per session cannot be broken down by something that varies within
   * a session — there is no value to break down. Rather than drawing an empty figure, say so
   * and name a measure that would work. Percent correct is exempt because it is defined at
   * both levels; the rest of the End Summary values genuinely are not.
   */
  const groupingKeys = [spec.xKey, spec.seriesKey].filter((k): k is string => k !== null)
  const trialLevelGrouping = groupingKeys.some(
    (k) => registry.byKey.get(k.replace(/__bin$/, ''))?.level === 'trial',
  )
  for (const key of spec.measureKeys) {
    if (rows.some((r) => typeof r.values[key] === 'number')) continue
    const def = registry.byKey.get(key)
    notices.push(
      trialLevelGrouping
        ? `${def?.label ?? key} is recorded once per session, so it cannot be broken down by a measure that varies within a session. Try Percent Correct or a latency, or group by something session-level such as Genotype.`
        : `${def?.label ?? key} has no values in the data you loaded, so there is nothing to plot for it.`,
    )
  }

  if (spec.seriesKey) {
    const levelCount = levelsOf(rows, spec.seriesKey, registry, levelOrder).length
    if (exceedsColourCapacity(levelCount)) {
      notices.push(
        `${levelCount} series is too many to tell apart by colour, so they are all drawn in one hue. Use a grouping with fewer levels, or set ${registry.byKey.get(spec.seriesKey.replace(/__bin$/, ''))?.label ?? 'it'} as the x-axis instead.`,
      )
    }
  }

  switch (spec.type) {
    case 'histogram':
      return buildHistogram(rows, spec, registry, theme, notices, levelOrder)
    case 'bar':
      return buildBarOrBox(rows, spec, registry, theme, notices, levelOrder, 'bar')
    case 'box':
      return buildBarOrBox(rows, spec, registry, theme, notices, levelOrder, 'box')
    case 'line':
      return buildLine(rows, spec, registry, theme, notices, levelOrder)
    default:
      // 'summary' is a table, not a figure; the panel renders it directly.
      return { data: [], layout: {}, plottedValues: { columns: [], rows: [] }, notices }
  }
}

// --------------------------------------------------------------------------------------
// Histogram
// --------------------------------------------------------------------------------------

function buildHistogram(
  rows: AnalysisRow[],
  spec: ChartSpec,
  registry: Registry,
  theme: ChartTheme,
  notices: string[],
  levelOrder: LevelOrder,
): Figure {
  const measureKey = spec.measureKeys[0]
  const def = registry.byKey.get(measureKey)
  const labels = resolveLabels(spec, registry, measureLabel(def))

  const groupingKeys = spec.xKey ? [spec.xKey] : []
  const groups = groupBy(rows, groupingKeys, registry, levelOrder)
  const allLevels = spec.xKey ? levelsOf(rows, spec.xKey, registry, levelOrder) : ['All data']
  const colours = assignSeriesColours(groups.map((g) => g.label), allLevels, theme)

  const data: PlotlyTrace[] = []
  const csvRows: (string | number | null)[][] = []

  groups.forEach((group) => {
    const values = collapseToUnit(
      group.rows,
      measureKey,
      spec.unit,
      combineFor(def),
    ).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

    data.push({
      type: 'histogram',
      name: group.label,
      x: values,
      nbinsx: spec.histogramBins,
      marker: {
        color: colours.get(group.label),
        // A hairline of surface between bins reads as separation without drawing borders.
        line: { color: theme.surface, width: 1 },
      },
      opacity: groups.length > 1 ? 0.72 : 1,
      hovertemplate: `${group.label}<br>${labels.xLabel || labels.yLabel}: %{x}<br>Count: %{y}<extra></extra>`,
    })

    for (const v of values) csvRows.push([group.label, v])
  })

  const layout: PlotlyLayout = {
    ...baseLayout(theme),
    title: { ...baseLayout(theme).title, text: labels.title },
    xaxis: { ...axisStyle(theme), title: { text: measureLabel(def) } },
    yaxis: { ...axisStyle(theme), title: { text: 'Number of observations' } },
    // Overlaid rather than stacked: stacking would misrepresent each group's own shape.
    barmode: 'overlay',
    showlegend: groups.length > 1,
  }

  if (groups.length > 1) {
    notices.push('Distributions are overlaid so each group keeps its own shape.')
  }

  return {
    data,
    layout,
    plottedValues: { columns: ['Group', measureLabel(def)], rows: csvRows },
    notices,
  }
}

// --------------------------------------------------------------------------------------
// Bar and box
// --------------------------------------------------------------------------------------

function buildBarOrBox(
  rows: AnalysisRow[],
  spec: ChartSpec,
  registry: Registry,
  theme: ChartTheme,
  notices: string[],
  levelOrder: LevelOrder,
  kind: 'bar' | 'box',
): Figure {
  const panels = spec.measureKeys
  const multiPanel = panels.length > 1
  const data: PlotlyTrace[] = []
  const csvColumns = ['Measure', 'Group', 'Series', 'n', 'Mean', 'SD', 'SEM', 'Median', 'Q1', 'Q3']
  const csvRows: (string | number | null)[][] = []

  const seriesLevels = spec.seriesKey ? levelsOf(rows, spec.seriesKey, registry, levelOrder) : ['']
  const colours = assignSeriesColours(seriesLevels, seriesLevels, theme)

  const xKey = spec.xKey as string
  const xLevels = levelsOf(rows, xKey, registry, levelOrder)

  panels.forEach((measureKey, panelIndex) => {
    const def = registry.byKey.get(measureKey)
    const axisSuffix = panelIndex === 0 ? '' : String(panelIndex + 1)

    const seriesGroups = spec.seriesKey
      ? groupBy(rows, [spec.seriesKey], registry, levelOrder)
      : [{ id: '', key: [], label: '', rows }]

    for (const seriesGroup of seriesGroups) {
      const cells = aggregate(seriesGroup.rows, measureKey, [xKey], spec.unit, registry, levelOrder)
      const colour = colours.get(seriesGroup.label) ?? theme.series[0]
      // Legend entries are shared across panels, so only the first panel registers them.
      const legendName = seriesGroup.label || (def?.label ?? measureKey)

      if (kind === 'bar') {
        data.push({
          type: 'bar',
          name: legendName,
          legendgroup: seriesGroup.label,
          showlegend: panelIndex === 0 && seriesGroups.length > 1,
          x: cells.map((c) => c.group.label),
          y: cells.map((c) => c.stats.mean),
          error_y: spec.showErrorBars ? errorBar(cells.map((c) => c.stats.sem), theme) : undefined,
          marker: {
            color: colour,
            // 4px rounded data-ends, anchored to the baseline.
            cornerradius: 4,
            line: { color: theme.surface, width: 1 },
          },
          text: spec.showValues
            ? cells.map((c) => (c.stats.mean === null ? '' : c.stats.mean.toFixed(1)))
            : undefined,
          textposition: spec.showValues ? 'outside' : undefined,
          textfont: spec.showValues ? { color: theme.textSecondary, family: FONT_FAMILY } : undefined,
          xaxis: `x${axisSuffix}`,
          yaxis: `y${axisSuffix}`,
          hovertemplate:
            `${seriesGroup.label ? `${seriesGroup.label}<br>` : ''}%{x}<br>${measureLabel(def)}: %{y:.3f}` +
            (spec.showErrorBars ? ' ± %{error_y.array:.3f} SEM' : '') +
            '<extra></extra>',
        })
      } else {
        /*
         * Each box is drawn from the summary table's own median and quartiles rather than left
         * for Plotly to compute. Plotly's quartile methods all differ from the table's (R's
         * default, as Excel's QUARTILE.INC and numpy use), so the drawn box disagreed with the
         * numbers printed beneath it. The group's values still go in, as an inner array, so the
         * individual points are drawn beside the box.
         */
        let legendShown = false
        for (const cell of cells) {
          const { q1, median, q3, values } = cell.stats
          // A group with no values has no box to draw.
          if (q1 === null || median === null || q3 === null) continue
          const fences = tukeyFences(values, q1, q3)
          const showlegend = panelIndex === 0 && seriesGroups.length > 1 && !legendShown
          legendShown = true
          data.push({
            type: 'box',
            name: seriesGroup.label || (def?.label ?? measureKey),
            legendgroup: seriesGroup.label,
            showlegend,
            x: [cell.group.label],
            q1: [q1],
            median: [median],
            q3: [q3],
            lowerfence: [fences.lower],
            upperfence: [fences.upper],
            y: [values],
            marker: { color: colour, size: 6, opacity: 0.75 },
            line: { color: colour, width: 1.5 },
            fillcolor: 'rgba(0,0,0,0)',
            // Show every point beside the box: with a handful of rats per group, hiding
            // the raw values behind a summary shape loses most of the information.
            boxpoints: cell.stats.n <= 30 ? 'all' : 'outliers',
            jitter: 0.4,
            pointpos: 0,
            xaxis: `x${axisSuffix}`,
            yaxis: `y${axisSuffix}`,
            hovertemplate: `${seriesGroup.label ? `${seriesGroup.label}<br>` : ''}%{x}<br>${measureLabel(def)}: %{y:.3f}<extra></extra>`,
          })
        }
      }

      for (const cell of cells) {
        csvRows.push([
          def?.label ?? measureKey,
          cell.group.label,
          seriesGroup.label || null,
          cell.stats.n,
          cell.stats.mean,
          cell.stats.sd,
          cell.stats.sem,
          cell.stats.median,
          cell.stats.q1,
          cell.stats.q3,
        ])
      }
    }
  })

  const labels = resolveLabels(
    spec,
    registry,
    multiPanel ? measuresLabel(spec, registry) : measureLabel(registry.byKey.get(panels[0])),
  )
  const layout = panelLayout(panels, spec, registry, theme, labels, xLevels)
  if (kind === 'box') layout.boxmode = spec.seriesKey ? 'group' : 'overlay'
  else layout.barmode = 'group'

  const singleObs = csvRows.filter((r) => r[3] === 1).length
  if (singleObs > 0 && spec.showErrorBars) {
    notices.push(
      `${singleObs} group(s) contain a single observation, so they have no error bar. Check the summary table for group sizes.`,
    )
  }

  return { data, layout, plottedValues: { columns: csvColumns, rows: csvRows }, notices }
}

// --------------------------------------------------------------------------------------
// Line
// --------------------------------------------------------------------------------------

function buildLine(
  rows: AnalysisRow[],
  spec: ChartSpec,
  registry: Registry,
  theme: ChartTheme,
  notices: string[],
  levelOrder: LevelOrder,
): Figure {
  const panels = spec.measureKeys
  const multiPanel = panels.length > 1
  const data: PlotlyTrace[] = []
  const csvColumns = ['Measure', 'X', 'Series', 'n', 'Mean', 'SEM']
  const csvRows: (string | number | null)[][] = []

  const xKey = spec.xKey as string
  const xLevels = levelsOf(rows, xKey, registry, levelOrder)
  const seriesLevels = spec.seriesKey ? levelsOf(rows, spec.seriesKey, registry, levelOrder) : ['']
  const colours = assignSeriesColours(seriesLevels, seriesLevels, theme)

  panels.forEach((measureKey, panelIndex) => {
    const def = registry.byKey.get(measureKey)
    const axisSuffix = panelIndex === 0 ? '' : String(panelIndex + 1)

    const seriesGroups = spec.seriesKey
      ? groupBy(rows, [spec.seriesKey], registry, levelOrder)
      : [{ id: '', key: [], label: '', rows }]

    for (const seriesGroup of seriesGroups) {
      const cells = aggregate(seriesGroup.rows, measureKey, [xKey], spec.unit, registry, levelOrder)
      const colour = colours.get(seriesGroup.label) ?? theme.series[0]
      const name = seriesGroup.label || (def?.label ?? measureKey)

      // Every line runs over the whole x-axis, with null where this series has no data. Listing
      // only the levels the series has made Plotly join, say, session 1 straight to session 3,
      // since it never saw session 2 was missing; a null is what `connectgaps: false` breaks on.
      const byLevel = new Map(cells.map((c) => [c.group.label, c.stats]))
      const means = xLevels.map((level) => byLevel.get(level)?.mean ?? null)
      const sems = xLevels.map((level) => byLevel.get(level)?.sem ?? null)

      data.push({
        type: 'scatter',
        mode: 'lines+markers',
        name,
        legendgroup: seriesGroup.label,
        showlegend: panelIndex === 0 && seriesGroups.length > 1,
        x: xLevels,
        y: means,
        error_y: spec.showErrorBars ? errorBar(sems, theme) : undefined,
        line: { color: colour, width: 2 },
        marker: {
          color: colour,
          size: 8,
          // A ring of surface colour where markers overlap, instead of a border.
          line: { color: theme.surface, width: 2 },
        },
        // Gaps stay gaps: a missing session is not bridged by a straight line implying data we
        // do not have.
        connectgaps: false,
        xaxis: `x${axisSuffix}`,
        yaxis: `y${axisSuffix}`,
        hovertemplate:
          `${seriesGroup.label ? `${seriesGroup.label}<br>` : ''}%{x}<br>${measureLabel(def)}: %{y:.3f}` +
          (spec.showErrorBars ? ' ± %{error_y.array:.3f} SEM' : '') +
          '<extra></extra>',
      })

      for (const cell of cells) {
        csvRows.push([
          def?.label ?? measureKey,
          cell.group.label,
          seriesGroup.label || null,
          cell.stats.n,
          cell.stats.mean,
          cell.stats.sem,
        ])
      }
    }
  })

  const labels = resolveLabels(
    spec,
    registry,
    multiPanel ? measuresLabel(spec, registry) : measureLabel(registry.byKey.get(panels[0])),
  )
  const layout = panelLayout(panels, spec, registry, theme, labels, xLevels)

  return { data, layout, plottedValues: { columns: csvColumns, rows: csvRows }, notices }
}

// --------------------------------------------------------------------------------------
// Shared layout, including small multiples
// --------------------------------------------------------------------------------------

/**
 * Builds the layout, stacking one panel per measure when several are selected.
 *
 * Panels share the x-axis and each keeps its own y-axis, which is what makes it safe to
 * show measures with different units together.
 */
function panelLayout(
  panels: string[],
  spec: ChartSpec,
  registry: Registry,
  theme: ChartTheme,
  labels: { title: string; xLabel: string; yLabel: string },
  xLevels: string[],
): PlotlyLayout {
  const base = baseLayout(theme)
  const layout: PlotlyLayout = {
    ...base,
    title: { ...base.title, text: labels.title },
    showlegend: spec.seriesKey !== null,
  }

  const n = panels.length
  const gap = 0.1
  const panelHeight = n === 1 ? 1 : (1 - gap * (n - 1)) / n

  panels.forEach((measureKey, i) => {
    const suffix = i === 0 ? '' : String(i + 1)
    const def = registry.byKey.get(measureKey)
    // Panels read top-to-bottom in selection order, so domains are built from the top.
    const top = 1 - i * (panelHeight + gap)
    const bottom = top - panelHeight

    layout[`yaxis${suffix}`] = {
      ...axisStyle(theme),
      title: { text: n === 1 ? labels.yLabel : measureLabel(def) },
      domain: [Math.max(0, bottom), top],
    }
    layout[`xaxis${suffix}`] = {
      ...axisStyle(theme),
      // Only the bottom panel carries the x-axis title, and category order is fixed by the
      // grouping so panels stay aligned.
      title: { text: i === n - 1 ? labels.xLabel : '' },
      showticklabels: i === n - 1,
      // A vertical line at each bar or box reads as an error bar. Lines keep them, where they
      // help read a value across.
      showgrid: spec.type === 'line',
      type: 'category',
      categoryorder: 'array',
      categoryarray: xLevels,
      anchor: `y${suffix}`,
      matches: i === 0 ? undefined : 'x',
    }
  })

  // Taller canvas when panels are stacked, so each keeps a usable plot area.
  if (n > 1) layout.height = Math.min(260 * n + 80, 1200)

  return layout
}

/** Plotly config: SVG rendering, and the modebar trimmed to what a non-programmer needs. */
export function plotlyConfig() {
  return {
    displaylogo: false,
    responsive: true,
    // Export is handled by the app's own high-resolution exporter, so Plotly's low-res
    // camera button is removed to avoid users grabbing a 96 DPI screenshot by mistake.
    modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d'] as string[],
    scrollZoom: false,
  }
}
