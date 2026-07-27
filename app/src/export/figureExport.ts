import Plotly from 'plotly.js-dist-min'
import { CSS_PPI, plotlyScaleFor, type FigureExportOptions } from './figureOptions'
import { setPngDpi } from './pngDpi'

export * from './figureOptions'

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Renders a Plotly graph to a publication-resolution image.
 *
 * The mechanism that makes a browser-only app capable of >600 PPI output: the figure is
 * laid out at its physical size in CSS pixels (6.5 in -> 624 px) and Plotly's `scale`
 * multiplies the whole vector scene — geometry, text, line weights — before rasterising.
 * Because the SVG renderer re-rasterises vector geometry at the target size, this is a true
 * high-resolution render rather than an upscaled bitmap: at 600 DPI the scale factor is
 * 6.25, so a 12 pt axis label is drawn as 75 px of real glyph outline.
 *
 * SVG output skips rasterisation entirely and is resolution-independent, which most
 * journals prefer.
 *
 * The PNG then gets a `pHYs` chunk so it reports the requested DPI to page-layout software
 * instead of defaulting to 96.
 */
export async function exportFigure(
  graphDiv: HTMLElement,
  opts: FigureExportOptions,
): Promise<Blob> {
  const layoutWidth = Math.round(opts.widthIn * CSS_PPI)
  const layoutHeight = Math.round(opts.heightIn * CSS_PPI)

  if (opts.format === 'svg') {
    const dataUrl = await Plotly.toImage(graphDiv, {
      format: 'svg',
      width: layoutWidth,
      height: layoutHeight,
    })
    // Plotly returns SVG as a URI-encoded data URL rather than base64.
    const svgText = decodeURIComponent(dataUrl.replace(/^data:image\/svg\+xml,/, ''))
    return new Blob([svgText], { type: 'image/svg+xml' })
  }

  const dataUrl = await Plotly.toImage(graphDiv, {
    format: 'png',
    width: layoutWidth,
    height: layoutHeight,
    scale: plotlyScaleFor(opts.dpi),
  })

  return new Blob([setPngDpi(dataUrlToArrayBuffer(dataUrl), opts.dpi)], { type: 'image/png' })
}
