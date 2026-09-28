(function (root) {
  'use strict';

  var SP = (root.SP = root.SP || {});

  function empty() {
    return { project: '', tag: '', done: '', from: '', to: '' };
  }

  function isActive(f) {
    return !!(f && (f.project || f.tag || f.done || f.from || f.to));
  }

  function inRange(day, f) {
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  }

  function apply(store, f) {
    if (!isActive(f)) return store;

    var days = store.days.filter(function (d) { return inRange(d, f); });
    var active = new Set(days);

    var tasks = store.tasks.filter(function (t) {
      if (f.project && t.projectId !== f.project) return false;
      if (f.tag && t.tagIds.indexOf(f.tag) === -1) return false;
      if (f.done === 'done' && !t.isDone) return false;
      if (f.done === 'open' && t.isDone) return false;
      if (f.from || f.to) {
        var hasTime = Object.keys(t.timeSpentOnDay).some(function (d) { return active.has(d); });
        var createdDay = SP.ingest.localDayKey(t.created);
        var doneDay = SP.ingest.localDayKey(t.doneOn);
        var eventInRange = (createdDay && active.has(createdDay)) || (doneDay && active.has(doneDay));
        if (!hasTime && !eventInRange) return false;
      }
      return true;
    });

    var tasksById = new Map();
    tasks.forEach(function (t) { tasksById.set(t.id, t); });

    var keptProjects = new Set();
    var keptTags = new Set();
    tasks.forEach(function (t) {
      keptProjects.add(t.projectId);
      t.tagIds.forEach(function (id) { keptTags.add(id); });
    });

    var projectSessions = {};
    Object.keys(store.projectSessions).forEach(function (pid) {
      if (f.project && pid !== f.project) return;
      if (f.tag && !keptProjects.has(pid)) return;
      var kept = {};
      Object.keys(store.projectSessions[pid]).forEach(function (day) {
        if (active.has(day)) kept[day] = store.projectSessions[pid][day];
      });
      if (Object.keys(kept).length) projectSessions[pid] = kept;
    });

    var tagSessions = {};
    Object.keys(store.tagSessions).forEach(function (tid) {
      if (f.tag && tid !== f.tag) return;
      if (f.project && !keptTags.has(tid)) return;
      var kept = {};
      Object.keys(store.tagSessions[tid]).forEach(function (day) {
        if (active.has(day)) kept[day] = store.tagSessions[tid][day];
      });
      if (Object.keys(kept).length) tagSessions[tid] = kept;
    });

    var focus = {};
    Object.keys(store.focus).forEach(function (day) {
      if (active.has(day)) focus[day] = store.focus[day];
    });

    var plannerDays = {};
    Object.keys(store.plannerDays).forEach(function (day) {
      if (active.has(day)) plannerDays[day] = store.plannerDays[day];
    });

    var derived = Object.assign({}, store, {
      tasks: tasks,
      tasksById: tasksById,
      days: days,
      activeDays: days,
      projectSessions: projectSessions,
      tagSessions: tagSessions,
      focus: focus,
      plannerDays: plannerDays,
      filtered: true,
      filter: f
    });
    return derived;
  }

  function chips(store, f) {
    var out = [];
    if (f.project) {
      var p = store.projectsById[f.project] || { title: f.project };
      out.push({ key: 'project', label: 'Project: ' + p.title });
    }
    if (f.tag) {
      var t = store.tagsById[f.tag] || { title: f.tag };
      out.push({ key: 'tag', label: 'Tag: ' + t.title });
    }
    if (f.done) out.push({ key: 'done', label: 'State: ' + (f.done === 'done' ? 'Done' : 'Not done') });
    if (f.from) out.push({ key: 'from', label: 'From: ' + f.from });
    if (f.to) out.push({ key: 'to', label: 'To: ' + f.to });
    return out;
  }

  SP.filter = { empty: empty, isActive: isActive, apply: apply, chips: chips, inRange: inRange };
})(typeof globalThis !== 'undefined' ? globalThis : this);
