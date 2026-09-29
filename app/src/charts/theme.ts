/**
 * Chart theme.
 *
 * Colour values come from the validated reference palette. The eight categorical slots
 * are used in fixed order and never cycled: past eight series, hues would be
 * indistinguishable under colour-vision deficiency, so the chart layer switches to a
 * single neutral hue and says so rather than inventing a ninth colour.
 *
 * Validation (adjacent pairlist, the one that applies to bars, boxes and lines):
 *   light  — CVD ΔE 9.1, normal-vision ΔE 19.6, all slots inside the lightness band
 *   dark   — CVD ΔE 8.4, normal-vision ΔE 19.3, all slots >= 3:1 on the dark surface
 * Three light-mode slots sit below 3:1 against the surface, so the relief rule applies:
 * a legend is always drawn for two or more series and the summary-statistics table is
 * always on screen beside the figure.
 */

export type ThemeMode = 'light' | 'dark'

export interface ChartTheme {
  mode: ThemeMode
  surface: string
  page: string
  textPrimary: string
  textSecondary: string
  muted: string
  gridline: string
  baseline: string
  border: string
  /** Categorical slots, in fixed assignment order. */
  series: string[]
  /** Used when there are more groups than categorical slots. */
  neutralSeries: string
}

const LIGHT: ChartTheme = {
  mode: 'light',
  surface: '#fcfcfb',
  page: '#f9f9f7',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  muted: '#898781',
  gridline: '#e1e0d9',
  baseline: '#c3c2b7',
  border: 'rgba(11,11,11,0.10)',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  neutralSeries: '#52514e',
}

const DARK: ChartTheme = {
  mode: 'dark',
  surface: '#1a1a19',
  page: '#0d0d0d',
  textPrimary: '#ffffff',
  textSecondary: '#c3c2b7',
  muted: '#898781',
  gridline: '#2c2c2a',
  baseline: '#383835',
  border: 'rgba(255,255,255,0.10)',
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  neutralSeries: '#c3c2b7',
}

export function getTheme(mode: ThemeMode): ChartTheme {
  return mode === 'dark' ? DARK : LIGHT
}

/**
 * The theme exported figures are drawn in, whatever the screen shows: light, on pure white
 * rather than the off-white the app uses for its cards, because a figure lands on a white page.
 */
export const PRINT_THEME: ChartTheme = { ...LIGHT, surface: '#ffffff', page: '#ffffff' }

export const MAX_COLOURED_SERIES = 8

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * Maps series labels to colours by their position in the complete level list, not their
 * position in the current selection.
 *
 * Filtering out one genotype must not repaint the others: a reader who learned that WT is
 * blue would otherwise be misled. `allLevels` therefore comes from the whole dataset,
 * before any filtering.
 */
export function assignSeriesColours(
  seriesLabels: string[],
  allLevels: string[],
  theme: ChartTheme,
): Map<string, string> {
  const colours = new Map<string, string>()
  const tooMany = allLevels.length > MAX_COLOURED_SERIES

  for (const label of seriesLabels) {
    if (tooMany) {
      colours.set(label, theme.neutralSeries)
      continue
    }
    const index = allLevels.indexOf(label)
    colours.set(
      label,
      theme.series[(index === -1 ? seriesLabels.indexOf(label) : index) % theme.series.length],
    )
  }
  return colours
}

/** True when a grouping has more levels than can be distinguished by colour. */
export function exceedsColourCapacity(levelCount: number): boolean {
  return levelCount > MAX_COLOURED_SERIES
}

/** Shared axis styling: solid hairline grid, one shade off the surface, never dashed. */
export function axisStyle(theme: ChartTheme) {
  return {
    gridcolor: theme.gridline,
    gridwidth: 1,
    griddash: 'solid' as const,
    zeroline: false,
    linecolor: theme.baseline,
    linewidth: 1,
    tickcolor: theme.baseline,
    tickfont: { color: theme.muted, size: 12, family: FONT_FAMILY },
    titlefont: { color: theme.textSecondary, size: 13, family: FONT_FAMILY },
    automargin: true,
  }
}

/** Layout defaults every figure shares. */
export function baseLayout(theme: ChartTheme) {
  return {
    paper_bgcolor: theme.surface,
    plot_bgcolor: theme.surface,
    font: { family: FONT_FAMILY, color: theme.textPrimary, size: 13 },
    // Generous padding; the axis band is inside the plot area so labels are never clipped.
    margin: { l: 72, r: 28, t: 56, b: 64 },
    // Thin marks with visible breathing room between them, rather than borders.
    bargap: 0.28,
    bargroupgap: 0.12,
    boxgap: 0.35,
    boxgroupgap: 0.15,
    hovermode: 'closest' as const,
    hoverlabel: {
      bgcolor: theme.surface,
      bordercolor: theme.border,
      font: { family: FONT_FAMILY, color: theme.textPrimary, size: 12 },
    },
    legend: {
      bgcolor: 'rgba(0,0,0,0)',
      bordercolor: 'rgba(0,0,0,0)',
      font: { color: theme.textSecondary, size: 12, family: FONT_FAMILY },
      orientation: 'v' as const,
      x: 1.02,
      xanchor: 'left' as const,
      y: 1,
      yanchor: 'top' as const,
    },
    title: {
      font: { color: theme.textPrimary, size: 15, family: FONT_FAMILY },
      x: 0,
      xanchor: 'left' as const,
    },
  }
}
