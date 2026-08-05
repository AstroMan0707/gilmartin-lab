/**
 * End-to-end walkthrough against the real built app in a real browser.
 *
 * Drives the path a lab member takes: drop in all three example sessions plus the Rat Info
 * sheet, then build each chart type, exercise the custom range editor, and export a 600 DPI
 * figure and the Excel workbook. The exports are verified by inspecting the downloaded bytes,
 * not just by observing that a click happened — a figure that silently exported as a 96 DPI
 * thumbnail would pass a click-only test.
 *
 * Usage: node e2e/walkthrough.mjs [baseUrl] [outDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '../../tunl-parser/example-files')
const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:4173'
const OUT_DIR = process.argv[3] ?? join(here, 'artifacts')

mkdirSync(OUT_DIR, { recursive: true })

const results = []
let failures = 0

function check(name, condition, detail = '') {
  const passed = Boolean(condition)
  if (!passed) failures++
  results.push({ name, passed, detail })
  console.log(`${passed ? '[32m✓' : '[31m✗'}[0m ${name}${detail ? `  [2m${detail}[0m` : ''}`)
}

/** Reads a PNG's pixel size and declared resolution straight from its chunks. */
function inspectPng(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const result = {
    isPng: buffer[0] === 0x89 && buffer[1] === 0x50,
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
    pixelsPerMetre: null,
    chunks: [],
  }
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = view.getUint32(offset, false)
    const type = String.fromCharCode(...buffer.subarray(offset + 4, offset + 8))
    result.chunks.push(type)
    if (type === 'pHYs') result.pixelsPerMetre = view.getUint32(offset + 8, false)
    if (type === 'IEND') break
    offset += 12 + length
  }
  return result
}

const browser = await chromium.launch({
  // Playwright's bundled Chromium, deliberately not the distro's /usr/bin/chromium-browser:
  // that is a snap wrapper, and snap's private /tmp namespace hides downloaded files from
  // this process, which looks exactly like a broken export but is not one.
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({
  viewport: { width: 1680, height: 1050 },
  acceptDownloads: true,
})
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

const downloads = new Map()
page.on('download', async (download) => {
  // Await the temp path first: a 3900x2700 PNG takes a moment to finish writing, and copying
  // before then fails with ENOENT.
  try {
    await download.path()
    const target = join(OUT_DIR, download.suggestedFilename())
    await download.saveAs(target)
    downloads.set(download.suggestedFilename(), target)
  } catch (err) {
    console.log(`  [2mdownload of ${download.suggestedFilename()} failed: ${err}[0m`)
  }
})

// ---- helpers -------------------------------------------------------------------------
const testId = (id) => page.locator(`[data-testid="${id}"]`)
/** Nav tabs live in the header; scope to it so page headings with the same text don't clash. */
const navTab = (name) => page.locator('nav.tabs').getByRole('button', { name, exact: true })

/** Clicks a variable chip in a specific section and slot. */
async function pickVariable(section, slot, label) {
  await testId(section).locator(`[data-testid="${slot}"]`)
    .getByRole('button', { name: label, exact: true }).click()
}

async function pickMeasure(label) {
  await testId('measure-chips').getByRole('button', { name: label, exact: true }).click()
}

async function pickChart(label) {
  await testId('chart-types').getByRole('button', { name: new RegExp(`^${label}`) }).click()
  if (label !== 'Summary') await page.waitForSelector('.plot .main-svg', { timeout: 20_000 })
}

/**
 * Reads the summary table as objects keyed by column header.
 *
 * Deliberately not positional: a new column shifts every index, which turns a passing check into
 * a confusing failure somewhere unrelated.
 */
async function summaryRows() {
  const headers = await page.locator('[data-testid="summary-table"] thead th').allInnerTexts()
  const rows = await page.locator('[data-testid="summary-table"] tbody tr').evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').trim())))
  return rows.map((cells) =>
    Object.fromEntries(cells.map((c, i) => [headers[i].trim(), c])),
  )
}

/** SVG <text> nodes have no innerText, so read textContent. */
const svgTexts = (selector) =>
  page.locator(selector).evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))

const shot = (name) => page.screenshot({ path: join(OUT_DIR, `${name}.png`) })
const found = (ext) => [...downloads.entries()].find(([n]) => n.endsWith(ext))?.[1]

