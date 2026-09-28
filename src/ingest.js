(function (root) {
  'use strict';

  var SP = (root.SP = root.SP || {});

  var TIERS = ['live', 'young', 'old'];
  var UNKNOWN_PROJECT = '__unknown_project__';
  var UNKNOWN_TAG = '__unknown_tag__';

  function isObj(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function numOr(v, d) {
    return typeof v === 'number' && isFinite(v) ? v : d;
  }

  function taskEntities(data, tier) {
    if (!isObj(data)) return {};
    if (tier === 'live') return isObj(data.task) && isObj(data.task.entities) ? data.task.entities : {};
    var branch = data[tier === 'young' ? 'archiveYoung' : 'archiveOld'];
    if (!isObj(branch) || !isObj(branch.task) || !isObj(branch.task.entities)) return {};
    return branch.task.entities;
  }

  function sessionRoot(data, tier) {
    if (!isObj(data)) return null;
    if (tier === 'live') return isObj(data.timeTracking) ? data.timeTracking : null;
    var branch = data[tier === 'young' ? 'archiveYoung' : 'archiveOld'];
    return branch && isObj(branch.timeTracking) ? branch.timeTracking : null;
  }

  function looksLikeData(obj) {
    if (!isObj(obj)) return false;
    return isObj(obj.task) || isObj(obj.project) || isObj(obj.timeTracking) || obj.crossModelVersion !== undefined;
  }

  function isEnvelope(obj) {
    return isObj(obj) && isObj(obj.data) && looksLikeData(obj.data);
  }

  function detect(parsed) {
    if (isEnvelope(parsed)) {
      return {
        kind: 'backup',
        data: parsed.data,
        meta: {
          timestamp: numOr(parsed.timestamp, 0),
          lastUpdate: numOr(parsed.lastUpdate, 0),
          crossModelVersion: parsed.crossModelVersion
        }
      };
    }
    if (looksLikeData(parsed)) {
      return {
        kind: 'backup',
        data: parsed,
        meta: {
          timestamp: 0,
          lastUpdate: numOr(parsed.lastUpdate, 0),
          crossModelVersion: parsed.crossModelVersion
        }
      };
    }
    return { kind: 'unrecognized', reason: 'not a Super Productivity backup envelope' };
  }

  function parseText(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { kind: 'csv', reason: 'not JSON', message: String(err && err.message) };
    }
    return detect(parsed);
  }

  function localDayKey(epochMs) {
    if (typeof epochMs !== 'number' || !isFinite(epochMs) || epochMs <= 0) return null;
    var d = new Date(epochMs);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function normalizeTask(raw, tier) {
    var t = raw || {};
    var spent = {};
    if (isObj(t.timeSpentOnDay)) {
      Object.keys(t.timeSpentOnDay).forEach(function (day) {
        var ms = t.timeSpentOnDay[day];
        if (typeof ms === 'number' && isFinite(ms) && ms > 0) spent[day] = ms;
      });
    }
    return {
      id: t.id,
      title: typeof t.title === 'string' && t.title.length ? t.title : '(untitled)',
      notes: typeof t.notes === 'string' ? t.notes : '',
      projectId: t.projectId || null,
      parentId: t.parentId || null,
      subTaskIds: arr(t.subTaskIds).filter(function (v) { return typeof v === 'string'; }),
      subTasks: arr(t.subTasks),
      tagIds: arr(t.tagIds).filter(function (v) { return typeof v === 'string'; }),
      created: numOr(t.created, 0),
      modified: numOr(t.modified, 0),
      doneOn: numOr(t.doneOn, 0),
      isDone: !!t.isDone,
      timeEstimate: numOr(t.timeEstimate, 0),
      timeSpent: numOr(t.timeSpent, 0),
      timeSpentOnDay: spent,
      dueDay: t.dueDay || null,
      deadlineDay: t.deadlineDay || null,
      attachments: arr(t.attachments),
      tier: tier
    };
  }

  function mergeSessions(data, dim) {
    var merged = new Map();
    var rawCount = 0;
    TIERS.forEach(function (tier) {
      var rootObj = sessionRoot(data, tier);
      var table = rootObj && isObj(rootObj[dim]) ? rootObj[dim] : null;
      if (!table) return;
      Object.keys(table).forEach(function (ctx) {
        var days = isObj(table[ctx]) ? table[ctx] : {};
        if (!merged.has(ctx)) merged.set(ctx, new Map());
        var bucket = merged.get(ctx);
        Object.keys(days).forEach(function (day) {
          rawCount += 1;
          if (bucket.has(day)) return;
          var rec = isObj(days[day]) ? days[day] : {};
          bucket.set(day, {
            s: typeof rec.s === 'number' ? rec.s : null,
            e: typeof rec.e === 'number' ? rec.e : null,
            b: numOr(rec.b, 0),
            bt: numOr(rec.bt, 0)
          });
        });
      });
    });
    var out = {};
    var dedupCount = 0;
    merged.forEach(function (bucket, ctx) {
      out[ctx] = {};
      bucket.forEach(function (rec, day) {
        out[ctx][day] = rec;
        dedupCount += 1;
      });
    });
    return { byContext: out, rawCount: rawCount, dedupCount: dedupCount };
  }

  function buildStore(data, meta, source) {
    var warnings = [];
    var counts = { live: 0, young: 0, old: 0, merged: 0, projects: 0, tags: 0 };

    var tasks = [];
    var tasksById = new Map();

    function addTask(raw, tier) {
      if (!raw || typeof raw.id !== 'string' || !raw.id) return;
      if (tasksById.has(raw.id)) return;
      var task = normalizeTask(raw, tier);
      tasksById.set(task.id, task);
      tasks.push(task);
    }

    TIERS.forEach(function (tier) {
      var entities = taskEntities(data, tier);
      var n = 0;
      Object.keys(entities).forEach(function (id) {
        if (!tasksById.has(id)) n += 1;
        addTask(entities[id], tier);
      });
      counts[tier] = Object.keys(entities).length;
    });

    tasks.slice().forEach(function (task) {
      arr(task.subTasks).forEach(function (sub) { addTask(sub, task.tier); });
    });
    counts.merged = tasks.length;

    var projectsById = {};
    var projectRaw = isObj(data.project) && isObj(data.project.entities) ? data.project.entities : {};
    Object.keys(projectRaw).forEach(function (id) {
      var p = projectRaw[id] || {};
      projectsById[id] = {
        id: id,
        title: typeof p.title === 'string' && p.title.length ? p.title : '(untitled project)',
        icon: p.icon || null,
        color: (p.theme && (p.theme.primary || p.theme.accent)) || null,
        isArchived: !!p.isArchived,
        isHiddenFromMenu: !!p.isHiddenFromMenu,
        taskIds: arr(p.taskIds)
      };
    });

    var tagsById = {};
    var tagRaw = isObj(data.tag) && isObj(data.tag.entities) ? data.tag.entities : {};
    Object.keys(tagRaw).forEach(function (id) {
      var g = tagRaw[id] || {};
      tagsById[id] = {
        id: id,
        title: typeof g.title === 'string' && g.title.length ? g.title : '(untitled tag)',
        icon: g.icon || null,
        color: g.color || (g.theme && g.theme.primary) || null,
        isSystem: id === 'TODAY' || id === 'EM_IMPORTANT' || id === 'EM_URGENT' || id.indexOf('KANBAN') === 0
      };
    });

    var dangling = { project: 0, tag: 0 };

    tasks.forEach(function (task) {
      if (!task.projectId || !projectsById[task.projectId]) {
        if (task.projectId) dangling.project += 1;
        if (!projectsById[UNKNOWN_PROJECT]) {
          projectsById[UNKNOWN_PROJECT] = {
            id: UNKNOWN_PROJECT, title: 'Unknown project', icon: null, color: null,
            isArchived: false, isHiddenFromMenu: false, taskIds: [], synthetic: true
          };
        }
        task.projectId = UNKNOWN_PROJECT;
      }
      var resolved = [];
      task.tagIds.forEach(function (id) {
        if (tagsById[id]) {
          if (resolved.indexOf(id) === -1) resolved.push(id);
        } else {
          dangling.tag += 1;
          if (!tagsById[UNKNOWN_TAG]) {
            tagsById[UNKNOWN_TAG] = {
              id: UNKNOWN_TAG, title: 'Unknown tag', icon: null, color: null,
              isSystem: false, synthetic: true
            };
          }
          if (resolved.indexOf(UNKNOWN_TAG) === -1) resolved.push(UNKNOWN_TAG);
        }
      });
      task.tagIds = resolved;
    });

    var projectDim = mergeSessions(data, 'project');
    var tagDim = mergeSessions(data, 'tag');

    var focus = {};
    var metricEntities = isObj(data.metric) && isObj(data.metric.entities) ? data.metric.entities : {};
    Object.keys(metricEntities).forEach(function (day) {
      var entry = metricEntities[day] || {};
      var blocks = arr(entry.focusSessions).filter(function (ms) { return typeof ms === 'number' && ms > 0; });
      if (blocks.length) focus[day] = blocks.slice();
    });

    var plannerDays = {};
    var planner = isObj(data.planner) && isObj(data.planner.days) ? data.planner.days : {};
    Object.keys(planner).forEach(function (day) {
      plannerDays[day] = arr(planner[day]).filter(function (v) { return typeof v === 'string'; });
    });

    var boards = isObj(data.boards) && Array.isArray(data.boards.boardCfgs) ? data.boards.boardCfgs : [];

    var daySet = new Set();
    var trackedDaySet = new Set();
    tasks.forEach(function (task) {
      Object.keys(task.timeSpentOnDay).forEach(function (day) {
        daySet.add(day);
        trackedDaySet.add(day);
      });
    });
    [projectDim, tagDim].forEach(function (dim) {
      Object.keys(dim.byContext).forEach(function (ctx) {
        Object.keys(dim.byContext[ctx]).forEach(function (day) { daySet.add(day); });
      });
    });
    Object.keys(focus).forEach(function (day) { daySet.add(day); });
    Object.keys(plannerDays).forEach(function (day) { daySet.add(day); });

    var days = Array.from(daySet).sort();

    counts.projects = Object.keys(projectsById).length;
    counts.tags = Object.keys(tagsById).length;

    var tasksByProject = {};
    tasks.forEach(function (task) {
      tasksByProject[task.projectId] = (tasksByProject[task.projectId] || 0) + 1;
    });

    var sessionDays = new Set();
    [projectDim, tagDim].forEach(function (dim) {
      Object.keys(dim.byContext).forEach(function (ctx) {
        Object.keys(dim.byContext[ctx]).forEach(function (day) { sessionDays.add(day); });
      });
    });

    if (dangling.project || dangling.tag) {
      warnings.push('Dangling references resolved to unknown buckets: ' + dangling.project + ' project, ' + dangling.tag + ' tag.');
    }
    if (projectDim.rawCount !== projectDim.dedupCount) {
      warnings.push('Tier session maps overlapped; deduped ' + projectDim.rawCount + ' project sessions to ' + projectDim.dedupCount + '.');
    }

    return {
      source: source || {},
      meta: meta || {},
      asOf: meta && meta.timestamp ? new Date(meta.timestamp) : null,
      tasks: tasks,
      tasksById: tasksById,
      projects: Object.keys(projectsById).map(function (id) { return projectsById[id]; }),
      projectsById: projectsById,
      tags: Object.keys(tagsById).map(function (id) { return tagsById[id]; }),
      tagsById: tagsById,
      days: days,
      trackedDays: Array.from(trackedDaySet).sort(),
      projectSessions: projectDim.byContext,
      tagSessions: tagDim.byContext,
      focus: focus,
      plannerDays: plannerDays,
      boards: boards,
      counts: counts,
      tasksByProject: tasksByProject,
      sessionDayCount: sessionDays.size,
      warnings: warnings,
      UNKNOWN_PROJECT: UNKNOWN_PROJECT,
      UNKNOWN_TAG: UNKNOWN_TAG
    };
  }

  SP.ingest = {
    TIERS: TIERS,
    UNKNOWN_PROJECT: UNKNOWN_PROJECT,
    UNKNOWN_TAG: UNKNOWN_TAG,
    parseText: parseText,
    detect: detect,
    buildStore: buildStore,
    localDayKey: localDayKey,
    normalizeTask: normalizeTask
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
