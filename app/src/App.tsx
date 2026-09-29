import { lazy, Suspense, useEffect, useRef } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { clearPresetHash, presetFromHash } from './presets'
import { useAppStore, type TabId } from './store/useAppStore'
import { DataTableTab } from './tabs/DataTableTab'
import { LoadDataTab } from './tabs/LoadDataTab'

// The playground pulls in Plotly, which is the largest dependency by a wide margin. Loading
// it on demand keeps the first screen — the one every user starts on — small and fast.
const PlaygroundTab = lazy(() => import('./tabs/PlaygroundTab'))

const TABS: { id: TabId; label: string; needsData: boolean }[] = [
  { id: 'load', label: 'Load data', needsData: false },
  { id: 'playground', label: 'Visualisation playground', needsData: true },
  { id: 'table', label: 'Data & Excel export', needsData: true },
]

export default function App() {
  const { tab, setTab, theme, setTheme, dataset, applyPreset, setPendingPreset, resetSpec } =
    useAppStore()
  const followedSystemTheme = useRef(false)
  const readSharedPreset = useRef(false)

  /*
   * A shared preset link is usually opened before any files exist, so the preset is queued and
   * applied once data is loaded. The hash is cleared immediately, so reloading the page after
   * changing the analysis does not silently snap it back.
   *
   * The `hashchange` listener matters as much as the mount-time read: pasting a preset link into
   * the address bar of a tab that already has the app open is a same-document navigation, so
   * React never re-mounts and a mount-only check would leave the colleague staring at an
   * unchanged screen wondering why the link did nothing.
   */
  useEffect(() => {
    const applyFromHash = () => {
      const shared = presetFromHash()
      if (!shared) return
      clearPresetHash()
      if (useAppStore.getState().dataset) applyPreset(shared)
      else setPendingPreset(shared)
    }

    if (!readSharedPreset.current) {
      readSharedPreset.current = true
      applyFromHash()
    }

    window.addEventListener('hashchange', applyFromHash)
    return () => window.removeEventListener('hashchange', applyFromHash)
  }, [applyPreset, setPendingPreset])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Follow the operating system on first load only; after that the toggle wins, so a user
  // who chose light mode is not flipped back by their OS at sunset.
  useEffect(() => {
    if (followedSystemTheme.current || typeof window.matchMedia !== 'function') return
    followedSystemTheme.current = true
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme('dark')
  }, [setTheme])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <h1>TUNL Parser</h1>
          <small>Gilmartin Lab · v{__APP_VERSION__}</small>
        </div>

        <nav className="tabs" aria-label="Sections">
          {TABS.map(({ id, label, needsData }) => (
            <button
              key={id}
              type="button"
              className="tab"
              aria-current={tab === id ? 'page' : undefined}
              disabled={needsData && !dataset}
              title={needsData && !dataset ? 'Load some data first' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <button
          className="btn btn-quiet"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
      </header>

      <main className="app-main">
        {/* Keyed by tab, so moving to another tab clears an error shown on this one. */}
        <ErrorBoundary key={tab} onReset={resetSpec}>
          {tab === 'load' && <LoadDataTab />}
          {tab === 'playground' && (
            <Suspense
              fallback={
                <div className="card empty-state">
                  <p className="muted">Loading the charting tools…</p>
                </div>
              }
            >
              <PlaygroundTab />
            </Suspense>
          )}
          {tab === 'table' && <DataTableTab />}
        </ErrorBoundary>
      </main>
    </div>
  )
}
