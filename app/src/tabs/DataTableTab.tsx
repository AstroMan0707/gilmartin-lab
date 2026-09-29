import { useMemo, useState } from 'react'
import { Notice } from '../components/Notice'
import { buildWorkbook, workbookFileName } from '../export/workbook'
import { downloadBlob } from '../export/figureOptions'
import { useAppStore } from '../store/useAppStore'
import { axisTitle, dataTableKeys } from '../variables/registry'

type Level = 'trial' | 'session'

/** How many rows to render at once. Tens of thousands of DOM rows would freeze the tab. */
const PAGE_SIZE = 250

export function DataTableTab() {
  const { dataset, registry, includeCorrectionTrials, trialRows, sessionRows } = useAppStore()
  const [level, setLevel] = useState<Level>('trial')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const rows = level === 'trial' ? trialRows() : sessionRows()

  // Columns come from the registry so the table shows the same friendly labels as the
  // charts, with identity fields first.
  const columns = useMemo(() => {
    if (!registry) return []
    return dataTableKeys(registry, level).map((k) => ({ key: k, def: registry.byKey.get(k)! }))
  }, [registry, level])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter((row) =>
      ['animalId', 'genotype', 'sex', 'scheduleName'].some((k) =>
        String(row.values[k] ?? '').toLowerCase().includes(q),
      ),
    )
  }, [rows, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  if (!dataset || !registry) {
    return (
      <div className="card empty-state">
        <h2>No data yet</h2>
        <p>Load your session files on the Load data tab first.</p>
      </div>
    )
  }

  const doExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const blob = await buildWorkbook(dataset, {
        includeCorrectionTrials,
        appVersion: __APP_VERSION__,
      })
      downloadBlob(blob, workbookFileName(dataset))
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Data</h2>
        <label className="field" style={{ textTransform: 'none', letterSpacing: 0 }}>
          <span className="sr-only">Row level</span>
          <select value={level} onChange={(e) => { setLevel(e.target.value as Level); setPage(0) }}>
            <option value="trial">One row per trial</option>
            <option value="session">One row per session</option>
          </select>
        </label>
        <input
          type="search"
          placeholder="Filter by rat, genotype…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          style={{ width: '13rem' }}
        />
        <button className="btn btn-primary" onClick={doExport} disabled={exporting}>
          {exporting ? 'Building spreadsheet…' : 'Export to Excel'}
        </button>
      </div>

      <p className="secondary small">
        {filtered.length.toLocaleString()} row{filtered.length === 1 ? '' : 's'}
        {search.trim() !== '' && ` (filtered from ${rows.length.toLocaleString()})`}
        {level === 'trial' &&
          (includeCorrectionTrials
            ? ' — including correction trials'
            : ' — first attempts only, correction trials excluded')}
        . The Excel export contains every row, not just this page, plus a session summary, the
        subject list and a Read Me sheet.
      </p>

      {exportError && <Notice tone="error">{exportError}</Notice>}

      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              {columns.map(({ key, def }) => (
                <th key={key} className={def.type === 'categorical' ? undefined : 'numeric'}>
                  {axisTitle(def)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={safePage * PAGE_SIZE + i}>
                {columns.map(({ key, def }) => {
                  const value = row.values[key]
                  const isEmpty = value === null || value === undefined || value === ''
                  return (
                    <td
                      key={key}
                      className={[
                        def.type === 'categorical' ? '' : 'numeric',
                        isEmpty ? 'empty' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {isEmpty
                        ? '—'
                        : typeof value === 'number'
                          ? Number.isInteger(value)
                            ? value
                            : value.toFixed(3)
                          : value}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
          <button className="btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            Previous
          </button>
          <span className="small secondary tabular">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            className="btn"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </button>
          <span className="muted small">
            Only this page is drawn, to keep the table fast. The export includes everything.
          </span>
        </div>
      )}
    </div>
  )
}
