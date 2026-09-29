import Plotly from 'plotly.js-dist-min'
import type { Figure } from '../charts/buildFigure'
import {
  couldNotDrawMessage,
  CSS_PPI,
  exportHeightIn,
  fitsCanvas,
  panelCount,
  pixelDimensions,
  plotlyScaleFor,
  tooLargeMessage,
  type FigureExportOptions,
} from './figureOptions'
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
 *
 * Renders from a figure object rather than the graph on screen, so the caller can hand it a
 * figure built for print: the on-screen one follows the app's theme, and exporting it in dark
 * mode produced a figure with a near-black background and white text.
 */
export async function exportFigure(
  figure: Pick<Figure, 'data' | 'layout'>,
  opts: FigureExportOptions,
): Promise<Blob> {
  const panels = panelCount(figure.layout)
  const layoutWidth = Math.round(opts.widthIn * CSS_PPI)
  const layoutHeight = Math.round(exportHeightIn(opts, panels) * CSS_PPI)
  const source = { data: figure.data, layout: figure.layout } as Parameters<typeof Plotly.toImage>[0]

  if (opts.format === 'svg') {
    const dataUrl = await Plotly.toImage(source, {
      format: 'svg',
      width: layoutWidth,
      height: layoutHeight,
    })
    // Plotly returns SVG as a URI-encoded data URL rather than base64.
    const svgText = decodeURIComponent(dataUrl.replace(/^data:image\/svg\+xml,/, ''))
    return new Blob([svgText], { type: 'image/svg+xml' })
  }

  // Checked first, because a canvas the browser cannot allocate does not fail loudly: it comes
  // back empty, and used to surface as "that file is not a PNG".
  const dims = pixelDimensions(opts, panels)
  if (!fitsCanvas(dims)) throw new Error(tooLargeMessage(opts, panels))

  let dataUrl: string
  try {
    dataUrl = await Plotly.toImage(source, {
      format: 'png',
      width: layoutWidth,
      height: layoutHeight,
      scale: plotlyScaleFor(opts.dpi),
    })
  } catch {
    throw new Error(couldNotDrawMessage(dims))
  }
  // A canvas over this browser's own limit yields "data:," rather than an error.
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length < 100) {
    throw new Error(couldNotDrawMessage(dims))
  }

  return new Blob([setPngDpi(dataUrlToArrayBuffer(dataUrl), opts.dpi)], { type: 'image/png' })
}
