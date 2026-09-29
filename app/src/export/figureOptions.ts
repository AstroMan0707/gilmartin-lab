/**
 * Export options and pure helpers.
 *
 * Kept separate from `figureExport.ts` so that anything needing the arithmetic or the
 * download helper does not have to pull in Plotly — which matters for the test suite and
 * keeps the Plotly chunk out of code paths that never draw.
 */

/** Plotly lays out in CSS pixels, which are 96 to the inch. */
export const CSS_PPI = 96

export type FigureFormat = 'png' | 'svg'

export interface FigureExportOptions {
  format: FigureFormat
  /** Figure width in inches. */
  widthIn: number
  /** Figure height in inches. */
  heightIn: number
  /** Target resolution for raster output. Ignored for SVG, which has no resolution. */
  dpi: number
  fileName: string
}

export const DPI_CHOICES = [300, 600, 1200] as const

export function defaultExportOptions(): FigureExportOptions {
  // An empty name means "use the chart title", so exports are not all called figure.png.
  return { format: 'png', widthIn: 6.5, heightIn: 4.5, dpi: 600, fileName: '' }
}

/** Pixel dimensions a raster export will have. Shown in the UI before exporting. */
export function pixelDimensions(opts: FigureExportOptions): { width: number; height: number } {
  return {
    width: Math.round(opts.widthIn * opts.dpi),
    height: Math.round(opts.heightIn * opts.dpi),
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
