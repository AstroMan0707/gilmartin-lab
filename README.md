# TUNL Parser

A browser app for the Gilmartin Lab that turns ABET II TUNL session exports into something you
can explore, plot and share. Load a batch of session XML files plus one `Rat Info` spreadsheet,
explore the data by clicking variables, and export publication-resolution figures and a tidy
Excel workbook.

Everything runs in the browser. No file is uploaded anywhere, nothing is written to the server,
and closing the tab clears the data.

## For lab members

Open the URL your lab server provides — nothing to install.

1. **Load data.** Drag in your session `.xml` files (as many as you like, or a whole folder)
   together with one `Rat Info.xlsx`. Check the panel that appears: it lists what was loaded and
   flags anything needing attention, such as a rat missing from the Rat Info file.
2. **Visualisation playground.** Click a measure on the left to activate it — *Percent Correct*
   is a good start. Then pick something to group it by, such as *Genotype* or *Separation
   Distance*. The chart types that make sense for your selection light up on the right; the ones
   that do not explain why.
3. **Export.** Figures download as PNG at 300, 600 or 1200 DPI, or as SVG. The numbers behind
   any figure download as CSV, so a plot is always checkable.
4. **Data & Excel export.** Browse the parsed data and download the whole dataset as a
   multi-sheet `.xlsx`.

### Things worth knowing

- **Correction trials are excluded by default.** ABET repeats a trial after an error, keeping
  the same `Trial No.`. Leaving repeats out makes accuracy match the figure ABET reports. The
  toggle is under *Options* in the playground; it applies to the figures and the Excel export
  together, so they always describe the same trials.
- **"Each point is" matters.** It defaults to *Each rat*, which averages within each animal
  before comparing groups. Switching to *Each trial* makes n the number of trials, which will
  make almost any difference look large and is usually not what you want for a group comparison.
- **Latency ranges.** Under *Group by a measure's range*, picking a latency opens an editor
  where you set the cut points — 1–6 s, 7–12 s, and so on — turning that latency into a grouping
  variable. Note that a latency only exists on trials of the matching outcome (*Correct Response
  Latency* only on correct trials), so pair it with a measure that is not determined by that
  outcome.
- **Missing is not zero.** A trial where the rat collected no reward has no reward latency.
  Those trials are left out of averages rather than counted as 0 s, and the count is reported.

### The latency fix

The latency columns in this app do **not** match ABET's own CSV export, and that is deliberate.

ABET's export lists latencies positionally: the first reward latency in row 1, the second in row
2, and so on. But a reward latency only exists for trials that earned a reward, so in a session
with 99 attempts and 67 rewards, every value after the first miss sits in the wrong row and the
last 32 rows are blank.

Each latency marker carries a timestamp and each trial has an end time, so the trial an event
belongs to is recoverable exactly. In the reference session that gives 67 reward latencies and
32 error latencies covering all 99 trials — one per trial, no collisions, and no trial with
both. This app uses that mapping. Every other column matches ABET cell for cell, and the test
suite asserts it against three real exports.

The exported workbook's *Read Me* sheet records this, so a colleague opening the file later
knows why it differs.

## For whoever runs the server

```sh
./scripts/setup.sh        # one time: check Node, install dependencies
./scripts/test.sh         # typecheck + unit tests (start here, no browser needed)
./scripts/dev.sh          # dev server with hot reload, reachable on the network
./scripts/build.sh        # build and serve the production bundle locally
./scripts/e2e.sh          # drive the built app in a real browser, end to end
./scripts/docker-run.sh   # build and run the container, as it runs on the server
```

Deploy with `./scripts/docker-run.sh`, then give colleagues the Network URL it prints. The app
serves on **port 8477**; `./scripts/docker-run.sh --stop` takes it down.

To publish on a different port without editing any file, set `PORT` — it changes only the
published side, so the container keeps serving 8477 internally:

