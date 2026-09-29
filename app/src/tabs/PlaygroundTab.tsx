import { useMemo } from 'react'
import {
  AGGREGATION_DESCRIPTIONS,
  AGGREGATION_LABELS,
  type AggregationUnit,
} from '../analysis/aggregate'
import { buildFigure, plotlyConfig } from '../charts/buildFigure'
import {
  availableChartTypes,
  CHART_LABELS,
  HISTOGRAM_BINS_MAX,
  HISTOGRAM_BINS_MIN,
  measuresLabel,
  resolveLabels,
  unavailableReason,
  type ChartType,
} from '../charts/spec'
import { getTheme, PRINT_THEME } from '../charts/theme'
import { Notice } from '../components/Notice'
import { PlotlyChart } from '../components/PlotlyChart'
import { useAppStore } from '../store/useAppStore'
import type { Dataset } from '../types'
import { axisTitle, type Registry } from '../variables/registry'
import { BinEditor } from './playground/BinEditor'
import { ExportPanel } from './playground/ExportPanel'
import { PresetPanel } from './playground/PresetPanel'
import { SummaryTable } from './playground/SummaryTable'
import { VariableRail } from './playground/VariableRail'

const ALL_CHART_TYPES: ChartType[] = ['summary', 'histogram', 'bar', 'box', 'line']

/**
 * Guard component.
 *
 * The data check lives here rather than inside `Playground` so that the hooks below it are
 * never skipped — an early return above a `useMemo` changes the hook count between renders,
 * which React treats as a fatal error.
 */
export function PlaygroundTab() {
  const { dataset, registry } = useAppStore()

  if (!dataset || !registry) {
    return (
      <div className="card empty-state">
        <h2>No data yet</h2>
        <p>Load your session files on the Load data tab, then come back here to explore them.</p>
      </div>
    )
  }

  return <Playground dataset={dataset} registry={registry} />
}

