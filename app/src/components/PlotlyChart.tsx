import Plotly from 'plotly.js-dist-min'
import { useEffect, useRef } from 'react'

interface PlotlyChartProps {
  data: Record<string, unknown>[]
  layout: Record<string, unknown>
  config: Record<string, unknown>
  /** Receives the graph div so the export panel can render from the live figure. */
  onGraphReady?: (div: HTMLDivElement | null) => void
  className?: string
}

/**
 * Thin Plotly wrapper.
 *
 * Deliberately hand-rolled rather than using `react-plotly.js`, which has not been released
 * since 2023 and declares a React 18 peer dependency. `Plotly.react` already does the
 * diffing a React binding would add, so the whole integration is an effect and a ref.
 */
export function PlotlyChart({ data, layout, config, onGraphReady, className }: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const div = ref.current
    if (!div) return
    // `react` updates an existing plot in place, preserving zoom and pan across re-renders.
    void Plotly.react(div, data as never, layout as never, config as never)
    onGraphReady?.(div)
  }, [data, layout, config, onGraphReady])

  useEffect(() => {
    const div = ref.current
    return () => {
      // Plotly attaches window listeners and a WebGL context per plot; without an explicit
      // purge these leak every time the user switches chart type.
      if (div) Plotly.purge(div)
    }
  }, [])

  // Resize is handled by Plotly's `responsive` config, which listens on the window; an
  // observer keeps it correct when the surrounding panels resize without the window doing so.
  useEffect(() => {
    const div = ref.current
    if (!div || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      void Plotly.Plots.resize(div)
    })
    observer.observe(div)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className={className} />
}
