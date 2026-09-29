import {
  BIN_COUNT_MAX,
  BIN_COUNT_MIN,
  computeBins,
  type BinMode,
  type BinSpec,
} from '../../analysis/binning'
import type { AnalysisRow } from '../../analysis/rows'
import { effectiveUnit } from '../../analysis/aggregate'
import { useAppStore } from '../../store/useAppStore'
import type { VariableDef } from '../../variables/registry'

const MODE_LABELS: Record<BinMode, string> = {
  'equal-count': 'Equal number of observations',
  'equal-width': 'Equal-width ranges',
  custom: 'My own ranges',
}

const MODE_HINTS: Record<BinMode, string> = {
  'equal-count':
    'Splits at quantiles, so each group holds about the same number of observations. Four bins gives quartiles.',
  'equal-width': 'Splits the range from lowest to highest into equally wide bands.',
  custom: 'Type the cut points yourself. The lowest and highest groups are open-ended.',
}

/**
 * Editor for turning a continuous variable into grouping ranges.
 *
 * This is what lets a latency act as an independent variable: the user says where the cuts
 * go — 6 s and 12 s, for instance — and every trial is assigned to "under 6 s", "6–12 s" or
 * "12 s and over", which then works as an x-axis or a series.
 */
export function BinEditor({
  variableKey,
  def,
  rows,
}: {
  variableKey: string
  def: VariableDef
  rows: AnalysisRow[]
}) {
  const { spec, updateSpec } = useAppStore()
  const binSpec: BinSpec = spec.bins[variableKey] ?? {
    variableKey,
    mode: 'equal-count',
    binCount: 4,
    edges: [],
  }

  const unit = effectiveUnit(def)
  const result = computeBins(binSpec, rows, unit)

  const update = (patch: Partial<BinSpec>) => {
    updateSpec({ bins: { ...spec.bins, [variableKey]: { ...binSpec, ...patch } } })
  }

  const setEdge = (index: number, value: string) => {
    const parsed = Number(value)
    const edges = [...binSpec.edges]
    edges[index] = Number.isFinite(parsed) ? parsed : Number.NaN
    update({ edges })
  }

  // Group sizes, so the user can see immediately if a range came out empty.
  const counts = new Map<number, number>()
  for (const row of rows) {
    const index = result.assign(row.values[variableKey])
    if (index !== null) counts.set(index, (counts.get(index) ?? 0) + 1)
  }

  return (
    <div className="card" data-testid="bin-editor">
      <div className="card-header">
        <h3>{def.label} ranges</h3>
      </div>

      <p className="secondary small">
        {def.label} is a number, so it needs to be cut into ranges before it can group
        anything.
      </p>

      <div className="bin-editor">
        <label className="field">
          How to split
          <select
            value={binSpec.mode}
            onChange={(e) => {
              const mode = e.target.value as BinMode
              // Switching to custom with no cut points yet would collapse everything into one
              // unbounded range. Seed it from the cuts currently on screen so the user starts by
              // editing what they can already see.
              if (mode === 'custom' && binSpec.edges.length === 0) {
                const seeded = result.bins
                  .map((b) => b.min)
                  .filter((v) => Number.isFinite(v))
                  .map((v) => Math.round(v * 100) / 100)
                update({ mode, edges: seeded })
              } else {
                update({ mode })
              }
            }}
          >
            {(Object.keys(MODE_LABELS) as BinMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        <p className="hint" style={{ marginTop: 0 }}>
          {MODE_HINTS[binSpec.mode]}
        </p>

        {binSpec.mode === 'custom' ? (
          <>
            <label className="field">
              Number of ranges
              <input
                type="number"
                min={2}
                max={12}
                value={binSpec.edges.length + 1}
                onChange={(e) => {
                  const wanted = Math.max(2, Math.min(12, Number(e.target.value) || 2))
                  const edges = [...binSpec.edges]
                  while (edges.length > wanted - 1) edges.pop()
                  while (edges.length < wanted - 1) {
                    // Extend by a plausible step so new rows are not all zero.
                    const last = edges[edges.length - 1]
                    edges.push(Number.isFinite(last) ? last + 6 : 6)
                  }
                  update({ edges })
                }}
              />
            </label>

            {binSpec.edges.map((edge, i) => (
              <div className="bin-row" key={i}>
                <span className="muted" style={{ minWidth: '4.5rem' }}>
                  cut {i + 1} at
                </span>
                <input
                  type="number"
                  step="any"
                  value={Number.isFinite(edge) ? edge : ''}
                  onChange={(e) => setEdge(i, e.target.value)}
                />
                <span className="muted">{unit}</span>
              </div>
            ))}
          </>
        ) : (
          <label className="field">
            Number of ranges
            <input
              type="number"
              min={BIN_COUNT_MIN}
              max={BIN_COUNT_MAX}
              value={binSpec.binCount}
              onChange={(e) =>
                update({
                  binCount: Math.max(
                    BIN_COUNT_MIN,
                    Math.min(BIN_COUNT_MAX, Number(e.target.value) || BIN_COUNT_MIN),
                  ),
                })
              }
            />
          </label>
        )}

        <div>
          <div className="var-group-title">Resulting groups</div>
          <div className="bin-preview">
            {result.bins.map((bin) => (
              <span className="bin-tag" key={bin.index}>
                {bin.label}
                <span className="muted"> · n={counts.get(bin.index) ?? 0}</span>
              </span>
            ))}
          </div>
        </div>

        {result.missingCount > 0 && (
          <p className="hint">
            {result.missingCount.toLocaleString()} row(s) have no {def.label} value and are left
            out of the grouping.
          </p>
        )}
        {result.excludedCount > 0 && (
          <p className="hint">
            {result.excludedCount.toLocaleString()} value(s) fall outside your ranges and are not
            shown.
          </p>
        )}
        {[...result.bins].some((bin) => (counts.get(bin.index) ?? 0) === 0) && (
          <p className="hint">
            One or more ranges are empty. Adjust the cut points, or use fewer ranges.
          </p>
        )}
      </div>
    </div>
  )
}
