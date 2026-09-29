# TUNL Parser

A browser tool that turns ABET II TUNL touchscreen exports into figures, statistics and a tidy
spreadsheet — without anyone needing to write code.

---

## TL;DR

- **What it does.** Drop in a batch of ABET session XML files plus one subject-info spreadsheet.
  Click variables to explore them. Export publication-resolution figures and a multi-sheet Excel
  workbook.
- **Nothing is uploaded.** Every file is read inside your browser. There is no backend, no
  database and no storage on the server, so data cannot outlive the tab it was opened in.
- **Nothing to install.** Open the URL. It works in any current browser.
- **It corrects a fault in ABET's own CSV export.** Response-latency columns are matched to the
  trial they actually belong to; ABET's export lists them positionally and puts most of them in
  the wrong row. See [Why latencies differ from ABET](#why-latencies-differ-from-abet).
- **It is opinionated where the statistics matter.** Correction trials are excluded by default,
  each data point defaults to one subject rather than one trial, and chart types that would
  misrepresent the data are refused with a reason.
- **Saved analyses are shareable.** Name a view to return to it later, or copy a link that
  reproduces it for a colleague.

---

## Quick-Launch

### If you just want to use it

1. Open the URL your administrator gave you.
2. Drag your ABET session `.xml` files onto the drop zone — as many as you like, or a whole
   folder — together with **one** subject-info `.xlsx`.
3. Press **Load**. Read the panel that appears: it says what came through and flags anything that
   needs a look.
4. Go to **Visualisation playground**, click **Percent Correct**, then click **Genotype** (or any
   other grouping) and pick a chart type on the right.
5. Export the figure, or switch to **Data & Excel export** for the whole dataset.

Stuck on step 4? The chart types you cannot use stay greyed out and say why.

### If you are deploying it

Requires Docker, plus Node 20+ only if you intend to develop or run the tests.

```sh
git clone <this-repo> && cd <this-repo>
./scripts/docker-run.sh          # builds the image and starts the container
```

The script prints the URL to hand out. The service listens on **port 8477** on every network
interface, so on a Linux host anyone on the same network can reach
`http://<server-ip>:8477` — no port forwarding, no extra configuration.

```sh
PORT=9000 ./scripts/docker-run.sh   # publish on a different port
./scripts/docker-run.sh --stop      # stop and remove the container
```

If the host runs a firewall, open the port once: `sudo ufw allow 8477/tcp`.

### If you are developing it

```sh
./scripts/setup.sh        # one time: check Node, install dependencies
./scripts/test.sh         # typecheck + unit tests — start here, no browser needed
./scripts/dev.sh          # dev server with hot reload, reachable on the network
./scripts/build.sh        # build and serve the production bundle locally
./scripts/e2e.sh          # drive the built app in a real browser, end to end
./scripts/docker-run.sh   # build and run the container, as it runs in production
```

---

## What you need

| File | What it is |
|---|---|
| **Session files** | One or more ABET II `.xml` exports. Each file is one subject in one chamber for one schedule run. |
| **Subject info** | One `.xlsx` with a row per subject. A column identifying the subject is required; genotype, sex, birthday and cohort are used if present. |

The subject-info sheet supplies the grouping variables ABET does not record. Column headings are
matched loosely, so extra spaces and minor wording differences are fine, and the identifier is
matched with spacing and capitalisation ignored — the two files often disagree on formatting.

Anything the sheet cannot supply is reported rather than guessed. A subject missing from it still
loads and can still be analysed; it simply has no genotype or cohort.

---

## Using the app

### 1. Load data

Drop the files in and press Load. The panel that follows reports how many sessions and subjects
came through, which groups and conditions were found, and any of the following:

- a subject present in the session files but missing from the subject-info sheet
- a field the two sources disagree on
- the same session run loaded twice
- a file that could not be read — the rest of the batch still loads

None of these block you. They exist so a surprise in a figure has an explanation.

### 2. Visualisation playground

Click a **measure** on the left to activate it. Click more than one to get a panel each. Then
choose what to group it by: an **x-axis**, and optionally a second variable to **split into
series**.

Five views are available, and only the ones that suit your selection are offered:

| View | Use it for |
|---|---|
| **Summary statistics** | n, total, mean, SD, SEM, median, quartiles, range, missing count |
| **Histogram** | the shape of one distribution |
| **Bar chart** | comparing group averages, with error bars |
| **Box plot** | the spread a bar chart hides |
| **Line graph** | change across an ordered axis — sessions over time, or task difficulty |

A line graph is offered only when the x-axis has a real order. Joining unordered categories with
a line would imply a progression that is not in the data, so the app refuses and says so.

### 3. Export

Figures export as **PNG at 300, 600 or 1200 DPI** — genuinely re-rendered at that resolution and
tagged so page-layout software places them at the right physical size — or as **SVG**, which is
resolution-independent. The numbers behind any figure download as CSV, so a plot is always
checkable.

**Data & Excel export** gives the whole dataset as a workbook of four sheets: every trial, a row
per session, the subject list, and a Read Me recording the settings the export was made under.

---

## Things worth knowing

These are the places where a reasonable-looking number can mislead.

- **Correction trials are excluded by default.** ABET repeats a trial after an error, keeping the
  same trial number, so one trial can appear several times. Leaving the repeats out makes accuracy
  match the figure ABET itself reports. The toggle is under *Options*, and it applies to the
  figures and the Excel export together — so they always describe the same trials. When repeats
  are included, each one is scored by the image the rat actually touched: ABET's own
  `No. Correct` is 0 on every repeat, even a correct one, so the exported Trial Data sheet adds a
  *Correct* column that scores every attempt.
- **"Each point is" changes what n means.** It defaults to *Each rat*, averaging within each
  subject before groups are compared: first within each session, then across the rat's sessions,
  so every session counts equally however many trials it had. Switching to *Each trial* makes n the number of trials,
  which inflates it by orders of magnitude and will make almost any difference look large. That is
  rarely what you want for a group comparison.
- **Missing is not zero.** A trial where no reward was collected has no reward latency. Such
  trials are left out of averages rather than counted as zero seconds, and the count is reported
  in the *Missing* column. Missing counts the same kind of data point as n, so with *Each rat* it
  is the rats that have no value at all; n plus Missing is always every rat, session or trial in
  the group.
- **n, Total and Mean answer different questions.** *n* is the number of data points — subjects,
  sessions or trials, whichever you chose. *Total* is how many altogether. *Mean* is how many
  each. Total appears only for counts, because summing percentages or latencies has no meaning.
- **Latency ranges turn a measure into a grouping variable.** Under *Group by a measure's range*,
  picking a latency opens an editor where you set the cut points — say under 6 s, 6–12 s, and
  above — and each range becomes a group. Note that a latency only exists on trials of the
  matching outcome, so a correct-response latency exists only on correct trials; pair it with a
  measure that is not determined by that outcome, or the result is true by construction.
- **Touch counters come in two forms.** The per-trial counters are shown by default: their mean is
  touches per trial, which stays comparable across subjects that ran different numbers of trials,
  and the *Total* column gives the absolute number. The whole-session counters are under
  *Show all*, because ABET tallies some touches session-wide without attributing them to any
  trial — so a session total can exceed the sum of the per-trial counts. Use the per-trial form
  for analysis, and the whole-session form when you need the machine's own figure exactly.

---

## Saving an analysis

Set a view up the way you want it, name it under **Analysis presets**, and press *Create analysis
preset*. It remembers the measures, the grouping, the chart type, any ranges you set, and the
correction-trial setting.

A preset holds **only chart settings — never any data**. That is what makes saving one safe
without weakening the guarantee that data never outlives the tab. Two consequences:

- Presets are per browser and per machine. Clearing site data removes them, and a private window
  will not keep them past the tab.
- To give one to a colleague, press **Copy link**. Opening that link reproduces the same analysis
  against whatever files *they* load. The preset travels in the URL fragment, which browsers never
  transmit, so it never reaches the server or its logs.

Opening a preset against data that lacks one of its variables names the missing variable instead
of drawing a blank chart.

There is deliberately no server-side shared preset store: that would need somewhere writable on
the server, which means a backend, a volume and someone to curate it. Links cover the same need
with no infrastructure.

---

## Why latencies differ from ABET

The latency columns produced here do **not** match ABET's own CSV export. That is deliberate, and
it is the main reason this tool exists.

ABET's export lists latencies **positionally**: the first reward latency goes in the first row,
the second in the second row, and so on. But a reward latency only exists for trials that earned a
reward. As soon as a subject misses one, every subsequent value is one row too high, and the
trailing rows are left blank.

Every latency marker carries a timestamp, and every trial has an end time, so the trial an event
belongs to is recoverable exactly. This tool uses that mapping. The result is verifiable: each
latency lands in exactly one trial, no trial receives two of the same kind, and the outcome
categories partition the trials completely.

Every other column matches ABET cell for cell — the test suite asserts that against real exports.

The exported workbook's *Read Me* sheet records all of this, so anyone opening the file later
knows why it differs from a file the machine produced.

---

## Running the service

Because the container serves static files with no backend, no database and no volume, the "data
never leaves the browser" property is **structural** rather than configured — there is nowhere for
data to be written even in principle.

### Network access

The container listens on all interfaces: Docker publishes `0.0.0.0:8477` and nginx binds every
interface inside the container. Nothing is bound to loopback. Confirm with:

```sh
docker port tunl-parser        # expect: 8477/tcp -> 0.0.0.0:8477
```

**Hosting from Windows via WSL2 needs one extra step.** WSL2 runs behind a NAT on a virtual
switch, so its address is reachable from the Windows host but not from anything else on the
network — and it changes on every reboot. `scripts/docker-run.sh` detects this and prints the
options. The cleanest is mirrored networking on Windows 11:

```ini
; %UserProfile%\.wslconfig  — then run: wsl --shutdown
[wsl2]
networkingMode=mirrored
```

The alternative is a Windows port proxy plus a firewall rule, repeated after every reboot. For
anything a team depends on, a Linux host avoids all of it.

### Verifying a change

Run `./scripts/test.sh` after touching the parser. It compares parsed output against real ABET
exports cell by cell and pins the latency alignment in place, so a regression fails here rather
than turning up in someone's figure.

Run `./scripts/e2e.sh` before deploying, then again against the running container
(`./scripts/e2e.sh http://<host>:8477`). Both matter: some failures appear only in the container,
because the figure exporter manipulates PNG bytes and the spreadsheet writer spawns a Web Worker,
and both behave differently under the container's Content-Security-Policy than under a dev server
that sets none.

---

## Layout

```
app/                        the React application
  src/parse/                XML and subject-info parsing, metadata join
  src/analysis/             rows, grouping, statistics, range binning
  src/charts/               chart specs, figure building, theme
  src/export/               figure export (DPI-tagged PNG, SVG) and the Excel workbook
  src/tabs/                 the three screens
  src/presets.ts            saved analyses and shareable links
  e2e/walkthrough.mjs       end-to-end browser walkthrough
scripts/                    development and deployment scripts
tunl-parser/example-files/  sample exports, used as test fixtures
Dockerfile, nginx.conf      deployment
```

`main.py`, `pyproject.toml` and `.venv` are left over from an earlier prototype and are not used.

---

## How the export format is read

Useful if you are extending the parser or adapting it to another schedule.

- **`SessionInformation`** supplies the animal identifier, sex, schedule name, test date and
  related fields. The retention delay appears nowhere else in the file, so it is read from the
  schedule name — a trailing `20s` becomes a 20-second delay.
- **`MarkerData`** is a flat list grouped **by marker name, not by trial**: every instance of the
  first marker, then every instance of the second, and so on. The Nth entry of each per-trial
  series therefore describes the same trial. Values live in `Results` (Evaluation markers),
  `Count` (Count markers) or `Time`/`Duration` (Measure markers, in microseconds). **An element
  with no value child means zero** for a per-trial counter, and means "did not happen" for a
  timed event — a distinction that matters, since treating an absent latency as zero would drag
  every average down.
- **Which marker block describes trials** is worked out from the data rather than hardcoded, so a
  renamed or unfamiliar schedule still parses. Unrecognised markers appear with a generated label
  rather than being dropped.
- **Subject info** is joined on the identifier with whitespace removed and capitalisation ignored,
  because the two sources routinely disagree on formatting — sometimes inconsistently within a
  single file. Dates stored as bare spreadsheet serial numbers are converted. Sex is the one field
  both sources record, and the subject-info sheet wins: sex belongs to the rat, while the session
  file's Sex is typed per session and can vary between a rat's sessions, which would put one rat in
  both groups. The session file fills in only for a rat the sheet has no sex for, and only if all
  of that rat's sessions agree. Any disagreement is reported rather than silently resolved.