function Playground({ dataset, registry }: { dataset: Dataset; registry: Registry }) {
  const {
    spec,
    theme,
    updateSpec,
    resetSpec,
    includeCorrectionTrials,
    setIncludeCorrectionTrials,
    trialRows,
    sessionRows,
  } = useAppStore()


  /**
   * Trial-level rows carry session metadata too, so they can serve any selection. Session
   * rows are used when nothing trial-level is involved, which keeps per-session measures such
   * as ABET's own End Summary figures available and keeps the row count small.
   */
  const rows = useMemo(() => {
    const isTrialLevel = (key: string | null) =>
      key !== null && registry.byKey.get(key.replace(/__bin$/, ''))?.level === 'trial'

    const needsTrialRows =
      isTrialLevel(spec.xKey) ||
      isTrialLevel(spec.seriesKey) ||
      spec.measureKeys.some((k) => registry.byKey.get(k)?.level === 'trial')

    return needsTrialRows ? trialRows() : sessionRows()
    // `dataset` and `includeCorrectionTrials` are what make the row builders return
    // something new; the builders themselves memoise on exactly those.
  }, [spec.xKey, spec.seriesKey, spec.measureKeys, registry, trialRows, sessionRows, dataset, includeCorrectionTrials])

  const chartTypes = useMemo(() => availableChartTypes(spec, registry), [spec, registry])
  const activeType: ChartType = chartTypes.some((t) => t.type === spec.type) ? spec.type : 'summary'

  const figure = useMemo(() => {
    if (spec.measureKeys.length === 0 || activeType === 'summary') return null
    return buildFigure(rows, { ...spec, type: activeType }, registry, getTheme(theme))
  }, [rows, spec, activeType, registry, theme])

  const config = useMemo(() => plotlyConfig(), [])

  // Exports are rebuilt in the print theme on demand, so dark mode costs nothing until the
  // user downloads. Null when nothing is drawn, which is what disables the download button;
  // it used to hang on to the last graph even after the chart was cleared.
  const buildPrintFigure = useMemo(() => {
    if (!figure || figure.data.length === 0) return null
    return () => buildFigure(rows, { ...spec, type: activeType }, registry, PRINT_THEME)
  }, [figure, rows, spec, activeType, registry])

  const primaryDef = registry.byKey.get(spec.measureKeys[0] ?? '')
  const labels = resolveLabels(
    spec,
    registry,
    spec.measureKeys.length > 1
      ? measuresLabel(spec, registry)
      : primaryDef
        ? axisTitle(primaryDef)
        : '',
  )

  // Bin editors for whichever continuous variables are currently doing the grouping.
  const binEditors = [spec.xKey, spec.seriesKey]
    .filter((k): k is string => k !== null && k.endsWith('__bin'))
    .map((k) => k.replace(/__bin$/, ''))
    .filter((key, i, all) => all.indexOf(key) === i)

  const hasMeasures = spec.measureKeys.length > 0

  return (
    <div className="playground">
      <div className="rail">
        <VariableRail />
      </div>

      <div className="chart-area">
        <div className="card">
          <div className="card-header">
            {/* The figure carries its own title, since that is what gets exported; repeating it
                here would print it twice on screen. */}
            <h2>{hasMeasures ? 'Figure' : 'Visualisation playground'}</h2>
            <label className="check small" title={AGGREGATION_DESCRIPTIONS[spec.unit]}>
              Each point is
              <select
                value={spec.unit}
                onChange={(e) => updateSpec({ unit: e.target.value as AggregationUnit })}
              >
                {(Object.keys(AGGREGATION_LABELS) as AggregationUnit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {AGGREGATION_LABELS[unit]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!hasMeasures ? (
            <div className="empty-state">
              <h2>Pick a measure to begin</h2>
              <p>
                Click a measure on the left — <strong>Percent Correct</strong> is a good place to
                start. Then choose something to group it by, such as Genotype or Separation
                Distance.
              </p>
            </div>
          ) : (
            <>
              <p className="secondary small">{AGGREGATION_DESCRIPTIONS[spec.unit]}</p>

              {figure?.notices.map((notice, i) => (
                <Notice key={i} tone="info">
                  {notice}
                </Notice>
              ))}

              {figure && figure.data.length > 0 && (
                <PlotlyChart
                  className="plot"
                  data={figure.data}
                  layout={figure.layout}
                  config={config}
                />
              )}

              {figure && figure.data.length === 0 && (
                <div className="empty-state">
                  <p>
                    There is nothing to plot with the current selection. Try a different measure or
                    grouping.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {hasMeasures && (
          <SummaryTable rows={rows} spec={{ ...spec, type: activeType }} registry={registry} />
        )}
      </div>

      {/* In the order the work is done: pick a chart, adjust it, export it; presets last. */}
      <div className="rail">
        <div className="card" data-testid="chart-types">
          <div className="card-header">
            <h3>Chart type</h3>
          </div>
          {!hasMeasures ? (
            <p className="muted small">Choose a measure first.</p>
          ) : (
            <div className="chart-type-list">
              {ALL_CHART_TYPES.map((type) => {
                const available = chartTypes.find((t) => t.type === type)
                if (!available) {
                  const reason = unavailableReason(type, spec, registry)
                  return (
                    <button
                      key={type}
                      type="button"
                      className="chart-type"
                      disabled
                      style={{ opacity: 0.55, cursor: 'not-allowed' }}
                    >
                      <strong>{CHART_LABELS[type]}</strong>
                      <span>{reason}</span>
                    </button>
                  )
                }
                return (
                  <button
                    key={type}
                    type="button"
                    className="chart-type"
                    aria-pressed={activeType === type}
                    onClick={() => updateSpec({ type })}
                  >
                    <strong>{available.label}</strong>
                    <span>{available.hint}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {binEditors.map((variableKey) => {
          const def = registry.byKey.get(variableKey)
          if (!def) return null
          return <BinEditor key={variableKey} variableKey={variableKey} def={def} rows={rows} />
        })}

        <div className="card">
          <div className="card-header">
            <h3>Options</h3>
          </div>
          <div className="bin-editor">
            <label className="check">
              <input
                type="checkbox"
                checked={includeCorrectionTrials}
                onChange={(e) => setIncludeCorrectionTrials(e.target.checked)}
              />
              Include correction trials
            </label>
            <p className="hint" style={{ marginTop: 0 }}>
              Off by default. Correction trials are repeat attempts after an error; leaving them
              out makes accuracy match how ABET reports it. Turn them on to study perseveration.
            </p>

            {(activeType === 'bar' || activeType === 'line') && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={spec.showErrorBars}
                  onChange={(e) => updateSpec({ showErrorBars: e.target.checked })}
                />
                Show error bars (mean ± SEM)
              </label>
            )}

            {activeType === 'bar' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={spec.showValues}
                  onChange={(e) => updateSpec({ showValues: e.target.checked })}
                />
                Print values on the bars
              </label>
            )}

            {activeType === 'histogram' && (
              <label className="field">
                Number of bars
                <input
                  type="number"
                  min={HISTOGRAM_BINS_MIN}
                  max={HISTOGRAM_BINS_MAX}
                  value={spec.histogramBins}
                  onChange={(e) =>
                    updateSpec({
                      histogramBins: Math.max(
                        HISTOGRAM_BINS_MIN,
                        Math.min(HISTOGRAM_BINS_MAX, Number(e.target.value) || 20),
                      ),
                    })
                  }
                />
              </label>
            )}

            <div className="divider" style={{ margin: '0.25rem 0' }} />

            <label className="field">
              Title
              <input
                type="text"
                value={spec.title}
                placeholder={labels.title}
                onChange={(e) => updateSpec({ title: e.target.value })}
              />
            </label>
            <label className="field">
              x-axis label
              <input
                type="text"
                value={spec.xLabel}
                placeholder={labels.xLabel}
                onChange={(e) => updateSpec({ xLabel: e.target.value })}
              />
            </label>
            <label className="field">
              y-axis label
              <input
                type="text"
                value={spec.yLabel}
                placeholder={labels.yLabel}
                onChange={(e) => updateSpec({ yLabel: e.target.value })}
              />
            </label>

            <button className="btn btn-quiet" onClick={resetSpec}>
              Reset chart settings
            </button>
          </div>
        </div>

        {activeType !== 'summary' && (
          <ExportPanel
            buildPrintFigure={buildPrintFigure}
            plottedValues={figure?.plottedValues ?? { columns: [], rows: [] }}
            suggestedName={labels.title || 'figure'}
          />
        )}

        <PresetPanel registry={registry} />
      </div>
    </div>
  )
}

// Default export so App can lazy-load this tab: it pulls in Plotly, by far the largest
// chunk, and a user still on the Load screen has no need of it yet.
export default PlaygroundTab
