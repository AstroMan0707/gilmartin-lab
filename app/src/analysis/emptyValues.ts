import type { Dataset, DatasetWarning } from '../types'
import { dataTableKeys, type Registry } from '../variables/registry'
import { buildTrialRows, type CellValue } from './rows'

function isEmpty(v: CellValue | undefined): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))
}

/**
 * A load-time count of the empty cells in the trial-level Data table, per column, so an
 * experimenter can see at a glance where data is absent without scanning the table.
 *
 * Counted over every trial attempt, whatever the correction-trial setting, so the figure
 * does not change when the toggle does. Returns null when nothing is empty.
 */
export function emptyValueWarning(dataset: Dataset, registry: Registry): DatasetWarning | null {
  const rows = buildTrialRows(dataset, registry, { includeCorrectionTrials: true })
  const counts = dataTableKeys(registry, 'trial')
    .map((key) => ({ key, count: rows.filter((r) => isEmpty(r.values[key])).length }))
    .filter((c) => c.count > 0)
  if (counts.length === 0) return null

  const total = counts.reduce((n, c) => n + c.count, 0)
  const perColumn = counts
    .map((c) => `${registry.byKey.get(c.key)?.label ?? c.key} (${c.count})`)
    .join(', ')
  return {
    kind: 'empty-values',
    message:
      `${total} empty value(s) across ${counts.length} column(s) of the trial data, ` +
      `over ${rows.length} trial attempts: ${perColumn}. ` +
      'A latency is empty on every trial where that event did not happen; empty values anywhere else are worth checking.',
  }
}
