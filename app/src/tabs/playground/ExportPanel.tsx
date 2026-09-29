import { useState } from 'react'
import type { Figure } from '../../charts/buildFigure'
import { Notice } from '../../components/Notice'
import { exportFigure } from '../../export/figureExport'
import {
  APPLE_MOBILE_MAX_CANVAS_AREA,
  clampFigureInches,
  DPI_CHOICES,
  downloadBlob,
  exportHeightIn,
  fitsCanvas,
  MAX_FIGURE_IN,
  MIN_FIGURE_IN,
  tooLargeAdvice,
  tooLargeMessage,
  MIN_PANEL_PLOT_HEIGHT_IN,
  panelPlotHeightIn,
  pixelDimensions,
  plotlyScaleFor,
  plottedValuesToCsv,
  safeFileName,
} from '../../export/figureOptions'
import { useAppStore } from '../../store/useAppStore'

export function ExportPanel({
  buildPrintFigure,
  panels,
  plottedValues,
  suggestedName,
}: {
  /** The current figure in the print theme, or null when there is nothing to draw. */
  buildPrintFigure: (() => Figure) | null
  /** Stacked panels in the figure, one per measure; sizes the automatic height. */
  panels: number
  plottedValues: { columns: string[]; rows: (string | number | null)[][] }
  suggestedName: string
}) {
  const { exportOptions, updateExportOptions } = useAppStore()
  const [busy, setBusy] = useState(false)
  // Kept with the options it happened under, so it clears as soon as any setting changes
  // rather than lingering over an export that would now work.
  const [failure, setFailure] = useState<{ message: string; under: typeof exportOptions } | null>(null)
  const error = failure?.under === exportOptions ? failure.message : null

  const dims = pixelDimensions(exportOptions, panels)
  const isPng = exportOptions.format === 'png'
  // No browser can draw this, so say so up front instead of letting the render fail.
  const tooLarge = isPng && !fitsCanvas(dims)
  // iPhone and iPad Safari have a far lower limit. iPadOS reports itself as a Mac, so it is
  // told apart by its touch screen.
  const appleMobile =
    typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
  const tooLargeHere =
    isPng && !tooLarge && appleMobile && !fitsCanvas(dims, APPLE_MOBILE_MAX_CANVAS_AREA)
  const heightIn = exportHeightIn(exportOptions, panels)
  const panelIn = panelPlotHeightIn(heightIn, panels)
  const name = safeFileName(exportOptions.fileName || suggestedName)

  const doExport = async () => {
    if (!buildPrintFigure) return
    const under = exportOptions
    setBusy(true)
    setFailure(null)
    try {
      const blob = await exportFigure(buildPrintFigure(), { ...exportOptions, fileName: name })
      downloadBlob(blob, `${name}.${exportOptions.format}`)
    } catch (err) {
      setFailure({ message: err instanceof Error ? err.message : String(err), under })
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
              min={MIN_FIGURE_IN}
              max={MAX_FIGURE_IN}
              step={0.25}
              value={exportOptions.widthIn}
              onChange={(e) => updateExportOptions({ widthIn: clampFigureInches(Number(e.target.value)) })}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Height (in)
            <input
              type="number"
              min={MIN_FIGURE_IN}
              max={MAX_FIGURE_IN}
              step={0.25}
              value={Math.round(heightIn * 100) / 100}
              onChange={(e) =>
                updateExportOptions({
                  heightIn: clampFigureInches(Number(e.target.value)),
                  heightAuto: false,
                })
              }
            />
          </label>
        </div>

        {exportOptions.heightAuto ? (
          panels > 1 && (
            <p className="hint" style={{ marginTop: 0 }}>
              Height set for {panels} panels, so each keeps a readable plot area. Type a height to
              choose your own.
            </p>
          )
        ) : (
          <button
            className="btn btn-quiet"
            onClick={() => updateExportOptions({ heightAuto: true })}
          >
            Size the height to the panels again
          </button>
        )}

        {panelIn < MIN_PANEL_PLOT_HEIGHT_IN && (
          <Notice tone="warning">
            At {Math.round(heightIn * 100) / 100} in tall, {panels === 1 ? 'the plot' : `each of the ${panels} panels`}{' '}
            will be about {panelIn.toFixed(1)} in high, too short to read its axis easily.{' '}
            {panels > 1 ? 'Make it taller, or export fewer measures at once.' : 'Make it taller.'}
          </Notice>
        )}

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

        {tooLarge && <Notice tone="error">{tooLargeMessage(exportOptions, panels)}</Notice>}
        {tooLargeHere && (
          <Notice tone="warning">
            iPhones and iPads cannot draw a PNG above about{' '}
            {Math.floor(APPLE_MOBILE_MAX_CANVAS_AREA / 1e5) / 10} million pixels, and this one is{' '}
            {((dims.width * dims.height) / 1e6).toFixed(1)} million.{' '}
            {tooLargeAdvice(exportOptions, panels, APPLE_MOBILE_MAX_CANVAS_AREA)}
          </Notice>
        )}

        <button
          className="btn btn-primary"
          onClick={doExport}
          disabled={busy || !buildPrintFigure || tooLarge}
        >
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
