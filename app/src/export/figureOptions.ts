/**
 * Export options and pure helpers.
 *
 * Kept separate from `figureExport.ts` so that anything needing the arithmetic or the
 * download helper does not have to pull in Plotly — which matters for the test suite and
 * keeps the Plotly chunk out of code paths that never draw.
 */

import { FIGURE_MARGIN, PANEL_GAP } from '../charts/theme'

/** Plotly lays out in CSS pixels, which are 96 to the inch. */
export const CSS_PPI = 96

export type FigureFormat = 'png' | 'svg'

export interface FigureExportOptions {
  format: FigureFormat
  /** Figure width in inches. */
  widthIn: number
  /** Figure height in inches, when `heightAuto` is off. */
  heightIn: number
  /**
   * Size the height to the number of panels, rather than use `heightIn`. On until the user
   * types a height: one fixed height squeezed a three-measure figure to under an inch a panel.
   */
  heightAuto: boolean
  /** Target resolution for raster output. Ignored for SVG, which has no resolution. */
  dpi: number
  fileName: string
}

export const DPI_CHOICES = [300, 600, 1200] as const

export function defaultExportOptions(): FigureExportOptions {
  // An empty name means "use the chart title", so exports are not all called figure.png.
  return { format: 'png', widthIn: 6.5, heightIn: 4.5, heightAuto: true, dpi: 600, fileName: '' }
}

/** Height of a one-panel figure, and what each further stacked panel adds. */
const SINGLE_PANEL_HEIGHT_IN = 4.5
const EXTRA_PANEL_HEIGHT_IN = 2.25
/** A letter or A4 page's usable height, so an automatic height still fits on one. */
const MAX_AUTO_HEIGHT_IN = 10
/** Below this, a panel's plot area is too short for its axis to be read. */
export const MIN_PANEL_PLOT_HEIGHT_IN = 1.5

/** How many stacked panels a figure has: one y-axis each. */
export function panelCount(layout: Record<string, unknown>): number {
  return Math.max(1, Object.keys(layout).filter((k) => /^yaxis\d*$/.test(k)).length)
}

/** The height a figure of `panels` stacked panels is exported at when sized automatically. */
export function autoHeightIn(panels: number): number {
  const h = SINGLE_PANEL_HEIGHT_IN + EXTRA_PANEL_HEIGHT_IN * Math.max(0, panels - 1)
  return Math.min(h, MAX_AUTO_HEIGHT_IN)
}

/** The export height in inches, automatic or as typed. */
export function exportHeightIn(opts: FigureExportOptions, panels: number): number {
  return opts.heightAuto ? autoHeightIn(panels) : opts.heightIn
}

/**
 * Roughly how tall each panel's plot area comes out, in inches: the height less the title and
 * x-axis margins, less the gaps between panels, shared out. Mirrors the layout's own sums, so
 * the export panel can warn before anyone downloads a squashed figure.
 */
export function panelPlotHeightIn(heightIn: number, panels: number): number {
  const marginsIn = (FIGURE_MARGIN.t + FIGURE_MARGIN.b) / CSS_PPI
  const share = panels <= 1 ? 1 : (1 - PANEL_GAP * (panels - 1)) / panels
  return Math.max(0, (heightIn - marginsIn) * share)
}

/** Pixel dimensions a raster export will have. Shown in the UI before exporting. */
export function pixelDimensions(
  opts: FigureExportOptions,
  panels = 1,
): { width: number; height: number } {
  return {
    width: Math.round(opts.widthIn * opts.dpi),
    height: Math.round(exportHeightIn(opts, panels) * opts.dpi),
  }
}

/** The factor Plotly must scale the vector scene by to reach the requested DPI. */
export function plotlyScaleFor(dpi: number): number {
  return dpi / CSS_PPI
}

/**
 * Escapes a value for CSV, quoting only when necessary.
 *
 * Text starting with = + - or @ is prefixed with an apostrophe, which Excel hides, so a group
 * label taken from someone's spreadsheet cannot run as a formula when the CSV is opened.
 * Numbers are left alone: a negative number is data, not a formula.
 */
function csvCell(value: string | number | null): string {
  if (value === null) return ''
  let s = String(value)
  if (typeof value === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Serialises the numbers behind a figure to CSV.
 *
 * Offered alongside every figure so a plot is always reproducible and checkable: a reviewer
 * can see the group means and sample sizes that produced the bars.
 */
export function plottedValuesToCsv(table: {
  columns: string[]
  rows: (string | number | null)[][]
}): Blob {
  const lines = [table.columns.map(csvCell).join(',')]
  for (const row of table.rows) lines.push(row.map(csvCell).join(','))
  // The byte-order mark tells Excel the file is UTF-8; without it, labels such as "≥ 12 s"
  // open as "â‰¥ 12 s" on Windows.
  return new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
}

/**
 * Triggers a browser download. Nothing is uploaded; the blob never leaves the machine.
 *
 * The anchor is left in the document and the object URL held alive for a good while after the
 * click. Removing the element or revoking the URL too early cancels the transfer for large
 * blobs — a 1200 DPI PNG is tens of megabytes, and the browser is still reading from the blob
 * when a one-second timer would have pulled it away. The cost of holding it longer is a
 * hidden anchor and some memory; the cost of releasing too early is a silently failed export.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 60_000)
}

/** Strips characters that are awkward in filenames across operating systems. */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[-_.]+|[-_.]+$/g, '')
      .slice(0, 120) || 'figure'
  )
}
