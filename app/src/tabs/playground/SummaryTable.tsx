import { aggregate, effectiveUnit, fmt, type AggregationUnit } from '../../analysis/aggregate'
import type { AnalysisRow } from '../../analysis/rows'
import { withBins } from '../../charts/buildFigure'
import type { ChartSpec } from '../../charts/spec'
import type { Registry } from '../../variables/registry'
import { axisTitle } from '../../variables/registry'

const UNIT_NOUN: Record<AggregationUnit, string> = {
  trial: 'trials',
  session: 'sessions',
  subject: 'rats',
}

/**
 * Descriptive statistics for the current selection.
 *
 * Always on screen beside the figure, not just when "Summary statistics" is the chosen
 * chart. Three of the light-mode series colours sit below 3:1 contrast against the chart
 * surface, and the rule for that is that the numbers must be readable somewhere that does
 * not depend on colour — this table is that place. It doubles as the check on whether a bar
 * you are about to publish rests on three rats or three hundred trials.
 */
export function SummaryTable({
  rows,
  spec,
  registry,
}: {
  rows: AnalysisRow[]
  spec: ChartSpec
  registry: Registry
}) {
  if (spec.measureKeys.length === 0) return null

  // Reuse the chart's own preparation, so the table always describes exactly what is plotted
  // — same binning, same dropped rows, same group ordering.
  const { rows: prepared, levelOrder } = withBins(rows, spec, registry)
  const groupingKeys = [spec.xKey, spec.seriesKey].filter((k): k is string => k !== null)
  const hasGrouping = groupingKeys.length > 0

  return (
    <div className="card" data-testid="summary-table">
      <div className="card-header">
        <h3>Summary statistics</h3>
        <span className="pill">one row per {UNIT_NOUN[spec.unit]}</span>
      </div>

      <div className="table-scroll" style={{ maxHeight: '26rem' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Measure</th>
              {hasGrouping && <th>Group</th>}
              <th className="numeric">n</th>
              <th className="numeric">Mean</th>
              <th className="numeric">SD</th>
              <th className="numeric">SEM</th>
              <th className="numeric">Median</th>
              <th className="numeric">Q1</th>
              <th className="numeric">Q3</th>
              <th className="numeric">IQR</th>
              <th className="numeric">Min</th>
              <th className="numeric">Max</th>
              <th className="numeric">Missing</th>
            </tr>
          </thead>
          <tbody>
            {spec.measureKeys.flatMap((measureKey) => {
              const def = registry.byKey.get(measureKey)
              const label = def
                ? effectiveUnit(def) === '%' && def.type === 'binary'
                  ? `${def.label} (%)`
                  : axisTitle(def)
                : measureKey

              return aggregate(prepared, measureKey, groupingKeys, spec.unit, registry, levelOrder).map(
                (cell) => (
                  <tr key={`${measureKey}:${cell.group.id}`}>
                    <td>{label}</td>
                    {hasGrouping && <td>{cell.group.label}</td>}
                    <td className="numeric">{cell.stats.n}</td>
                    <td className="numeric">{fmt(cell.stats.mean)}</td>
                    <td className="numeric">{fmt(cell.stats.sd)}</td>
                    <td className="numeric">{fmt(cell.stats.sem)}</td>
                    <td className="numeric">{fmt(cell.stats.median)}</td>
                    <td className="numeric">{fmt(cell.stats.q1)}</td>
                    <td className="numeric">{fmt(cell.stats.q3)}</td>
                    <td className="numeric">{fmt(cell.stats.iqr)}</td>
                    <td className="numeric">{fmt(cell.stats.min)}</td>
                    <td className="numeric">{fmt(cell.stats.max)}</td>
                    <td className={`numeric${cell.stats.missing === 0 ? ' empty' : ''}`}>
                      {cell.stats.missing}
                    </td>
                  </tr>
                ),
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="hint">
        SD and SEM are blank where a group holds a single observation — one value has no
        spread. &quot;Missing&quot; counts observations with no value for that measure, such as
        trials where no reward was collected; they are left out rather than counted as zero.
      </p>
    </div>
  )
}
