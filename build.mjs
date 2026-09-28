import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

const SRC_ORDER = ['ingest.js', 'aggregate.js', 'filter.js', 'charts.js', 'views.js', 'app.js'];
const VENDOR_FILE = 'vendor/echarts.min.js';
const INDEX_FILE = 'src/index.html';
const STYLE_FILE = 'src/styles.css';
const OUT_FILE = 'dashboard.html';
const FIXTURE = 'sp-backup-anonymized_2026-09-28_121811.json';

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function build() {
  const html = read(INDEX_FILE);
  const css = read(STYLE_FILE);
  const parts = [read(VENDOR_FILE)].concat(SRC_ORDER.map((f) => read(join('src', f))));
  const js = parts.join('\n;\n');

  const out = html
    .replace('<!--INLINE_STYLES-->', () => css)
    .replace('<!--INLINE_SCRIPTS-->', () => '<script>\n' + js + '\n</' + 'script>');

  writeFileSync(join(root, OUT_FILE), out);
  return out.length;
}

const failures = [];
const passes = [];

function check(label, actual, expected) {
  if (actual === expected) {
    passes.push(label + ' = ' + actual);
  } else {
    failures.push(label + ': expected ' + expected + ', got ' + actual);
  }
}

function checkClose(label, actual, expected, tolerance) {
  if (Math.abs(actual - expected) <= (tolerance || 0)) {
    passes.push(label + ' = ' + actual);
  } else {
    failures.push(label + ': expected ~' + expected + ', got ' + actual);
  }
}

async function loadModules() {
  for (const name of ['ingest.js', 'aggregate.js', 'filter.js']) {
    await import(pathToFileURL(join(root, 'src', name)).href);
  }
  return globalThis.SP;
}

function trackedTotal(store) {
  return store.tasks.reduce((sum, t) => {
    return sum + Object.keys(t.timeSpentOnDay).reduce((s, day) => s + t.timeSpentOnDay[day], 0);
  }, 0);
}

function sessionDayCount(store) {
  const days = new Set();
  for (const dim of ['projectSessions', 'tagSessions']) {
    for (const ctx of Object.keys(store[dim])) {
      for (const day of Object.keys(store[dim][ctx])) days.add(day);
    }
  }
  return days.size;
}

function sessionCount(store, which) {
  const table = store[which];
  return Object.keys(table).reduce((n, ctx) => n + Object.keys(table[ctx]).length, 0);
}