```sh
PORT=9000 ./scripts/docker-run.sh
```

Because the container serves static files with no backend, no database and no volume, the "data
never leaves the browser" property is structural rather than configured.

### Network access

The container already listens on all interfaces — Docker publishes `0.0.0.0:8477` and nginx
binds every interface inside the container. Nothing is bound to loopback, so on an Ubuntu host
sitting on the school network, anyone on that network reaches it at `http://<server-ip>:8477`
with no port forwarding and no extra setup. Confirm with:

```sh
docker port tunl-parser        # expect: 8477/tcp -> 0.0.0.0:8477
```

If the server runs a firewall, open the port once:

```sh
sudo ufw allow 8477/tcp        # only if ufw is enabled; check with: sudo ufw status
```

**If you host from Windows via WSL2, that is not enough.** WSL2 runs behind a NAT on a virtual
switch, so its address (something like `172.24.x.x`) is reachable from the Windows host but not
from anything else on the network — and it changes on every reboot. `scripts/docker-run.sh`
detects WSL2 and prints the options; the short version is either enable mirrored networking on
Windows 11:

```ini
; %UserProfile%\.wslconfig  — then run: wsl --shutdown
[wsl2]
networkingMode=mirrored
```

or add a Windows port proxy and firewall rule in an elevated PowerShell (repeating it after each
reboot). For something the whole lab depends on, a Linux host on the network avoids all of this.

The one `127.0.0.1` in the repo is in `scripts/e2e.sh`, where the temporary test server is
deliberately local-only.

### Verifying a change

Run `./scripts/test.sh` after touching the parser — it compares the parsed output against the
real ABET exports in `tunl-parser/example-files/` cell by cell, and pins the latency alignment
in place.

Run `./scripts/e2e.sh` before deploying, and again against the container
(`./scripts/e2e.sh http://<host>:8477`). Some failures only appear there: the export path
manipulates PNG bytes and the `.xlsx` writer spawns a Web Worker, both of which behave
differently under the container's Content-Security-Policy than under the dev server, which sets
no CSP at all.

## Layout

```
app/                          the React application
  src/parse/                  XML and Rat Info parsing, metadata join
  src/analysis/               rows, grouping, statistics, range binning
  src/charts/                 chart specs, Plotly figure building, theme
  src/export/                 figure export (DPI-tagged PNG, SVG) and the Excel workbook
  src/tabs/                   the three screens
  e2e/walkthrough.mjs         browser walkthrough
scripts/                      dev and deploy scripts
tunl-parser/example-files/    real ABET exports, used as test fixtures
Dockerfile, nginx.conf        deployment
```

`main.py`, `pyproject.toml` and `.venv` are left over from an earlier prototype and are not used
by the app.

## How the data is read

- **`SessionInformation`** supplies `Animal ID`, `Sex`, `Schedule Name`, `Test Day` and the rest.
  The delay condition exists only in the schedule name (`Rat TUNL Full v2 20s` → 20 s).
- **`MarkerData`** is a flat list grouped *by marker name*, not by trial: all 99
  `Trial Analysis - Condition` elements, then all 99 `Trial Analysis - No. Correct`, and so on.
  Values live in `Results` (Evaluation), `Count` (Count), or `Time`/`Duration` (Measure, in
  microseconds). **An element with no value child means zero** for per-trial counters, and means
  "did not happen" for timed events.
- **Rat Info** is matched on the animal ID with whitespace removed and case folded, because the
  XML writes `LZ039` while the spreadsheet writes `LZ 039` — and inconsistently even within
  itself. Birthdays are stored as bare Excel serial numbers. Where both sources record a field
  the session file wins, and any disagreement is reported rather than silently resolved.
- **Which marker block describes trials** is worked out from the data rather than hardcoded, so
  a renamed or unfamiliar schedule still parses; unrecognised markers appear with a generated
  label instead of being dropped.
