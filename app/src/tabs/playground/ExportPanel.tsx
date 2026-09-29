import { useState } from 'react'
import type { Figure } from '../../charts/buildFigure'
import { Notice } from '../../components/Notice'
import { exportFigure } from '../../export/figureExport'
import {
  DPI_CHOICES,
  downloadBlob,
  pixelDimensions,
  plotlyScaleFor,
  plottedValuesToCsv,
  safeFileName,
} from '../../export/figureOptions'
import { useAppStore } from '../../store/useAppStore'

export function ExportPanel({
  buildPrintFigure,
  plottedValues,
  suggestedName,
}: {
  /** The current figure in the print theme, or null when there is nothing to draw. */
  buildPrintFigure: (() => Figure) | null
  plottedValues: { columns: string[]; rows: (string | number | null)[][] }
  suggestedName: string
}) {
  const { exportOptions, updateExportOptions } = useAppStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dims = pixelDimensions(exportOptions)
  const name = safeFileName(exportOptions.fileName || suggestedName)

  const doExport = async () => {
    if (!buildPrintFigure) return
    setBusy(true)
    setError(null)
    try {
      const blob = await exportFigure(buildPrintFigure(), { ...exportOptions, fileName: name })
      downloadBlob(blob, `${name}.${exportOptions.format}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" data-testid="export-panel">
      <div className="card-header">
        <h3>Export this figure</h3>
      </div>

      <div className="bin-editor">
        <label className="field">
          Format
          <select
            value={exportOptions.format}
            onChange={(e) => updateExportOptions({ format: e.target.value as 'png' | 'svg' })}
          >
            <option value="png">PNG image at a set resolution</option>
            <option value="svg">SVG vector — any resolution</option>
          </select>
        </label>

        <div className="row" style={{ gap: '0.5rem' }}>
          <label className="field" style={{ flex: 1 }}>
            Width (in)
            <input
              type="number"
              min={1}
              max={20}
              step={0.25}
              value={exportOptions.widthIn}
              onChange={(e) =>
                updateExportOptions({ widthIn: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Height (in)
            <input
              type="number"
              min={1}
              max={20}
              step={0.25}
              value={exportOptions.heightIn}
              onChange={(e) =>
                updateExportOptions({ heightIn: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
        </div>

        {exportOptions.format === 'png' && (
          <label className="field">
            Resolution
            <select
              value={exportOptions.dpi}
              onChange={(e) => updateExportOptions({ dpi: Number(e.target.value) })}
            >
              {DPI_CHOICES.map((dpi) => (
                <option key={dpi} value={dpi}>
                  {dpi} DPI{dpi === 600 ? ' — recommended for publication' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          File name
          <input
            type="text"
            value={exportOptions.fileName}
            placeholder={suggestedName}
            onChange={(e) => updateExportOptions({ fileName: e.target.value })}
          />
        </label>

        {exportOptions.format === 'png' ? (
          <p className="hint">
            {dims.width.toLocaleString()} × {dims.height.toLocaleString()} pixels, tagged as{' '}
            {exportOptions.dpi} DPI so page-layout software places it at the right size. The whole
            figure is redrawn at {plotlyScaleFor(exportOptions.dpi)}× — text and lines are drawn
            sharp at that size, not enlarged from what you see on screen.
          </p>
        ) : (
          <p className="hint">
            Vector output, so it stays sharp at any size. Most journals prefer this.
          </p>
        )}

        <button className="btn btn-primary" onClick={doExport} disabled={busy || !buildPrintFigure}>
          {busy ? 'Rendering…' : `Download ${exportOptions.format.toUpperCase()}`}
        </button>

        <button
          className="btn"
          disabled={plottedValues.rows.length === 0}
          onClick={() =>
            downloadBlob(plottedValuesToCsv(plottedValues), `${name}_values.csv`)
          }
        >
          Download the numbers behind it (CSV)
        </button>

        {error && <Notice tone="error">{error}</Notice>}
        {!buildPrintFigure && (
          <p className="hint">Choose a chart type that draws a figure to enable image export.</p>
        )}
      </div>
    </div>
  )
}