try {
  // ---------------------------------------------------------------- load ---------------
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  check('app loads', await page.getByRole('heading', { name: 'TUNL Parser' }).isVisible())
  const brand = await page.locator('.app-brand small').innerText()
  check('the header reports the app version', /v\d+\.\d+\.\d+/.test(brand), brand)

  await page.setInputFiles('input[type="file"]', [
    join(FIXTURES, 'example-input_1.xml'),
    join(FIXTURES, 'example-output_2.xml'),
    join(FIXTURES, 'example-output_3.xml'),
    join(FIXTURES, 'Rat Info.xlsx'),
  ])
  check('all four files are recognised and sorted',
    (await page.locator('.file-list li').count()) === 4)

  await page.getByRole('button', { name: /^Load 3 sessions/ }).click()
  await page.waitForSelector('.playground', { timeout: 30_000 })
  check('loading moves straight to the playground', await page.locator('.playground').isVisible())

  // Validation panel content is on the Load tab; check the join actually happened.
  await navTab('Load data').click()
  const loadText = await page.locator('.card', { hasText: 'What was loaded' }).first().innerText()
  check('validation panel reports 3 sessions and 3 rats',
    /sessions\s*3/i.test(loadText) && /rats\s*3/i.test(loadText),
    loadText.replace(/\n/g, ' ').match(/SESSIONS.{0,40}/i)?.[0] ?? '')
  check('validation panel finds both genotypes and both delays',
    loadText.includes('WT') && loadText.includes('AD') && loadText.includes('0 s') && loadText.includes('20 s'))
  check('a rat missing from Rat Info would be reported, and none are',
    !loadText.includes('not in Rat Info'))
  await shot('01-loaded')

  await navTab('Visualisation playground').click()
  await page.waitForSelector('.playground')

  // ---------------------------------------------------- summary statistics --------------
  await pickMeasure('Percent Correct (%)')
  await page.waitForSelector('[data-testid="summary-table"]')
  const summary = await testId('summary-table').innerText()
  check('summary statistics appear, with a plausible accuracy',
    /Percent Correct/.test(summary) && /\b(7[0-9]|8[0-9])\.\d/.test(summary),
    summary.split('\n').find((l) => /^Percent Correct/.test(l)) ?? '')
  check('summary reports n, SD, SEM and quartiles',
    ['n', 'SD', 'SEM', 'Median', 'Q1', 'Q3', 'IQR', 'Missing'].every((h) => summary.includes(h)))

  // ------------------------------------------- count vs rate are distinct -------------
  const measureLabels = await testId('measure-chips').locator('button').allInnerTexts()
  check('the picker offers no duplicate accuracy or trial-count chips',
    !measureLabels.includes('Correct') &&
      !measureLabels.some((l) => /ABET/.test(l)) &&
      new Set(measureLabels).size === measureLabels.length,
    measureLabels.filter((l) => /Correct|Trials|Attempts/.test(l)).join(' | '))

  await pickMeasure('Correct Trials')
  await page.waitForTimeout(400)
  const bothRows = await summaryRows()
  const countRow = bothRows.find((r) => /^Correct Trials/.test(r.Measure))
  const rateRow = bothRows.find((r) => /^Percent Correct/.test(r.Measure))
  check('Correct Trials is a whole-number count, not a ratio',
    countRow && Number.isInteger(Number(countRow.Mean)) && Number(countRow.Mean) > 1,
    `Correct Trials mean = ${countRow?.Mean}`)
  check('Correct Trials and Percent Correct are no longer the same number',
    countRow && rateRow && countRow.Mean !== rateRow.Mean,
    `count ${countRow?.Mean} vs rate ${rateRow?.Mean}`)
  await pickMeasure('Correct Trials') // deselect

  // ------------------------------------------- touch counters consolidated -------------
  const defaultMeasures = await testId('measure-chips').locator('button').allInnerTexts()
  check('whole-session touch totals are hidden from the default picker',
    !defaultMeasures.some((l) => /whole session/i.test(l)) &&
      defaultMeasures.filter((l) => /Touches/.test(l)).length === 6,
    `${defaultMeasures.filter((l) => /Touches/.test(l)).length} touch chips by default`)

  await page.getByRole('checkbox', { name: /Show all/i }).check()
  await page.waitForTimeout(300)
  const allMeasures = await testId('measure-chips').locator('button').allInnerTexts()
  check('they are still reachable under Show all, so no data is lost',
    allMeasures.filter((l) => /whole session/i.test(l)).length === 6,
    `${allMeasures.filter((l) => /Touches/.test(l)).length} touch chips under Show all`)
  await page.getByRole('checkbox', { name: /Show all/i }).uncheck()
  await page.waitForTimeout(300)

  // The Total column is what makes the per-trial counter sufficient for the common case.
  await pickMeasure('Left Blank Touches')
  await page.waitForTimeout(500)
  const touchRow = (await summaryRows()).find((r) => /^Left Blank Touches/.test(r.Measure))
  // 83 + 66 + 9 over first attempts, which is the default correction-trial setting.
  check('the summary table reports a Total alongside n',
    touchRow && Number(touchRow.Total) === 83 + 66 + 9,
    `n=${touchRow?.n} total=${touchRow?.Total} mean=${touchRow?.Mean}`)
  check('the mean stays a per-trial rate, not the total',
    touchRow && Number(touchRow.Mean) < 5, `mean = ${touchRow?.Mean}`)
  check('a percentage reports no total, since summing percentages is meaningless',
    (await summaryRows()).find((r) => /^Percent Correct/.test(r.Measure))?.Total === '—')
  await pickMeasure('Left Blank Touches') // deselect

  // ---------------------------------------------------------------- bar ----------------
  await pickVariable('group-session', 'x-chips', 'Genotype')
  await pickChart('Bar chart')
  check('bar chart renders', (await page.locator('.plot g.trace.bars').count()) > 0)

  const nValues = (await summaryRows()).map((r) => r.n)
  check('each point is a rat, so n stays small (pseudo-replication guard)',
    nValues.length > 0 && nValues.every((n) => Number(n) > 0 && Number(n) <= 3),
    `n = ${nValues.join(', ')}`)

  const barGroups = await svgTexts('.plot .xtick text')
  check('x-axis shows the genotype groups', barGroups.includes('WT') && barGroups.includes('AD'),
    barGroups.join(', '))
  await shot('02-bar-by-genotype')

  // The pseudo-replication guard, shown on a TRIAL-level measure. On a session-level measure
  // every unit would give the same n here, since each fixture rat has exactly one session.
  await pickMeasure('Percent Correct (%)') // deselect
  await pickMeasure('Correct Response Latency (s)')
  await page.waitForTimeout(500)
  const nBySubject = (await summaryRows()).map((r) => r.n)
  await page.locator('.chart-area select').first().selectOption('trial')
  await page.waitForTimeout(700)
  const nByTrial = (await summaryRows()).map((r) => r.n)
  check('per-rat n stays tiny while per-trial n is in the hundreds',
    Math.max(...nBySubject.map(Number)) <= 3 && Math.max(...nByTrial.map(Number)) > 50,
    `per rat n = ${nBySubject.join(', ')}; per trial n = ${nByTrial.join(', ')}`)
  await page.locator('.chart-area select').first().selectOption('subject')
  await page.waitForTimeout(400)
  await pickMeasure('Correct Response Latency (s)') // deselect
  await pickMeasure('Percent Correct (%)')
  await page.waitForTimeout(400)

  // ---------------------------------------------------------------- box ----------------
  await pickChart('Box plot')
  check('box plot renders', (await page.locator('.plot g.trace.boxes').count()) > 0)
  await shot('03-box-by-genotype')

  // --------------------------------------------------- line refused when unordered -----
  const lineBtn = testId('chart-types').getByRole('button', { name: /^Line graph|^Line/ })
  check('line graph is refused for an unordered x-axis like Genotype',
    await lineBtn.isDisabled(),
    (await lineBtn.innerText()).replace(/\s+/g, ' ').slice(0, 100))

  // ---------------------------------------------------- line on an ordered axis --------
  await pickVariable('group-session', 'x-chips', 'Genotype') // deselect
  await pickVariable('group-trial', 'x-chips', 'Separation Distance')
  await pickVariable('group-session', 'series-chips', 'Genotype')
  await pickChart('Line graph')
  check('line graph renders for Separation Distance',
    (await page.locator('.plot g.trace.scatter').count()) > 0)

  const distTicks = await svgTexts('.plot .xtick text')
  check('separation distance runs in numeric order from 1',
    distTicks[0] === '1' && distTicks.includes('13'), distTicks.join(' '))
  check('two genotype series are drawn with a legend',
    (await page.locator('.plot .legend text').count()) >= 2,
    (await svgTexts('.plot .legend text')).join(', '))

  // A session-level measure grouped by a trial-level variable used to render an empty figure.
  const distRows = await summaryRows()
  const distStats = distRows.map((r) => r.n)
  check('accuracy against separation distance actually contains data',
    distStats.length > 0 && distStats.every((n) => Number(n) > 0),
    `n per distance = ${[...new Set(distStats)].join(', ')}`)
  const distMeans = distRows.map((r) => r.Mean)
  check('accuracy per distance is a percentage, not a blank or a proportion',
    distMeans.every((m) => m !== '\u2014') && distMeans.some((m) => Number(m) > 1),
    `means = ${distMeans.slice(0, 4).join(', ')}\u2026`)
  await shot('04-line-accuracy-by-distance')

  // ------------------------------------------------ longitudinal: session number -------
  await pickVariable('group-trial', 'x-chips', 'Separation Distance') // deselect
  await pickVariable('group-session', 'x-chips', 'Session Number')
  check('session number is accepted as a longitudinal x-axis',
    await testId('chart-types').getByRole('button', { name: /^Line graph/ }).isEnabled())
  await pickVariable('group-session', 'x-chips', 'Session Number') // deselect
  await pickVariable('group-session', 'series-chips', 'Genotype') // deselect

  // ------------------------------------------------------------- histogram ------------
  await pickMeasure('Percent Correct (%)') // deselect
  await pickMeasure('Reward Collection Latency (s)')
  await pickChart('Histogram')
  check('histogram renders for a latency', (await page.locator('.plot g.trace.bars').count()) > 0)

  const histSummary = await testId('summary-table').innerText()
  check('histogram summary reports the trials with no reward as missing, not zero',
    /Missing/.test(histSummary))
  await shot('05-histogram-latency')

  // ------------------------------------------ custom latency ranges as an IV -----------
  await pickMeasure('Reward Collection Latency (s)') // deselect
  // Accuracy as the measure, latency ranges as the grouping — exactly the user's example.
  await pickMeasure('Percent Correct (%)')

  await pickVariable('group-range', 'x-chips', 'Correct Response Latency (s)')
  await page.waitForSelector('[data-testid="bin-editor"]', { timeout: 10_000 })
  check('choosing a latency as a grouping opens the range editor automatically', true)

  await testId('bin-editor').locator('select').selectOption('custom')
  await page.waitForTimeout(400)
  const edgeCount = await testId('bin-editor').locator('.bin-row input[type="number"]').count()
  check('custom mode starts from the cut points already on screen, not one empty range',
    edgeCount >= 1, `${edgeCount} cut point(s) seeded`)

  // Ask for three ranges, cut at 6 s and 12 s.
  await testId('bin-editor').locator('input[type="number"]').first().fill('3')
  await page.waitForTimeout(300)
  const edges2 = testId('bin-editor').locator('.bin-row input[type="number"]')
  await edges2.nth(0).fill('6')
  await page.waitForTimeout(200)
  await edges2.nth(1).fill('12')
  await page.waitForTimeout(500)

  const binTags = await testId('bin-editor').locator('.bin-tag').allInnerTexts()
  check('the ranges asked for are the ranges built',
    binTags.length === 3 && /< 6 s/.test(binTags[0]) && /6–12 s/.test(binTags[1]) && /≥ 12 s/.test(binTags[2]),
    binTags.map((t) => t.replace(/\s+/g, ' ')).join(' | '))
  check('each range reports how many observations it holds',
    binTags.every((t) => /n=\d+/.test(t)))

  await pickChart('Bar chart')
  const binTicks = await svgTexts('.plot .xtick text')
  check('the latency ranges become the x-axis, in the order defined and with no stray group',
    binTicks.length === 3 && /< 6/.test(binTicks[0]) && /6–12/.test(binTicks[1]) && /≥ 12/.test(binTicks[2]),
    binTicks.join(', '))
  await shot('06-custom-latency-bins')

  // ------------------------------------------------------- 600 DPI PNG export ----------
  const exportPanel = testId('export-panel')
  const panelText = await exportPanel.innerText()
  check('export panel defaults to 600 DPI and states the pixel size',
    panelText.includes('600 DPI') && /3,900 × 2,700 pixels/.test(panelText),
    panelText.match(/[\d,]+ × [\d,]+ pixels/)?.[0] ?? '')

  await exportPanel.getByRole('button', { name: /^Download PNG/ }).click()
  await page.waitForFunction(() => true)
  for (let i = 0; i < 40 && !found('.png'); i++) await page.waitForTimeout(500)

  const pngPath = found('.png')
  check('PNG downloads', Boolean(pngPath), pngPath ? pngPath.split('/').pop() : 'no download')
  if (pngPath) {
    const png = inspectPng(readFileSync(pngPath))
    check('PNG is a real 600 DPI render at the requested size',
      png.isPng && png.width === 3900 && png.height === 2700, `${png.width}×${png.height} px`)
    check('PNG declares 600 DPI, so layout software places it correctly',
      png.pixelsPerMetre === 23622,
      `pHYs ${png.pixelsPerMetre} px/m ≈ ${Math.round((png.pixelsPerMetre ?? 0) / 39.3700787402)} DPI`)
    check('pHYs is written immediately after IHDR, as the PNG spec requires',
      png.chunks[0] === 'IHDR' && png.chunks[1] === 'pHYs', png.chunks.slice(0, 4).join(' '))
  }

  // ------------------------------------------------------------- SVG export -----------
  await exportPanel.locator('select').first().selectOption('svg')
  await page.waitForTimeout(300)
  await exportPanel.getByRole('button', { name: /^Download SVG/ }).click()
  for (let i = 0; i < 20 && !found('.svg'); i++) await page.waitForTimeout(500)
  const svgPath = found('.svg')
  if (svgPath) {
    const svg = readFileSync(svgPath, 'utf8')
    check('SVG export is real vector output',
      svg.trimStart().startsWith('<svg') && svg.includes('</svg>') && svg.includes('<path'),
      `${(svg.length / 1024).toFixed(0)} kB`)
  } else check('SVG downloads', false, 'no download')

  // ----------------------------------------------------- plotted values CSV -----------
  await exportPanel.getByRole('button', { name: /numbers behind it/ }).click()
  for (let i = 0; i < 20 && !found('.csv'); i++) await page.waitForTimeout(500)
  const csvPath = found('.csv')
  if (csvPath) {
    const csv = readFileSync(csvPath, 'utf8')
    check('plotted-values CSV carries n, mean and SEM so a figure is reproducible',
      /n/.test(csv) && /Mean/.test(csv) && /SEM/.test(csv) && csv.split('\n').length > 2,
      csv.split('\n')[0])
  } else check('values CSV downloads', false, 'no download')

  // ------------------------------------------------------------ Excel export ----------
  await navTab('Data & Excel export').click()
  await page.waitForSelector('table.data')
  const tableText = await page.locator('.app-main .card').first().innerText()
  check('data table states the correction-trial setting in plain language',
    /first attempts only/.test(tableText))

  await page.getByRole('button', { name: 'Export to Excel' }).click()
  for (let i = 0; i < 60 && !found('.xlsx'); i++) await page.waitForTimeout(500)
  const xlsxPath = found('.xlsx')
  check('Excel workbook downloads', Boolean(xlsxPath), xlsxPath ? xlsxPath.split('/').pop() : 'no download')

  if (xlsxPath) {
    const { default: readXlsxFile } = await import('read-excel-file/node')
    const sheets = await readXlsxFile(xlsxPath)
    const names = sheets.map((s) => s.sheet)
    check('workbook has the four expected sheets',
      JSON.stringify(names) === JSON.stringify(['Trial Data', 'Session Summary', 'Subjects', 'Read Me']),
      names.join(', '))

    const trial = sheets.find((s) => s.sheet === 'Trial Data')
    const header = trial.data[0].map(String)
    const latencyCol = header.indexOf('Trial Analysis - Reward Collection Latency_Duration')
    const body = trial.data.slice(1)
    check('Trial Data stacks all three sessions', body.length === 68 + 72 + 14,
      `${body.length} rows (68 + 72 + 14 first attempts)`)
    const latencies = body.map((r) => r[latencyCol])
    check('absent latencies are blank in the spreadsheet, never zero',
      latencies.some((v) => v === null || v === undefined) && !latencies.some((v) => v === 0),
      `${latencies.filter((v) => typeof v === 'number').length} present, ${latencies.filter((v) => v == null).length} blank`)
    check('metadata is joined onto every trial row',
      header.includes('Genotype') && body.every((r) => ['WT', 'AD'].includes(r[header.indexOf('Genotype')])))

    const subjects = sheets.find((s) => s.sheet === 'Subjects')
    check('Subjects lists all 48 rats from the reference file', subjects.data.length === 49,
      `${subjects.data.length - 1} rats`)

    const readme = sheets.find((s) => s.sheet === 'Read Me').data.flat()
      .filter((c) => typeof c === 'string').join('\n')
    check('Read Me records the latency fix and the settings used',
      /will not match an ABET CSV/.test(readme) && /Excluded/.test(readme))
  }
  await shot('07-data-table')

  // -------------------------------------------------------------- presets -------------
  await navTab('Visualisation playground').click()
  await page.waitForSelector('.playground')
  // Start from a known selection: the chips are toggles, so clicking one that an earlier step
  // left active would switch it off rather than on.
  const clearSelection = page.getByRole('button', { name: 'Clear selection', exact: true })
  if (await clearSelection.count()) {
    await clearSelection.click()
    await page.waitForTimeout(300)
  }
  await pickMeasure('Percent Correct (%)')
  await pickVariable('group-session', 'x-chips', 'Genotype')
  await pickChart('Bar chart')

  const presets = testId('preset-panel')
  await presets.locator('input[type="text"]').fill('Accuracy by genotype')
  await presets.locator('[data-testid="save-preset"]').click()
  await page.waitForTimeout(400)
  check('an analysis can be saved as a preset',
    (await presets.locator('.preset-list li').count()) === 1,
    (await presets.locator('.preset-open span').first().innerText()).replace(/\s+/g, ' '))

  const stored = await page.evaluate(() => localStorage.getItem('tunl-parser.presets.v1') ?? '')
  check('a preset stores chart settings only, never animal data',
    stored.length > 0 && !/LZ\d|\.xml|\.xlsx/.test(stored),
    `${stored.length} bytes stored`)

  // Reloading clears the data but must keep the preset — that is the whole point.
  const shareUrl = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('tunl-parser.presets.v1'))[0]
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(p))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `${location.origin}${location.pathname}#preset=${b64}`
  })
  await page.reload({ waitUntil: 'networkidle' })
  check('reloading clears the data, as designed',
    (await page.locator('.dropzone').count()) === 1)

  // A shared link, opened cold, reproduces the analysis once files are loaded.
  await page.goto(shareUrl, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type="file"]', [
    join(FIXTURES, 'example-input_1.xml'),
    join(FIXTURES, 'example-output_2.xml'),
    join(FIXTURES, 'example-output_3.xml'),
    join(FIXTURES, 'Rat Info.xlsx'),
  ])
  await page.getByRole('button', { name: /^Load 3 sessions/ }).click()
  await page.waitForSelector('.playground', { timeout: 30_000 })
  await page.waitForTimeout(600)

  const activeMeasures = await testId('measure-chips').locator('button').evaluateAll((bs) =>
    bs.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()))
  check('a shared preset link reproduces the analysis for someone else',
    activeMeasures.length === 1 && /^Percent Correct/.test(activeMeasures[0]),
    activeMeasures.join(', '))
  check('the link is consumed, so reloading does not snap the analysis back',
    (await page.evaluate(() => location.hash)) === '')
  await shot('09-presets')

  // -------------------------------------------------------------- dark mode -----------
  await page.getByRole('button', { name: /Switch to dark mode/i }).click()
  await navTab('Visualisation playground').click()
  await page.waitForSelector('.plot .main-svg', { timeout: 20_000 })
  await page.waitForTimeout(800)
  const bg = await page.locator('.plot .main-svg').first().evaluate((svg) => {
    const rect = svg.querySelector('rect.bg')
    return rect?.getAttribute('style') ?? rect?.getAttribute('fill') ?? svg.getAttribute('style') ?? ''
  })
  check('dark mode restyles the figure itself, not only the page chrome',
    /26,\s*26,\s*25/.test(bg) || bg.toLowerCase().includes('#1a1a19'), bg)
  await shot('08-dark-mode')

  // --------------------------------------------------------------- console ------------
  const realErrors = consoleErrors.filter(
    (e) => !/deprecat|passive event listener|Failed to load resource.*favicon/i.test(e),
  )
  check('no console errors during the whole walkthrough', realErrors.length === 0,
    realErrors.slice(0, 3).join(' | '))
} catch (error) {
  check('walkthrough ran without throwing', false, String(error).split('\n')[0].slice(0, 300))
  await shot('99-failure')
} finally {
  await browser.close()
}

writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2))
console.log(
  `\n${failures === 0 ? '[32m' : '[31m'}${results.length - failures}/${results.length} checks passed[0m`,
)
console.log(`artifacts in ${OUT_DIR}`)
process.exit(failures === 0 ? 0 : 1)
