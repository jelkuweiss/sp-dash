# sp-dash

A local dashboard for work tracked in [Super Productivity](https://super-productivity.com),
rebuilt from that app's backup JSON exports.

Everything lives in one file: `dashboard.html`. Double-click it and it opens in your browser. It
makes no network requests, runs no server, and needs no terminal. Drag a backup export onto it and
read the dashboard that appears. Nothing is stored: close the tab and it is gone.

## 1. Export your data from Super Productivity

1. Open **Settings** (the gear icon in the sidebar).
2. Choose the **Sync & Backup** tab.
3. Expand the **Import/Export** section.
4. Click **Export Data**.

That downloads a file named `sp-backup_YYYY-MM-DD_HHmmss.json`. That is the file you drop into the
dashboard.

Notes:

- On older versions of the app the tab is called **Sync & Export**; the button inside it is the same
  **Export Data**.
- Do **not** use **Export Data (anonymized)**. It is meant for sending bug reports to the
  developer, and it replaces every title and note with a placeholder like `title__15`.
- **Create Manual Backup** is a different button: it writes into the app's own `backups/` folder
  and never produces a file you can drop here.
- Exports are plain JSON, so you can inspect one in any text editor.

## 2. Open the dashboard

Double-click `dashboard.html`. Any current browser works (Chrome, Edge, Safari, Firefox). There is
no install step, no server, and no network access. The page is `file://` only, by design.

## 3. Load an export

Two ways, both equivalent:

- **Drag** the `sp-backup*.json` file anywhere onto the page.
- Click **Open export…** (or **Choose export…** on the empty screen) and pick the file.

To refresh, simply export again from the app and drop the new file: a second drop replaces the
first. Use **Clear** in the top bar to go back to the empty state.

## 4. Reading the dashboard

### The three time measures

These are different things and the dashboard never adds them together. Each is labelled where it
appears.

| measure | where it comes from | what it means |
|---|---|---|
| **Tracked task time** | the `timeSpentOnDay` counter on each task | the headline number: time the app attributed to a task on a day |
| **Envelope** | start (`s`) to end (`e`) of each recorded work session | wall-clock span of a work session on a project and day; includes breaks and idle gaps |
| **Focus blocks** | completed focus-mode sessions | deliberate focus only, and sparse: only days you used the focus timer |

Tracked time and the envelope disagree in both directions, and they are supposed to: a long session
with little tracked time has a big envelope, and a day of small sessions across many contexts can
have tracked time larger than any single project's envelope.

### Timeline: project by day

One bar per day, one coloured segment per project, height by tracked task time. Legend entries are
your project names. This is the main picture of where time went.

- **Granularity**: `Auto` keeps days until the visible range is more than 90 days (weeks) or 730
  days (months). Override with `Day`, `Week`, or `Month`.
- **Zoom and scrub**: drag the slider under the chart, or hold **Shift** and scroll to zoom.
- **Bars / Matrix**: `Matrix` swaps the bars for a table of project rows against day columns with
  row, column, and grand totals. The totals match the bars.
- **Click a bar** to select that day; the **Day** section below jumps to it. On week or month
  granularity, the day with the most tracked time in the bucket is selected.
- **PNG** saves the chart as an image, which is the sharing path.

### Day

The drill-down for one day, chosen by clicking a bar or by typing a date.

- One row per task that recorded tracked time that day, sorted longest first, with project, tags,
  duration, share of the day, your estimate, and done state.
- Sub-tasks are rolled into their parent; use the **sub-tasks** disclosure under a row to see what
  was inside it.
- A collapsed section lists tasks that were created, completed, or planned that day without tracked
  time, so an empty-looking day still shows what you moved.
- The strip at the bottom shows the day's **envelope** (`s` to `e`, break count, break time) and the
  day's **focus blocks**.
- A red **data quality** chip appears when tracked task time exceeds the day's envelope, which is
  arithmetically impossible. When you see it, the app recorded more task time than there was wall
  clock in the session. It is worth knowing about, not something the dashboard hides.

### Heatmap

A calendar covering every day in range, shaded by tracked task time, with a colour scale at the
bottom. Days with no tracked time are drawn as empty cells so gaps stay visible rather than being
skipped over.

### Estimates

Your estimate against what actually happened, per task.

- The scatter plots estimate (x) against actual (y) with the parity line. Points below the line
  finished early, points above ran long.
- The table lists each task's estimate, actual, signed deviation, and ratio.
- The summary row gives the aggregate bias: total actual divided by total estimate across the tasks
  that carry an estimate. Below 1.0x means you tend to finish under your estimates.

### Quadrants

Time and completion split by the tags your **Eisenhower Matrix** board uses, read from the board's
own panel definitions in the export rather than re-derived. Up to four panels: important and
urgent, important but not urgent, urgent but not important, and neither.

- **Tracked time** is tracked task time for parent tasks in that panel.
- **Completion** is done parent tasks over all parent tasks in the panel.
- The small line at the bottom of each panel prints the tag criteria it matched.
- If the export has no Eisenhower board, the section says so.

### Digest

The selected range as a summary: total tracked time, days in range, completed tasks with their
project and time, envelope and break totals, focus totals, attributed time by tag, and an
estimate-versus-actual line. The completed list is exactly the tasks marked done inside the selected
range.

## 5. Filters

The bar under the navigation filters every view at once, including the heatmap and the digest:

- **Project**, **Tag**, **State** (all, done, not done), and **From** / **To** dates.
- Active filters appear as chips next to the bar; click the `×` on a chip, or **Clear filters**, to
  return to the unfiltered numbers.
- Unfiltered is the default, so the heatmap starts as all history. Date range narrows the days that
  every measure is computed over.

Anything reported by the loader (for example, that the archive tiers overlapped and sessions were
deduped) is shown as a separate note chip above the filters. Notes are not filters.

## 6. Limits worth knowing

- **Backup JSON only.** Per-task clock times are not in the backup: the app buckets time by day
  before exporting. Per-task start and end times exist only in the worklog CSV, and CSV import is
  not built yet. Dropping a CSV shows a message and leaves the loaded data untouched.
- **All three tiers are merged.** Live tasks plus both archive tiers, deduplicated by id. Archived
  time is real time.
- **Tags are attributed time.** Every tag on a task receives that task's full time, so tag totals
  legitimately exceed the tracked total. They are not reconciled.
- **Sub-task time rolls into the parent** in every total; the day view can expand it.
- **Stateless.** No cookies, no localStorage, no IndexedDB. Reloading the page clears everything, so
  re-dropping your export is the normal workflow.
- **PNG export covers the three charts** (timeline, heatmap, estimates). The quadrant and digest
  sections are tables and have no PNG button.
- **Large exports** are parsed off the initial render, but a very large backup will still take a
  moment to load.

## 7. Rebuilding (developer notes)

The artifact is generated; `src/` is the source. `dashboard.html` is a single classic `<script>`
with ECharts and every module inlined, because `file://` forbids ES modules, `fetch`, and workers.

```
node build.mjs              # regenerate dashboard.html
node build.mjs --selftest   # run the fixture tripwires, then regenerate
node build.mjs --no-build   # selftest only
```

- `src/index.html` shell, `src/styles.css` styles
- `src/ingest.js` export to `Store`: tiers merged, sessions deduped, day index built
- `src/aggregate.js` pure functions over `Store`; `src/filter.js` derives a filtered `Store`
- `src/charts.js` ECharts options; `src/views.js` DOM rendering; `src/app.js` wiring
- `vendor/echarts.min.js` with `vendor/VERSION`; the fixture is the sample export

The self-test asserts the numbers in `DATA-MODEL.md` against the fixture, so a red check means the
pipeline broke, not that the export changed.
