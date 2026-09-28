(function (root) {
  'use strict';

  var SP = (root.SP = root.SP || {});
  var A = SP.aggregate;

  var HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return HTML_ESCAPES[c];
    });
  }

  function pct(part, whole) {
    if (!whole) return 0;
    return (part / whole) * 100;
  }

  function stat(label, value, sub) {
    return '<div class="stat"><div class="k">' + esc(label) + '</div><div class="v">' + esc(value) + '</div>' +
      (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function projectColor(store, projectId) {
    var list = SP.__projectColors || {};
    if (list[projectId]) return list[projectId];
    var p = store.projectsById[projectId];
    return (p && p.color) || '#4a5a6e';
  }

  function setProjectColors(colors) {
    SP.__projectColors = colors || {};
  }

  function timelineHint(series, store) {
    var days = A.activeDays(store);
    var trackedDays = Object.keys(series.matrix.dayTotals).length;
    var parts = [series.granularity + ' granularity'];
    if (days.length) {
      parts.push(days[0] + ' to ' + days[days.length - 1] + ' (' + days.length + ' days)');
    } else {
      parts.push('no days in range');
    }
    parts.push(trackedDays + ' with tracked time');
    parts.push('total ' + A.formatDuration(series.grandTotal));
    return parts.join(' · ');
  }

  function renderMatrix(container, series) {
    var days = series.matrix.days;
    if (!days.length) {
      container.innerHTML = '<p class="empty">No days in range.</p>';
      return;
    }
    var head = '<tr><th>Project</th>' + days.map(function (d) {
      return '<th class="day-col">' + esc(d) + '</th>';
    }).join('') + '<th class="num">Total</th></tr>';

    var body = series.segments.map(function (p) {
      var perDay = series.matrix.byProject[p.id] || {};
      var cells = days.map(function (d) {
        var ms = perDay[d] || 0;
        return '<td class="num' + (ms ? '' : ' zero') + '">' + (ms ? A.formatDuration(ms) : '·') + '</td>';
      }).join('');
      return '<tr><td><span class="dot" style="background:' + esc(p.color) + '"></span>' + esc(p.title) + '</td>' +
        cells + '<td class="num total-col">' + A.formatDuration(series.matrix.projectTotals[p.id] || 0) + '</td></tr>';
    }).join('');

    var totals = days.map(function (d) {
      var ms = series.matrix.dayTotals[d] || 0;
      return '<td class="num' + (ms ? '' : ' zero') + '">' + (ms ? A.formatDuration(ms) : '·') + '</td>';
    }).join('');

    container.innerHTML = '<div class="table-wrap"><table class="matrix"><thead>' + head + '</thead><tbody>' + body +
      '</tbody><tfoot><tr class="total-row"><td>Total</td>' + totals +
      '<td class="num total-col">' + A.formatDuration(series.matrix.grandTotal) + '</td></tr></tfoot></table></div>';
  }

  function renderDay(container, detail, store) {
    if (!detail) {
      container.innerHTML = '<p class="empty">Pick a day on the timeline, or use the date field.</p>';
      return;
    }
    var day = detail.day;
    var blocks = [];
    blocks.push('<div class="stat-row">');
    blocks.push(stat('Tracked', A.formatDuration(detail.trackedTotal), detail.rows.length + ' task' + (detail.rows.length === 1 ? '' : 's') + ' with time'));
    blocks.push(stat('Envelope', detail.envelopeSpan ? A.formatDuration(detail.envelopeSpan) : '—',
      detail.envelope && detail.envelope.s !== null ? A.formatClock(detail.envelope.s) + ' -> ' + A.formatClock(detail.envelope.e) : 'no band recorded'));
    blocks.push(stat('Breaks', detail.envelope && detail.envelope.breakCount ? detail.envelope.breakCount + ' / ' + A.formatDuration(detail.envelope.breakTime) : '0',
      'count / time'));
    blocks.push(stat('Focus', detail.focus.length ? A.formatDuration(detail.focusMs) : '—', detail.focus.length + ' block' + (detail.focus.length === 1 ? '' : 's')));
    blocks.push(stat('Planned', String(detail.planned.length), 'tasks on the planner'));
    blocks.push('</div>');

    if (!detail.rows.length) {
      blocks.push('<p class="empty">No task recorded tracked time on ' + esc(day) + '.</p>');
    } else {
      blocks.push('<div class="table-wrap"><table><thead><tr><th>Task</th><th class="num">Duration</th><th class="num">Share</th><th class="num">Estimate</th><th>State</th></tr></thead><tbody>');
      detail.rows.forEach(function (r) {
        var share = pct(r.ms, detail.trackedTotal);
        var tags = r.tags.map(function (t) { return '<span class="badge">' + esc(t.title) + '</span>'; }).join(' ');
        var sub = '<div class="sub">' + esc(r.projectTitle) + (tags ? ' · ' + tags : '') + '</div>';
        var children = '';
        if (r.children.length) {
          children = '<details class="section"><summary>' + r.children.length + ' sub-task' + (r.children.length === 1 ? '' : 's') + ' rolled in</summary>' +
            '<div class="subtasks">' + r.children.map(function (c) {
              return '<div class="task-row"><span class="title">' + esc(c.title) + '</span> <span class="sub">' +
                A.formatDuration(c.ms) + (c.isDone ? ' · done' : '') + '</span></div>';
            }).join('') + '</div></details>';
        }
        blocks.push('<tr><td><div class="task-row"><span class="dot" style="background:' + esc(projectColor(store, r.projectId)) + '"></span>' +
          '<span class="title">' + esc(r.title) + '</span></div>' + sub +
          '<div class="bar-track"><div class="bar-fill" style="width:' + share.toFixed(1) + '%"></div></div>' + children + '</td>' +
          '<td class="num">' + A.formatDuration(r.ms) + '</td>' +
          '<td class="num">' + share.toFixed(1) + '%</td>' +
          '<td class="num">' + (r.estimate ? A.formatDuration(r.estimate) : '—') + '</td>' +
          '<td>' + (r.isDone ? '<span class="badge done">done</span>' : '<span class="badge open">open</span>') + '</td></tr>');
      });
      blocks.push('</tbody></table></div>');
    }

    blocks.push('<details class="section"><summary>Created, completed, or planned that day without tracked time (' + detail.noTime.length + ')</summary>');
    if (!detail.noTime.length) {
      blocks.push('<p class="empty">None.</p>');
    } else {
      blocks.push('<div class="table-wrap"><table><thead><tr><th>Task</th><th>Project</th><th>Marker</th></tr></thead><tbody>');
      detail.noTime.forEach(function (t) {
        var marker = [];
        if (t.planned) marker.push('planned');
        if (t.createdToday) marker.push('created');
        if (t.done) marker.push('completed');
        blocks.push('<tr><td>' + esc(t.title) + (t.parentTitle ? '<div class="sub">sub-task of ' + esc(t.parentTitle) + '</div>' : '') + '</td>' +
          '<td>' + esc(t.projectTitle) + '</td><td>' + marker.join(' · ') + '</td></tr>');
      });
      blocks.push('</tbody></table></div>');
    }
    blocks.push('</details>');

    var env = detail.envelope;
    blocks.push('<div class="envelope-strip">');
    if (env) {
      blocks.push('<div class="envelope-item"><div class="k">Envelope</div><div>' +
        (env.s !== null ? A.formatClock(env.s) : '—') + ' -> ' + (env.e !== null ? A.formatClock(env.e) : '—') + '</div></div>');
      blocks.push('<div class="envelope-item"><div class="k">Break count</div><div>' + env.breakCount + '</div></div>');
      blocks.push('<div class="envelope-item"><div class="k">Break time</div><div>' + A.formatDuration(env.breakTime) + '</div></div>');
      blocks.push('<div class="envelope-item"><div class="k">Projects in band</div><div>' + env.projects.length + '</div></div>');
    } else {
      blocks.push('<div class="envelope-item"><div class="k">Envelope</div><div>no session recorded</div></div>');
    }
    blocks.push('</div>');

    blocks.push('<div class="envelope-strip"><div class="envelope-item" style="flex:1 1 100%"><div class="k">Focus blocks</div>' +
      (detail.focus.length
        ? '<div class="focus-list">' + detail.focus.map(function (ms) { return '<span class="focus-block">' + A.formatDuration(ms) + '</span>'; }).join('') + '</div>'
        : '<div class="empty">No focus block on this day.</div>') +
      '</div></div>');

    if (detail.planned.length) {
      blocks.push('<div class="envelope-strip"><div class="envelope-item" style="flex:1 1 100%"><div class="k">Planner</div>' +
        detail.planned.map(function (p) { return '<span class="badge ' + (p.isDone ? 'done' : 'open') + '">' + esc(p.title) + '</span>'; }).join(' ') +
        '</div></div>');
    }

    container.innerHTML = blocks.join('');
  }

  function renderEstimates(summaryEl, tableEl, ev) {
    summaryEl.innerHTML = [
      stat('Estimated', ev.withEstimate ? A.formatDuration(ev.sumEstimate) : '—', ev.withEstimate + ' tasks with an estimate'),
      stat('Actual', ev.withEstimate ? A.formatDuration(ev.sumActual) : '—', 'on those tasks'),
      stat('Bias', ev.bias === null ? '—' : ev.bias.toFixed(2) + 'x', ev.bias === null ? 'no estimates' : (ev.bias > 1 ? 'ran long' : 'ran short')),
      stat('Over / under', ev.over + ' / ' + ev.under, 'tasks past / under estimate')
    ].join('');

    if (!ev.rows.length) {
      tableEl.innerHTML = '<p class="empty">No task carries an estimate or tracked time in range.</p>';
      return;
    }

    var rows = ev.rows.slice(0, 200).map(function (r) {
      var dev = r.deviation;
      var cls = dev > 0 ? 'style="color:#ff9aa2"' : dev < 0 ? 'style="color:#8ee7c2"' : '';
      return '<tr><td>' + esc(r.title) + '</td><td>' + esc(r.projectTitle) + '</td>' +
        '<td class="num">' + (r.estimate ? A.formatDuration(r.estimate) : '—') + '</td>' +
        '<td class="num">' + A.formatDuration(r.actual) + '</td>' +
        '<td class="num" ' + cls + '>' + (r.estimate ? (dev > 0 ? '+' : '') + A.formatDuration(Math.abs(dev)) : '—') + '</td>' +
        '<td class="num">' + (r.ratio === null ? '—' : r.ratio.toFixed(2) + 'x') + '</td>' +
        '<td>' + (r.isDone ? '<span class="badge done">done</span>' : '<span class="badge open">open</span>') + '</td></tr>';
    }).join('');

    tableEl.innerHTML = '<table><thead><tr><th>Task</th><th>Project</th><th class="num">Estimate</th><th class="num">Actual</th>' +
      '<th class="num">Deviation</th><th class="num">Ratio</th><th>State</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderQuadrants(gridEl, hintEl, quad, store) {
    if (!quad.panels.length) {
      gridEl.innerHTML = '<p class="empty">No board definition in this export.</p>';
      hintEl.textContent = '';
      return;
    }
    var layout = {
      NOT_URGENT_AND_IMPORTANT: 1,
      URGENT_AND_IMPORTANT: 2,
      NOT_URGENT_AND_NOT_IMPORTANT: 3,
      URGENT_AND_NOT_IMPORTANT: 4
    };
    var byId = {};
    quad.panels.forEach(function (p) { byId[p.id] = p; });
    var ordered = Object.keys(layout).sort(function (a, b) { return layout[a] - layout[b]; }).map(function (id) {
      return byId[id] || null;
    }).filter(Boolean);
    quad.panels.forEach(function (p) { if (ordered.indexOf(p) === -1) ordered.push(p); });

    gridEl.innerHTML = ordered.map(function (p) {
      var color = p.ms ? '#29a1aa' : '#4a5a6e';
      return '<div class="quad" style="border-left-color:' + color + '">' +
        '<h3>' + esc(p.title) + '</h3>' +
        '<div class="quad-meaning">' + esc(p.meaning) + '</div>' +
        '<div class="k">tracked time</div><div class="v">' + A.formatDuration(p.ms) + '</div>' +
        '<div class="s">' + p.taskCount + ' parent task' + (p.taskCount === 1 ? '' : 's') + ' · ' + p.withTime + ' with time</div>' +
        '<div class="k" style="margin-top:8px">completion</div><div class="v">' + (p.completion * 100).toFixed(0) + '%</div>' +
        '<div class="s">' + p.done + ' of ' + p.taskCount + ' done</div>' +
        '<div class="quad-criteria">' + esc(p.criteria) + '</div>' +
        '</div>';
    }).join('');

    hintEl.textContent = 'Board "' + (quad.boardTitle || quad.boardId) + '". Rows: important above, not important below. Columns: not urgent left, urgent right. Criteria come from the export\'s panel definitions; time is tracked task time.';
  }

  function renderDigest(container, digest, store) {
    var blocks = [];
    blocks.push('<div class="stat-row">');
    blocks.push(stat('Tracked', A.formatDuration(digest.trackedMs), digest.dayCount + ' days in range'));
    blocks.push(stat('Completed', String(digest.completed.length), A.formatDuration(digest.completedMs) + ' on those tasks'));
    blocks.push(stat('Envelope', digest.envelopeMs ? A.formatDuration(digest.envelopeMs) : '—', digest.breaks + ' breaks / ' + A.formatDuration(digest.breakMs)));
    blocks.push(stat('Focus', digest.focus.blocks ? A.formatDuration(digest.focus.ms) : '—', digest.focus.blocks + ' blocks on ' + digest.focus.days.length + ' days'));
    blocks.push(stat('Estimate vs actual', digest.estimate.bias === null ? '—' : digest.estimate.bias.toFixed(2) + 'x',
      digest.estimate.withEstimate + ' tasks estimated, actual ' + A.formatDuration(digest.estimate.sumActual) + ' vs ' + A.formatDuration(digest.estimate.sumEstimate)));
    blocks.push('</div>');

    blocks.push('<div class="envelope-strip"><div class="envelope-item" style="flex:1 1 100%">' +
      '<div class="k">Attributed time by tag</div>' +
      (digest.tags.length
        ? '<div class="focus-list" style="margin-top:6px">' + digest.tags.map(function (t) {
          return '<span class="focus-block">' + esc(t.title) + ' · ' + A.formatDuration(t.ms) + '</span>';
        }).join('') + '</div>'
        : '<div class="empty">No tag carries time in range.</div>') +
      '<div class="s" style="margin-top:6px">Every tag on a task receives that task\'s full time, so tag totals (' +
      A.formatDuration(digest.tagsTotal) + ') exceed the tracked total of ' + A.formatDuration(digest.trackedMs) +
      '. They are attributed time, not reconciled.</div>' +
      '</div></div>');

    if (!digest.completed.length) {
      blocks.push('<p class="empty">No task was completed inside this range.</p>');
      container.innerHTML = blocks.join('');
      return;
    }

    blocks.push('<div class="table-wrap"><table><thead><tr><th>Completed task</th><th>Project</th><th>Done on</th><th class="num">Time in range</th><th class="num">Estimate</th></tr></thead><tbody>');
    digest.completed.forEach(function (c) {
      blocks.push('<tr><td><span class="dot" style="background:' + esc(projectColor(store, c.projectId)) + '"></span>' + esc(c.title) +
        (c.childrenDone ? '<div class="sub">' + c.childrenDone + ' completed sub-task' + (c.childrenDone === 1 ? '' : 's') + '</div>' : '') + '</td>' +
        '<td>' + esc(c.projectTitle) + '</td><td>' + esc(c.doneDay) + '</td>' +
        '<td class="num">' + (c.ms ? A.formatDuration(c.ms) : '·') + '</td>' +
        '<td class="num">' + (c.estimate ? A.formatDuration(c.estimate) : '—') + '</td></tr>');
    });
    blocks.push('</tbody></table></div>');
    container.innerHTML = blocks.join('');
  }

  SP.views = {
    esc: esc,
    stat: stat,
    setProjectColors: setProjectColors,
    projectColor: projectColor,
    renderMatrix: renderMatrix,
    renderDay: renderDay,
    renderEstimates: renderEstimates,
    renderQuadrants: renderQuadrants,
    renderDigest: renderDigest,
    timelineHint: timelineHint
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
