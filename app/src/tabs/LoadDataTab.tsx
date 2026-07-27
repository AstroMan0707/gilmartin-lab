import { useRef, useState } from 'react'
import { Notice } from '../components/Notice'
import { categoriseFiles, filesFromDataTransfer } from '../loadFiles'
import { useAppStore } from '../store/useAppStore'
import type { DatasetWarning, WarningKind } from '../types'

/** Warning kinds that mean "look at this before you trust the numbers". */
const SERIOUS: WarningKind[] = ['parse-failed', 'sex-conflict', 'latency-collision', 'duplicate-session']

function toneFor(warning: DatasetWarning) {
  return SERIOUS.includes(warning.kind) ? 'warning' : 'info'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function LoadDataTab() {
  const { dataset, loading, progress, loadError, load, clear } = useAppStore()

  const [xmlFiles, setXmlFiles] = useState<File[]>([])
  const [ratInfoFile, setRatInfoFile] = useState<File | null>(null)
  const [ignored, setIgnored] = useState<string[]>([])
  const [isOver, setIsOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: File[]) => {
    const { xmlFiles: xml, ratInfoFiles, ignored: rejected } = categoriseFiles(incoming)

    setXmlFiles((existing) => {
      // De-duplicate by name and size so dropping the same folder twice is harmless.
      const seen = new Set(existing.map((f) => `${f.name}:${f.size}`))
      return [...existing, ...xml.filter((f) => !seen.has(`${f.name}:${f.size}`))]
    })
    if (ratInfoFiles.length > 0) setRatInfoFile(ratInfoFiles[0])
    setIgnored(rejected.map((f) => f.name))
  }

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setIsOver(false)
    addFiles(await filesFromDataTransfer(event.dataTransfer))
  }

  const percent = progress ? Math.round((progress.done / progress.total) * 100) : 0
  const canLoad = xmlFiles.length > 0 && ratInfoFile !== null && !loading

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2>Load your data</h2>
          {dataset && (
            <button className="btn btn-quiet" onClick={clear}>
              Start over
            </button>
          )}
        </div>

        <p className="secondary small">
          Drop in your session XML files — as many as you like, or a whole folder — together with
          one <strong>Rat Info</strong> spreadsheet. Everything is processed on this computer; no
          file is uploaded anywhere, and closing the tab clears it.
        </p>

        <button
          type="button"
          className={`dropzone${isOver ? ' is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setIsOver(true)
          }}
          onDragLeave={() => setIsOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <h2>Drop files here</h2>
          <p className="muted small">or click to choose them — .xml sessions and one .xlsx Rat Info</p>
        </button>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xml,.xlsx,.xlsm"
          className="sr-only"
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])])
            // Reset so choosing the same file again still fires a change event.
            e.target.value = ''
          }}
        />

        {ignored.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <Notice tone="warning">
              Ignored {ignored.length} file(s) that are neither .xml nor .xlsx: {ignored.join(', ')}
            </Notice>
          </div>
        )}

        <div className="row" style={{ marginTop: '1rem', alignItems: 'flex-start', gap: '1.5rem' }}>
          <div style={{ flex: '1 1 20rem', minWidth: 0 }}>
            <div className="var-group-title">
              Session files
              <span className="pill">{xmlFiles.length}</span>
            </div>
            {xmlFiles.length === 0 ? (
              // Returning to this tab remounts the picker with empty local state, so say what
              // is already loaded rather than the bare "none yet" that reads as data loss.
              dataset ? (
                <p className="secondary small">
                  <span className="file-added" aria-hidden="true">
                    ✓{' '}
                  </span>
                  <span className="file-name">
                    {dataset.xmlFileNames.length} session file
                    {dataset.xmlFileNames.length === 1 ? '' : 's'} loaded
                  </span>
                  : {dataset.xmlFileNames.join(', ')}. Add more above to load them alongside, or
                  choose Start over.
                </p>
              ) : (
                <p className="muted small">None yet.</p>
              )
            ) : (
              <ul className="file-list">
                {xmlFiles.map((file, i) => (
                  <li key={`${file.name}:${file.size}:${i}`}>
                    <span className="file-added" aria-hidden="true">
                      ✓
                    </span>
                    <span className="file-name">{file.name}</span>
                    <span className="muted">{formatBytes(file.size)}</span>
                    <button
                      onClick={() => setXmlFiles((f) => f.filter((_, j) => j !== i))}
                      aria-label={`Remove ${file.name}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
            <div className="var-group-title">Rat Info spreadsheet</div>
            {ratInfoFile === null ? (
              dataset?.ratInfoFileName ? (
                <p className="secondary small">
                  <span className="file-added" aria-hidden="true">
                    ✓{' '}
                  </span>
                  <span className="file-name">{dataset.ratInfoFileName}</span> is in use. Add
                  another to replace it.
                </p>
              ) : (
                <p className="muted small">
                  Required. Supplies each rat&apos;s genotype, set and birthday.
                </p>
              )
            ) : (
              <ul className="file-list">
                <li>
                  <span className="file-added" aria-hidden="true">
                    ✓
                  </span>
                  <span className="file-name">{ratInfoFile.name}</span>
                  <span className="muted">{formatBytes(ratInfoFile.size)}</span>
                  <button onClick={() => setRatInfoFile(null)} aria-label="Remove Rat Info file">
                    Remove
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>

        <div className="divider" />

        <div className="row">
          <button className="btn btn-primary" disabled={!canLoad} onClick={() => load({ xmlFiles, ratInfoFile })}>
            {loading ? 'Reading files…' : `Load ${xmlFiles.length || ''} session${xmlFiles.length === 1 ? '' : 's'}`}
          </button>
          {!canLoad && !loading && (
            <span className="muted small">
              {xmlFiles.length === 0
                ? 'Add at least one session XML file.'
                : 'Add a Rat Info spreadsheet to continue.'}
            </span>
          )}
        </div>

        {loading && progress && (
          <div style={{ marginTop: '0.875rem' }}>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="hint">
              {progress.done} of {progress.total} — {progress.current}
            </p>
          </div>
        )}

        {loadError && (
          <div style={{ marginTop: '0.875rem' }}>
            <Notice tone="error">{loadError}</Notice>
          </div>
        )}
      </div>

      {dataset && <ValidationPanel />}
    </>
  )
}

/**
 * Shows what was actually loaded and everything questionable about it.
 *
 * Every warning is non-blocking by design: a rat missing from Rat Info still has usable
 * trial data, and refusing to load it would be worse than loading it without a genotype.
 */
function ValidationPanel() {
  const { dataset, setTab } = useAppStore()
  if (!dataset) return null

  const subjectIds = new Set(dataset.sessions.map((s) => s.animalId))
  const trials = dataset.sessions.reduce((n, s) => n + s.trials.length, 0)
  const schedules = [...new Set(dataset.sessions.map((s) => s.scheduleName))]
  const genotypes = [...new Set(dataset.sessions.map((s) => s.genotype).filter(Boolean))]
  const delays = [...new Set(dataset.sessions.map((s) => s.delaySec).filter((d) => d !== null))]

  return (
    <div className="card">
      <div className="card-header">
        <h2>What was loaded</h2>
        <button className="btn btn-primary" onClick={() => setTab('playground')}>
          Go to the visualisation playground
        </button>
      </div>

      <dl className="stat-grid">
        <div className="stat-tile">
          <dt>Sessions</dt>
          <dd>{dataset.sessions.length}</dd>
        </div>
        <div className="stat-tile">
          <dt>Rats</dt>
          <dd>{subjectIds.size}</dd>
        </div>
        <div className="stat-tile">
          <dt>Trial attempts</dt>
          <dd>{trials.toLocaleString()}</dd>
        </div>
        <div className="stat-tile">
          <dt>Genotypes</dt>
          <dd style={{ fontSize: '1rem' }}>{genotypes.join(', ') || '—'}</dd>
        </div>
        <div className="stat-tile">
          <dt>Delays</dt>
          <dd style={{ fontSize: '1rem' }}>
            {delays.length > 0 ? delays.map((d) => `${d} s`).join(', ') : '—'}
          </dd>
        </div>
        <div className="stat-tile">
          <dt>Schedules</dt>
          <dd style={{ fontSize: '1rem' }}>{schedules.length}</dd>
        </div>
      </dl>

      <div className="divider" />

      <h3 style={{ marginBottom: '0.5rem' }}>Checks</h3>
      {dataset.warnings.length === 0 ? (
        <Notice tone="good">
          Every rat matched the Rat Info file, every latency matched a trial, and no duplicate
          sessions were found.
        </Notice>
      ) : (
        dataset.warnings.map((warning, i) => (
          <Notice key={i} tone={toneFor(warning)}>
            {warning.message}
          </Notice>
        ))
      )}

      <div className="divider" />

      <h3 style={{ marginBottom: '0.5rem' }}>Sessions</h3>
      <div className="table-scroll" style={{ maxHeight: '20rem' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Rat</th>
              <th>Genotype</th>
              <th>Sex</th>
              <th className="numeric">Set</th>
              <th>Test day</th>
              <th className="numeric">Session #</th>
              <th className="numeric">Delay (s)</th>
              <th className="numeric">Attempts</th>
              <th className="numeric">Trials</th>
              <th className="numeric">Age (days)</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {dataset.sessions.map((s, i) => (
              <tr key={i}>
                <td>{s.animalIdRaw || s.animalId}</td>
                <td className={s.genotype ? undefined : 'empty'}>{s.genotype ?? 'not in Rat Info'}</td>
                <td className={s.sex ? undefined : 'empty'}>{s.sex ?? '—'}</td>
                <td className="numeric">{s.set ?? '—'}</td>
                <td>{s.testDay ? s.testDay.toISOString().slice(0, 10) : '—'}</td>
                <td className="numeric">{s.sessionNumber}</td>
                <td className="numeric">{s.delaySec ?? '—'}</td>
                <td className="numeric">{s.trials.length}</td>
                <td className="numeric">{new Set(s.trials.map((t) => t.trialNo)).size}</td>
                <td className="numeric">{s.ageDays ?? '—'}</td>
                <td className="muted">{s.fileName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
