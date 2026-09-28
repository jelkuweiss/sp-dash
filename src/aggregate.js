(function (root) {
  'use strict';

  var SP = (root.SP = root.SP || {});
  var ingest = SP.ingest || {};

  var MS_PER_HOUR = 3600000;

  function pad2(n) { return String(n).padStart(2, '0'); }

  function dayToDate(key) {
    var p = String(key).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function dateToDay(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(key, n) {
    var d = dayToDate(key);
    d.setDate(d.getDate() + n);
    return dateToDay(d);
  }

  function activeDays(store) {
    return store.activeDays && store.activeDays.length ? store.activeDays : store.days;
  }

  function daySetOf(store) {
    return new Set(activeDays(store));
  }

  function sumOverDays(map, daySet) {
    var total = 0;
    Object.keys(map).forEach(function (day) {
      if (!daySet || daySet.has(day)) total += map[day];
    });
    return total;
  }

  function units(store) {
    var parentOf = new Map();
    store.tasks.forEach(function (t) {
      t.subTaskIds.forEach(function (cid) {
        if (store.tasksById.has(cid)) parentOf.set(cid, t.id);
      });
      if (t.parentId && store.tasksById.has(t.parentId)) parentOf.set(t.id, t.parentId);
      t.subTasks.forEach(function (s) {
        if (s && typeof s.id === 'string' && store.tasksById.has(s.id)) parentOf.set(s.id, t.id);
      });
    });

    var rootMemo = new Map();
    function rootOf(id) {
      if (rootMemo.has(id)) return rootMemo.get(id);
      var seen = new Set();
      var cur = id;
      while (parentOf.has(cur)) {
        if (seen.has(cur)) break;
        seen.add(cur);
        cur = parentOf.get(cur);
      }
      rootMemo.set(id, cur);
      return cur;
    }

    var unitById = new Map();
    var order = [];
    var seenChild = new Set();

    store.tasks.forEach(function (t) {
      var rid = rootOf(t.id);
      var unit = unitById.get(rid);
      if (!unit) {
        var rootTask = store.tasksById.get(rid) || t;
        unit = {
          id: rid,
          task: rootTask,
          children: [],
          timeSpentOnDay: {},
          timeSpent: 0,
          timeEstimate: 0
        };
        unitById.set(rid, unit);
        order.push(unit);
      }
      Object.keys(t.timeSpentOnDay).forEach(function (day) {
        unit.timeSpentOnDay[day] = (unit.timeSpentOnDay[day] || 0) + t.timeSpentOnDay[day];
      });
      unit.timeSpent += t.timeSpent;
      unit.timeEstimate += t.timeEstimate;
      if (t.id !== rid && !seenChild.has(t.id)) {
        seenChild.add(t.id);
        unit.children.push(t);
      }
    });

    return order;
  }

  function projectColor(project, index) {
    if (project && project.color) return project.color;
    var palette = ['#29a1aa', '#ff4081', '#7c6cf0', '#f0a35e', '#4bb3e0', '#8bd450', '#e05f7f', '#b48ae0', '#3fbf9f', '#e0b93f'];
    return palette[index % palette.length];
  }

  function projectList(store, unitsList, totals) {
    var seen = new Map();
    (unitsList || units(store)).forEach(function (u) {
      var pid = u.task.projectId;
      if (!seen.has(pid)) seen.set(pid, true);
    });
    store.tasks.forEach(function (t) {
      if (!seen.has(t.projectId)) seen.set(t.projectId, true);
    });
    var ids = Array.from(seen.keys());
    ids.sort(function (a, b) {
      var ta = (totals && totals[a]) || 0;
      var tb = (totals && totals[b]) || 0;
      if (tb !== ta) return tb - ta;
      var pa = store.projectsById[a] || { title: a };
      var pb = store.projectsById[b] || { title: b };
      return String(pa.title).localeCompare(String(pb.title));
    });
    return ids.map(function (id, i) {
      var p = store.projectsById[id] || { id: id, title: id };
      return { id: id, title: p.title, color: projectColor(p, i), synthetic: !!p.synthetic };
    });
  }

  function projectDayMatrix(store, unitsList) {
    var list = unitsList || units(store);
    var dim = daySetOf(store);
    var byProject = {};
    var projectTotals = {};
    var dayTotals = {};
    var grandTotal = 0;

    list.forEach(function (u) {
      var pid = u.task.projectId;
      var bucket = byProject[pid] || (byProject[pid] = {});
      Object.keys(u.timeSpentOnDay).forEach(function (day) {
        if (dim && !dim.has(day)) return;
        var ms = u.timeSpentOnDay[day];
        bucket[day] = (bucket[day] || 0) + ms;
        dayTotals[day] = (dayTotals[day] || 0) + ms;
        projectTotals[pid] = (projectTotals[pid] || 0) + ms;
        grandTotal += ms;
      });
    });

    return {
      days: activeDays(store).slice(),
      projects: projectList(store, list, projectTotals),
      byProject: byProject,
      projectTotals: projectTotals,
      dayTotals: dayTotals,
      grandTotal: grandTotal
    };
  }

  function bucketKeyFor(day, gran) {
    if (gran === 'week') {
      var d = dayToDate(day);
      var dow = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dow);
      return dateToDay(d);
    }
    if (gran === 'month') return day.slice(0, 7) + '-01';
    return day;
  }

  function buildSeries(store, gran, unitsList) {
    var matrix = projectDayMatrix(store, unitsList);
    var days = matrix.days;
    var buckets = [];
    var index = new Map();

    days.forEach(function (day) {
      var key = bucketKeyFor(day, gran);
      if (!index.has(key)) {
        index.set(key, buckets.length);
        buckets.push({ key: key, start: day, end: day, days: [] });
      }
      var b = buckets[index.get(key)];
      b.days.push(day);
      if (day < b.start) b.start = day;
      if (day > b.end) b.end = day;
    });

    var values = {};
    matrix.projects.forEach(function (p) {
      values[p.id] = buckets.map(function () { return 0; });
    });

    matrix.projects.forEach(function (p) {
      var perDay = matrix.byProject[p.id] || {};
      Object.keys(perDay).forEach(function (day) {
        var bi = index.get(bucketKeyFor(day, gran));
        if (bi === undefined) return;
        values[p.id][bi] += perDay[day];
      });
    });

    buckets.forEach(function (b) {
      b.label = gran === 'day' ? b.key : gran === 'week' ? b.start + ' w' : b.key.slice(0, 7);
      b.total = 0;
      matrix.projects.forEach(function (p) { b.total += values[p.id][buckets.indexOf(b)]; });
    });

    var totals = buckets.map(function (b) { return b.total; });
    var grand = totals.reduce(function (a, b) { return a + b; }, 0);

    return {
      granularity: gran,
      buckets: buckets,
      segments: matrix.projects,
      values: values,
      totals: totals,
      grandTotal: grand,
      matrix: matrix
    };
  }

  function autoGranularity(store) {
    var days = activeDays(store);
    if (days.length > 730) return 'month';
    if (days.length > 90) return 'week';
    return 'day';
  }

  function envelopeByDay(store) {
    var dim = daySetOf(store);
    var out = {};
    Object.keys(store.projectSessions).forEach(function (pid) {
      var days = store.projectSessions[pid] || {};
      Object.keys(days).forEach(function (day) {
        if (dim && !dim.has(day)) return;
        var rec = days[day];
        var o = out[day] || (out[day] = { day: day, s: null, e: null, breakCount: 0, breakTime: 0, projects: [] });
        if (rec.s !== null && rec.s !== undefined) o.s = o.s === null ? rec.s : Math.min(o.s, rec.s);
        if (rec.e !== null && rec.e !== undefined) o.e = o.e === null ? rec.e : Math.max(o.e, rec.e);
        o.breakCount += rec.b || 0;
        o.breakTime += rec.bt || 0;
        if (o.projects.indexOf(pid) === -1) o.projects.push(pid);
      });
    });
    Object.keys(out).forEach(function (day) {
      var o = out[day];
      o.span = o.s !== null && o.e !== null ? Math.max(0, o.e - o.s) : 0;
    });
    return out;
  }

  function envelopeTotals(store) {
    var byDay = envelopeByDay(store);
    var days = Object.keys(byDay);
    var envelopeMs = 0;
    var breakMs = 0;
    var breaks = 0;
    days.forEach(function (day) {
      envelopeMs += byDay[day].span;
      breakMs += byDay[day].breakTime;
      breaks += byDay[day].breakCount;
    });
    return { byDay: byDay, envelopeMs: envelopeMs, breakMs: breakMs, breaks: breaks, dayCount: days.length };
  }

  function dimensionTotals(store, dim) {
    var table = dim === 'tag' ? store.tagSessions : store.projectSessions;
    var dimDays = daySetOf(store);
    var sessions = 0;
    var envelopeMs = 0;
    var breakMs = 0;
    var breaks = 0;
    Object.keys(table).forEach(function (ctx) {
      Object.keys(table[ctx]).forEach(function (day) {
        if (dimDays && !dimDays.has(day)) return;
        var rec = table[ctx][day];
        sessions += 1;
        if (rec.s !== null && rec.e !== null) envelopeMs += Math.max(0, rec.e - rec.s);
        breakMs += rec.bt || 0;
        breaks += rec.b || 0;
      });
    });
    return { sessions: sessions, envelopeMs: envelopeMs, breakMs: breakMs, breaks: breaks };
  }

  function tagTotals(store, unitsList) {
    var list = unitsList || units(store);
    var totals = {};
    list.forEach(function (u) {
      if (!u.timeSpent) return;
      u.task.tagIds.forEach(function (tid) {
        totals[tid] = (totals[tid] || 0) + u.timeSpent;
      });
    });
    var rows = Object.keys(totals).map(function (id) {
      var tag = store.tagsById[id] || { id: id, title: id, synthetic: true };
      return { id: id, title: tag.title, color: tag.color, isSystem: !!tag.isSystem, ms: totals[id] };
    });
    rows.sort(function (a, b) { return b.ms - a.ms; });
    return { rows: rows, total: rows.reduce(function (a, r) { return a + r.ms; }, 0) };
  }

  function estimateVsActual(store, unitsList) {
    var list = unitsList || units(store);
    var dim = daySetOf(store);
    var rows = [];
    var sumEstimate = 0;
    var sumActual = 0;
    var withEstimate = 0;
    var over = 0;
    var under = 0;

    list.forEach(function (u) {
      var actual = sumOverDays(u.timeSpentOnDay, dim);
      var estimate = u.timeEstimate || 0;
      if (!actual && !estimate) return;
      rows.push({
        id: u.id,
        title: u.task.title,
        projectId: u.task.projectId,
        projectTitle: (store.projectsById[u.task.projectId] || {}).title || u.task.projectId,
        estimate: estimate,
        actual: actual,
        deviation: actual - estimate,
        ratio: estimate > 0 ? actual / estimate : null,
        isDone: u.task.isDone,
        doneOn: u.task.doneOn
      });
      if (estimate > 0) {
        withEstimate += 1;
        sumEstimate += estimate;
        sumActual += actual;
        if (actual > estimate) over += 1; else if (actual < estimate) under += 1;
      }
    });

    rows.sort(function (a, b) { return b.actual - a.actual; });

    return {
      rows: rows,
      withEstimate: withEstimate,
      sumEstimate: sumEstimate,
      sumActual: sumActual,
      bias: sumEstimate > 0 ? sumActual / sumEstimate : null,
      over: over,
      under: under
    };
  }

  function panelMatches(panel, task) {
    var tags = new Set(task.tagIds);
    var inc = panel.includedTagIds || [];
    var exc = panel.excludedTagIds || [];
    var incKeys = panel.includedTagsMatch === 'all' ? 'every' : 'some';
    var excKeys = panel.excludedTagsMatch === 'all' ? 'every' : 'some';
    var incOk = inc.length === 0 ? true : inc[incKeys](function (t) { return tags.has(t); });
    var excHit = exc.length === 0 ? false : exc[excKeys](function (t) { return tags.has(t); });
    return incOk && !excHit;
  }

  var QUADRANT_MEANING = {
    URGENT_AND_IMPORTANT: 'urgent + important',
    NOT_URGENT_AND_IMPORTANT: 'important, not urgent',
    URGENT_AND_NOT_IMPORTANT: 'urgent, not important',
    NOT_URGENT_AND_NOT_IMPORTANT: 'neither urgent nor important'
  };

  function describePanel(panel, store) {
    var tagName = function (id) {
      var t = store.tagsById[id];
      return t ? t.title : id;
    };
    var inc = (panel.includedTagIds || []).map(tagName);
    var exc = (panel.excludedTagIds || []).map(tagName);
    var parts = [];
    if (inc.length) parts.push((panel.includedTagsMatch === 'all' ? 'all of: ' : 'any of: ') + inc.join(', '));
    if (exc.length) parts.push('excludes ' + exc.join(', '));
    return parts.join(' · ') || 'no tag criteria';
  }

  function quadrants(store, unitsList) {
    var list = unitsList || units(store);
    var board = null;
    store.boards.forEach(function (b) {
      if (b && b.id === 'EISENHOWER_MATRIX') board = b;
      else if (!board && b && Array.isArray(b.panels)) board = b;
    });
    if (!board) return { board: null, panels: [] };

    var panels = board.panels.map(function (panel) {
      var matching = list.filter(function (u) { return panelMatches(panel, u.task); });
      var ms = 0;
      var done = 0;
      var withTime = 0;
      matching.forEach(function (u) {
        ms += u.timeSpent;
        if (u.timeSpent) withTime += 1;
        if (u.task.isDone) done += 1;
      });
      return {
        id: panel.id,
        title: panel.title,
        meaning: QUADRANT_MEANING[panel.id] || panel.id,
        criteria: describePanel(panel, store),
        taskCount: matching.length,
        withTime: withTime,
        done: done,
        ms: ms,
        completion: matching.length ? done / matching.length : 0,
        siblingsOnly: panel.isParentTasksOnly !== false
      };
    });

    return { boardId: board.id, boardTitle: board.title, panels: panels };
  }

  function focusSummary(store) {
    var dim = daySetOf(store);
    var blocks = 0;
    var ms = 0;
    var days = [];
    Object.keys(store.focus).forEach(function (day) {
      if (dim && !dim.has(day)) return;
      var list = store.focus[day];
      blocks += list.length;
      ms += list.reduce(function (a, b) { return a + b; }, 0);
      days.push(day);
    });
    days.sort();
    return { blocks: blocks, ms: ms, days: days };
  }

  function dayDetail(store, day, unitsList) {
    var list = unitsList || units(store);
    var envelope = envelopeByDay(store)[day] || null;
    var focus = store.focus[day] || [];
    var focusMs = focus.reduce(function (a, b) { return a + b; }, 0);

    var rows = [];
    var trackedTotal = 0;

    list.forEach(function (u) {
      var own = u.timeSpentOnDay[day] || 0;
      if (!own) return;
      trackedTotal += own;
      var children = u.children
        .map(function (c) { return { id: c.id, title: c.title, ms: c.timeSpentOnDay[day] || 0, isDone: c.isDone }; })
        .filter(function (c) { return c.ms > 0; })
        .sort(function (a, b) { return b.ms - a.ms; });
      rows.push({
        id: u.id,
        title: u.task.title,
        projectId: u.task.projectId,
        projectTitle: (store.projectsById[u.task.projectId] || {}).title || u.task.projectId,
        tags: u.task.tagIds.map(function (tid) {
          var t = store.tagsById[tid] || { id: tid, title: tid };
          return { id: tid, title: t.title };
        }),
        ms: own,
        estimate: u.timeEstimate,
        isDone: u.task.isDone,
        doneOn: u.task.doneOn,
        children: children
      });
    });

    rows.sort(function (a, b) { return b.ms - a.ms; });

    var allDayKeys = new Map();
    store.tasks.forEach(function (t) {
      if (t.timeSpentOnDay[day]) return;
      var createdDay = ingest.localDayKey(t.created);
      var doneDay = ingest.localDayKey(t.doneOn);
      var isPlanned = (store.plannerDays[day] || []).indexOf(t.id) !== -1;
      if (createdDay === day || doneDay === day || isPlanned) {
        var parent = t.parentId && store.tasksById.get(t.parentId);
        allDayKeys.set(t.id, {
          id: t.id,
          title: t.title,
          projectId: t.projectId,
          projectTitle: (store.projectsById[t.projectId] || {}).title || t.projectId,
          isDone: t.isDone,
          doneOn: t.doneOn,
          created: t.created,
          done: doneDay === day,
          createdToday: createdDay === day,
          planned: isPlanned,
          parentTitle: parent ? parent.title : null
        });
      }
    });
    var noTime = Array.from(allDayKeys.values()).sort(function (a, b) {
      if (a.planned !== b.planned) return a.planned ? -1 : 1;
      return String(a.title).localeCompare(String(b.title));
    });

    var envelopeSpan = envelope && envelope.e !== null && envelope.s !== null ? Math.max(0, envelope.e - envelope.s) : 0;
    var overEnvelope = envelopeSpan > 0 && trackedTotal > envelopeSpan;

    return {
      day: day,
      rows: rows,
      trackedTotal: trackedTotal,
      noTime: noTime,
      envelope: envelope,
      envelopeSpan: envelopeSpan,
      focus: focus,
      focusMs: focusMs,
      overEnvelope: overEnvelope,
      planned: (store.plannerDays[day] || []).map(function (id) {
        var t = store.tasksById.get(id);
        return { id: id, title: t ? t.title : '(missing task)', isDone: t ? t.isDone : false };
      })
    };
  }

  function digest(store, unitsList) {
    var list = unitsList || units(store);
    var dim = daySetOf(store);
    var days = activeDays(store);
    var completed = [];
    var completedMs = 0;

    list.forEach(function (u) {
      if (!u.task.isDone) return;
      var doneDay = ingest.localDayKey(u.task.doneOn);
      if (!doneDay || (dim && !dim.has(doneDay))) return;
      var ms = sumOverDays(u.timeSpentOnDay, dim);
      completedMs += ms;
      completed.push({
        id: u.id,
        title: u.task.title,
        projectId: u.task.projectId,
        projectTitle: (store.projectsById[u.task.projectId] || {}).title || u.task.projectId,
        doneOn: u.task.doneOn,
        doneDay: doneDay,
        ms: ms,
        estimate: u.timeEstimate,
        childrenDone: u.children.filter(function (c) { return c.isDone; }).length
      });
    });

    completed.sort(function (a, b) { return b.doneOn - a.doneOn; });

    var trackedMs = 0;
    list.forEach(function (u) { trackedMs += sumOverDays(u.timeSpentOnDay, dim); });

    var focus = focusSummary(store);
    var env = envelopeTotals(store);
    var ev = estimateVsActual(store, list);
    var tags = tagTotals(store, list);

    return {
      completed: completed,
      completedMs: completedMs,
      trackedMs: trackedMs,
      dayCount: days.length,
      from: days.length ? days[0] : null,
      to: days.length ? days[days.length - 1] : null,
      focus: focus,
      envelopeMs: env.envelopeMs,
      breakMs: env.breakMs,
      breaks: env.breaks,
      tags: tags.rows,
      tagsTotal: tags.total,
      estimate: { sumEstimate: ev.sumEstimate, sumActual: ev.sumActual, bias: ev.bias, withEstimate: ev.withEstimate }
    };
  }

  function stats(store, unitsList) {
    var list = unitsList || units(store);
    var dim = daySetOf(store);
    var trackedMs = 0;
    var estimateMs = 0;
    var doneTasks = 0;
    list.forEach(function (u) {
      trackedMs += sumOverDays(u.timeSpentOnDay, dim);
      estimateMs += u.timeEstimate;
      if (u.task.isDone) doneTasks += 1;
    });
    var dayTotals = {};
    list.forEach(function (u) {
      Object.keys(u.timeSpentOnDay).forEach(function (day) {
        if (dim && !dim.has(day)) return;
        dayTotals[day] = (dayTotals[day] || 0) + u.timeSpentOnDay[day];
      });
    });
    return {
      trackedMs: trackedMs,
      estimateMs: estimateMs,
      units: list.length,
      tasks: store.tasks.length,
      doneUnits: doneTasks,
      trackedDayCount: Object.keys(dayTotals).length,
      dayCount: activeDays(store).length,
      dayTotals: dayTotals,
      projectTotals: projectDayMatrix(store, list).projectTotals
    };
  }

  function formatDuration(ms) {
    if (!ms) return '0m';
    var s = Math.round(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.round((s % 3600) / 60);
    if (h >= 24) {
      var d = Math.floor(h / 24);
      return d + 'd ' + (h % 24) + 'h';
    }
    if (h > 0) return h + 'h ' + (m < 10 ? '0' + m : m) + 'm';
    if (m > 0) return m + 'm';
    return s + 's';
  }

  function formatHours(ms) {
    return (ms / MS_PER_HOUR).toFixed(3);
  }

  function formatClock(epochMs) {
    if (epochMs === null || epochMs === undefined) return '—';
    var d = new Date(epochMs);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  SP.aggregate = {
    MS_PER_HOUR: MS_PER_HOUR,
    units: units,
    activeDays: activeDays,
    daySetOf: daySetOf,
    sumOverDays: sumOverDays,
    dayToDate: dayToDate,
    dateToDay: dateToDay,
    addDays: addDays,
    bucketKeyFor: bucketKeyFor,
    buildSeries: buildSeries,
    autoGranularity: autoGranularity,
    projectDayMatrix: projectDayMatrix,
    projectList: projectList,
    envelopeByDay: envelopeByDay,
    envelopeTotals: envelopeTotals,
    dimensionTotals: dimensionTotals,
    tagTotals: tagTotals,
    estimateVsActual: estimateVsActual,
    quadrants: quadrants,
    panelMatches: panelMatches,
    focusSummary: focusSummary,
    dayDetail: dayDetail,
    digest: digest,
    stats: stats,
    formatDuration: formatDuration,
    formatHours: formatHours,
    formatClock: formatClock
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