async function selftest() {
  const SP = await loadModules();
  const text = read(FIXTURE);
  const parsed = SP.ingest.parseText(text);

  check('envelope detected', parsed.kind, 'backup');
  check('crossModelVersion', parsed.meta.crossModelVersion, 4.5);
  check('timestamp present', parsed.meta.timestamp > 0, true);

  const store = SP.ingest.buildStore(parsed.data, parsed.meta, { name: FIXTURE });
  const A = SP.aggregate;

  check('live tasks', store.counts.live, 4);
  check('young tasks', store.counts.young, 9);
  check('old tasks', store.counts.old, 8);
  check('distinct tasks after merge', store.counts.merged, 21);
  check('projects (incl INBOX_PROJECT)', store.counts.projects, 5);
  check('tags', store.counts.tags, 4);

  check('tracked task time ms', trackedTotal(store), 47087081);
  check('days with tracked time', store.trackedDays.length, 9);
  check('days with any session', sessionDayCount(store), 14);
  check('sessionDayCount store', store.sessionDayCount, 14);
  check('days from any source', store.days.length, 19);

  check('project-day sessions deduped', sessionCount(store, 'projectSessions'), 14);
  check('tag-day sessions deduped', sessionCount(store, 'tagSessions'), 22);

  const projTotals = A.dimensionTotals(store, 'project');
  check('envelope total project ms', projTotals.envelopeMs, 88200000);
  check('break total project ms', projTotals.breakMs, 10633409);
  const tagDims = A.dimensionTotals(store, 'tag');
  check('envelope total tag ms', tagDims.envelopeMs, 197640000);

  const focus = A.focusSummary(store);
  check('focus blocks', focus.blocks, 15);
  check('focus ms', focus.ms, 18516551);
  check('focus days', focus.days.length, 3);

  check('planner days', Object.keys(store.plannerDays).length, 10);
  check('dangling project+tag references', store.warnings.filter((w) => w.indexOf('Dangling') === 0).length, 0);

  const units = A.units(store);
  const matrix = A.projectDayMatrix(store, units);
  check('day-by-project matrix total ms', matrix.grandTotal, 47087081);
  checkClose('matrix vs tracked total', matrix.grandTotal, trackedTotal(store), 0);

  const perProject = {};
  for (const t of store.tasks) {
    perProject[t.projectId] = perProject[t.projectId] || { tasks: 0, ms: 0 };
    perProject[t.projectId].tasks += 1;
    perProject[t.projectId].ms += Object.values(t.timeSpentOnDay).reduce((a, b) => a + b, 0);
  }
  const expectProjects = {
    'Q5yjPgSB20PmrUktiCpOx': { tasks: 3, ms: 22026215, hours: 6.118 },
    'Fhr_6s1XcEdVxDhom2ZaJ': { tasks: 2, ms: 17732825, hours: 4.926 },
    'INBOX_PROJECT': { tasks: 4, ms: 5400000, hours: 1.5 },
    'rFQtaznNDPRTjdB_yC0Dz': { tasks: 5, ms: 1928041, hours: 0.536 },
    'G3ZiRwruqGIQgsSw-26mW': { tasks: 7, ms: 0, hours: 0.0 }
  };
  for (const [id, want] of Object.entries(expectProjects)) {
    const got = perProject[id] || { tasks: 0, ms: 0 };
    check('project ' + id + ' tasks', got.tasks, want.tasks);
    check('project ' + id + ' tracked ms', got.ms, want.ms);
    checkClose('project ' + id + ' hours', Number(((matrix.projectTotals[id] || 0) / 3600000).toFixed(3)), want.hours, 0.001);
  }

  const day = A.dayDetail(store, '2026-05-24', units);
  check('2026-05-24 has tracked rows', day.rows.length > 0, true);
  check('2026-05-24 chip absent', day.overEnvelope, false);
  const bad = A.dayDetail(store, '2026-05-16', units);
  check('2026-05-16 chip fires', bad.overEnvelope, true);

  check('2026-05-24 tracked total ms', day.trackedTotal, 8721780);
  check('2026-05-16 tracked total ms', bad.trackedTotal, 11835893);

  const quad = A.quadrants(store, units);
  check('quadrant panels', quad.panels.length, 4);
  check('quadrant total ms', quad.panels.reduce((a, p) => a + p.ms, 0) > 0, true);

  const digest = A.digest(store, units);
  check('digest completed in range', digest.completed.length > 0, true);

  const ev = A.estimateVsActual(store, units);
  check('estimate rows', ev.rows.length > 0, true);

  const tags = A.tagTotals(store, units);
  check('tag attributed total exceeds tracked', tags.total > trackedTotal(store), true);

  const csv = SP.ingest.parseText('Date;Start;End\n2026-05-24;10:00;11:00\n');
  check('csv routed to seam', csv.kind, 'csv');
  const junk = SP.ingest.parseText('{"hello":"world"}');
  check('junk routed to unrecognized', junk.kind, 'unrecognized');

  const bare = SP.ingest.parseText(JSON.stringify(parsed.data));
  check('bare data object accepted', bare.kind, 'backup');

  const f = SP.filter;
  const oneProject = f.apply(store, Object.assign(f.empty(), { project: 'Q5yjPgSB20PmrUktiCpOx' }));
  const oneProjectTotal = A.stats(oneProject).trackedMs;
  checkClose('filter one project total hours', Number((oneProjectTotal / 3600000).toFixed(3)), 6.118, 0.001);

  const ranged = f.apply(store, Object.assign(f.empty(), { from: '2026-05-16', to: '2026-05-16' }));
  check('filter to one day keeps one day', A.activeDays(ranged).length, 1);
  check('filter to 2026-05-16 tracked ms', A.stats(ranged).trackedMs, 11835893);

  console.log('\nsp-dash selftest');
  console.log('  fixture: ' + FIXTURE);
  passes.forEach((p) => console.log('  ok   ' + p));
  if (failures.length) {
    console.log('');
    failures.forEach((f2) => console.log('  FAIL ' + f2));
    console.log('\n' + failures.length + ' failed, ' + passes.length + ' passed');
    return false;
  }
  console.log('\n' + passes.length + ' checks passed');
  return true;
}

const args = process.argv.slice(2);
const wantSelftest = args.includes('--selftest');
const noBuild = args.includes('--no-build');

if (wantSelftest) {
  const ok = await selftest();
  if (!ok) process.exit(1);
}

if (!noBuild) {
  const size = build();
  const kb = (statSync(join(root, OUT_FILE)).size / 1024).toFixed(0);
  console.log('wrote ' + OUT_FILE + ' (' + kb + ' KB, ' + SRC_ORDER.length + ' modules + ' + VENDOR_FILE + ')');
}
