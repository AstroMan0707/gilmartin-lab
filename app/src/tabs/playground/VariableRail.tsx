import { useState } from 'react'
import { binnedKey, defaultBinSpec } from '../../analysis/binning'
import { useAppStore } from '../../store/useAppStore'
import type { VariableDef } from '../../variables/registry'

/**
 * True when a measure can be cut into ranges and used as a grouping variable.
 *
 * This is what makes a latency usable as an independent variable: on its own a continuous
 * measure cannot group anything, because every value would be its own group, but once it is
 * cut into ranges it behaves exactly like a categorical variable.
 */
function isRangeable(v: VariableDef): boolean {
  return v.role === 'DV' && v.binnable && (v.type === 'continuous' || v.type === 'count')
}

/** Groups variables into the sections of the picker. */
function sectionsFor(variables: VariableDef[], showAdvanced: boolean) {
  const visible = variables.filter((v) => showAdvanced || !v.advanced)
  return {
    measures: visible.filter((v) => v.role === 'DV'),
    sessionIvs: visible.filter((v) => v.role === 'IV' && v.level !== 'trial'),
    trialIvs: visible.filter((v) => v.role === 'IV' && v.level === 'trial'),
    // Measures offered as groupings, via ranges. Continuous ones first — a latency band is
    // the case this exists for — then counts.
    rangeable: visible
      .filter(isRangeable)
      .sort((a, b) => Number(b.type === 'continuous') - Number(a.type === 'continuous')),
  }
}

function Chip({
  def,
  pressed,
  onClick,
  suffix,
}: {
  def: VariableDef
  pressed: boolean
  onClick: () => void
  suffix?: string
}) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={pressed}
      onClick={onClick}
      title={def.description ?? def.label}
    >
      {def.label}
      {def.unit ? ` (${def.unit})` : ''}
      {suffix}
    </button>
  )
}

/**
 * The variable picker.
 *
 * Measures are multi-select — clicking a second one adds a panel rather than replacing the
 * first. Grouping variables are single-select for the x-axis and for the series, because
 * those are positions in the figure and only one variable can occupy each.
 */
export function VariableRail() {
  const { registry, spec, updateSpec } = useAppStore()
  const [showAdvanced, setShowAdvanced] = useState(false)
  if (!registry) return null

  const { measures, sessionIvs, trialIvs, rangeable } = sectionsFor(
    registry.variables,
    showAdvanced,
  )

  const toggleMeasure = (key: string) => {
    const next = spec.measureKeys.includes(key)
      ? spec.measureKeys.filter((k) => k !== key)
      : [...spec.measureKeys, key]
    updateSpec({ measureKeys: next })
  }

  /**
   * Selecting a grouping variable. A continuous variable cannot group anything directly —
   * every value would be its own group — so it is silently promoted to a binned version and
   * the bin editor appears.
   */
  const setGrouping = (slot: 'xKey' | 'seriesKey', def: VariableDef) => {
    const needsBins = def.binnable && (def.type === 'continuous' || def.type === 'count')
    const key = needsBins ? binnedKey(def.key) : def.key
    const current = spec[slot]

    if (current === key) {
      updateSpec({ [slot]: null } as never)
      return
    }

    const patch: Record<string, unknown> = { [slot]: key }
    if (needsBins && !spec.bins[def.key]) {
      patch.bins = { ...spec.bins, [def.key]: defaultBinSpec(def.key) }
    }
    // The same variable cannot be both the x-axis and the series.
    const other = slot === 'xKey' ? 'seriesKey' : 'xKey'
    if (spec[other] === key) patch[other] = null
    updateSpec(patch as never)
  }

  const isSelected = (slot: 'xKey' | 'seriesKey', def: VariableDef) =>
    spec[slot] === def.key || spec[slot] === binnedKey(def.key)

  const groupingSection = (
    testId: string,
    title: string,
    defs: VariableDef[],
    hint: string,
  ) => (
    <div className="var-group" data-testid={testId}>
      <div className="var-group-title">{title}</div>
      {defs.length === 0 ? (
        <p className="muted small">None available.</p>
      ) : (
        <>
          <div className="var-group-title" style={{ marginTop: '0.25rem' }}>
            x-axis
          </div>
          <div className="chip-list" data-testid="x-chips">
            {defs.map((def) => (
              <Chip
                key={`x-${def.key}`}
                def={def}
                pressed={isSelected('xKey', def)}
                onClick={() => setGrouping('xKey', def)}
              />
            ))}
          </div>
          <div className="var-group-title" style={{ marginTop: '0.5rem' }}>
            split into series
          </div>
          <div className="chip-list" data-testid="series-chips">
            {defs.map((def) => (
              <Chip
                key={`s-${def.key}`}
                def={def}
                pressed={isSelected('seriesKey', def)}
                onClick={() => setGrouping('seriesKey', def)}
              />
            ))}
          </div>
        </>
      )}
      <p className="hint">{hint}</p>
    </div>
  )

  return (
    <div className="card">
      <div className="card-header">
        <h3>Variables</h3>
        <label className="check small">
          <input
            type="checkbox"
            checked={showAdvanced}
            onChange={(e) => setShowAdvanced(e.target.checked)}
          />
          Show all
        </label>
      </div>

      <div className="var-group">
        <div className="var-group-title">
          Measures to analyse
          {spec.measureKeys.length > 1 && <span className="pill">{spec.measureKeys.length} panels</span>}
        </div>
        <div className="chip-list" data-testid="measure-chips">
          {measures.map((def) => (
            <Chip
              key={def.key}
              def={def}
              pressed={spec.measureKeys.includes(def.key)}
              onClick={() => toggleMeasure(def.key)}
            />
          ))}
        </div>
        <p className="hint">
          Click a measure to activate it. Select more than one to get a panel for each.
        </p>
      </div>

      <div className="divider" />

      {groupingSection(
        'group-session',
        'Group by rat or session',
        sessionIvs,
        'Genotype, delay and session number describe whole sessions. Choosing a numeric one, such as age, opens a range editor.',
      )}

      <div className="divider" />

      {groupingSection(
        'group-trial',
        'Group by trial',
        trialIvs,
        'Separation distance and sample side vary within a session.',
      )}

      <div className="divider" />

      {groupingSection(
        'group-range',
        'Group by a measure’s range',
        rangeable,
        'Turns a measure into a grouping variable by cutting it into ranges — for example latency bands of 1–6 s, 7–12 s and above. Choosing one opens a range editor where you set the cut points.',
      )}

      {(spec.measureKeys.length > 0 || spec.xKey || spec.seriesKey) && (
        <>
          <div className="divider" />
          <button className="btn btn-quiet" onClick={() => useAppStore.getState().resetSpec()}>
            Clear selection
          </button>
        </>
      )}
    </div>
  )
}
