import { useState } from 'react'
import { Notice } from '../../components/Notice'
import {
  describePreset,
  presetLink,
  presetsAvailable,
  type AnalysisPreset,
} from '../../presets'
import { useAppStore } from '../../store/useAppStore'
import type { Registry } from '../../variables/registry'

/**
 * Saved analysis configurations.
 *
 * Presets live in this browser's local storage. That is enough to make them useful with no
 * server involvement, and it keeps the app's central property intact: a preset contains only
 * the user's own chart settings, never any animal data, so persisting it is safe in a way that
 * persisting a dataset would not be.
 *
 * Sharing works by link rather than by a shared store, since there is no backend to hold one.
 * The preset rides in the URL fragment, which browsers never transmit to the server.
 */
export function PresetPanel({ registry }: { registry: Registry }) {
  const { presets, spec, applyPreset, saveCurrentAsPreset, removePreset, appliedPreset: applied } =
    useAppStore()
  const [name, setName] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const available = presetsAvailable()
  const canSave = spec.measureKeys.length > 0

  const save = () => {
    const trimmed = name.trim()
    if (!canSave || trimmed === '') return
    saveCurrentAsPreset(trimmed)
    setName('')
  }

  const open = (preset: AnalysisPreset) => applyPreset(preset)

  const copyLink = async (preset: AnalysisPreset) => {
    const link = presetLink(preset)
    try {
      await navigator.clipboard.writeText(link)
      setCopied(preset.id)
      setTimeout(() => setCopied(null), 2500)
    } catch {
      // Clipboard access is refused on insecure origins in some browsers. Fall back to a
      // prompt, which always works and still lets the user copy by hand.
      window.prompt('Copy this link to share the analysis:', link)
    }
  }

  return (
    <div className="card" data-testid="preset-panel">
      <div className="card-header">
        <h3>Analysis presets</h3>
        {presets.length > 0 && <span className="pill">{presets.length} saved</span>}
      </div>

      <div className="bin-editor">
        <label className="field">
          Save the current analysis as
          <input
            type="text"
            placeholder="e.g. Accuracy by genotype"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </label>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={!canSave || name.trim() === ''}
          data-testid="save-preset"
        >
          Create analysis preset
        </button>
        {!canSave && (
          <p className="hint" style={{ marginTop: 0 }}>
            Choose at least one measure first — a preset records what to plot.
          </p>
        )}

        {!available && (
          <Notice tone="warning">
            This browser is blocking local storage, so presets will last only until you close the
            tab. Private browsing windows do this. You can still share one as a link.
          </Notice>
        )}

        {applied && (
          <Notice
            tone={applied.missing.length > 0 || applied.correctionTrialsNow !== null ? 'warning' : 'good'}
          >
            {applied.missing.length > 0 ? (
              <>
                Opened <strong>{applied.name}</strong>, but the data you have loaded has no{' '}
                {applied.missing.join(', ')}. That part of the analysis will be blank — the preset
                was probably built from a different schedule.
              </>
            ) : (
              <>
                Opened <strong>{applied.name}</strong>.
              </>
            )}
            {applied.correctionTrialsNow !== null && (
              <>
                {' '}
                It also switched correction trials to{' '}
                <strong>{applied.correctionTrialsNow ? 'included' : 'excluded'}</strong>, which
                changes every figure and the Excel export.
              </>
            )}
          </Notice>
        )}

        {presets.length === 0 ? (
          <p className="hint" style={{ marginTop: 0 }}>
            Nothing saved yet. A preset remembers the measures, the grouping, the chart type, any
            ranges you set, and the correction-trial setting — so you can return to exactly this
            view later, or send it to a colleague.
          </p>
        ) : (
          <ul className="preset-list">
            {presets.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  className="preset-open"
                  onClick={() => open(preset)}
                  title={`Open "${preset.name}"`}
                >
                  <strong>{preset.name}</strong>
                  <span>{describePreset(preset, registry)}</span>
                </button>
                <div className="preset-actions">
                  <button
                    type="button"
                    className="btn btn-quiet small"
                    onClick={() => copyLink(preset)}
                  >
                    {copied === preset.id ? 'Link copied' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet small"
                    onClick={() => removePreset(preset.id)}
                    aria-label={`Delete ${preset.name}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="hint">
          Presets are stored in this browser and hold only chart settings — never any animal data.
          Use <strong>Copy link</strong> to send one to a colleague; opening the link loads the
          same analysis against whatever files they have.
        </p>
      </div>
    </div>
  )
}
