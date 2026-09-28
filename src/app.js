(function (root) {
  'use strict';

  var SP = (root.SP = root.SP || {});
  var A = SP.aggregate;
  var V = SP.views;
  var C = SP.charts;
  var F = SP.filter;

  var state = {
    store: null,
    filter: F.empty(),
    granularity: 'auto',
    mode: 'bars',
    selectedDay: null,
    visibleDayCount: null,
    sourceName: ''
  };

  var els = {};
  var chartInstances = {};

  function $(id) { return document.getElementById(id); }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      if (typeof file.text === 'function') {
        file.text().then(resolve, reject);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  function autoGran(count) {
    if (count > 730) return 'month';
    if (count > 90) return 'week';
    return 'day';
  }

  function effectiveGranularity(store) {
    if (state.granularity !== 'auto') return state.granularity;
    var count = state.visibleDayCount || A.activeDays(store).length;
    return autoGran(count);
  }

  function chart(id) {
    var el = $(id);
    if (!chartInstances[id] && root.echarts) {
      chartInstances[id] = root.echarts.init(el, null, { renderer: 'canvas' });
    }
    return chartInstances[id];
  }

  function setOption(id, option) {
    var instance = chart(id);
    if (!instance) return;
    instance.setOption(option, true);
  }

  function renderMeta(store) {
    if (!store) {
      els.meta.textContent = 'no export loaded';
      return;
    }
    var asOf = store.asOf ? store.asOf.toLocaleString() : (store.meta.lastUpdate ? new Date(store.meta.lastUpdate).toLocaleString() : 'unknown');
    var parts = [
      'as of ' + asOf,
      store.counts.merged + ' tasks (' + store.counts.live + ' live / ' + store.counts.young + ' young / ' + store.counts.old + ' old)',
      store.counts.projects + ' projects',
      store.counts.tags + ' tags',
      store.days.length + ' days',
      state.sourceName
    ];
    els.meta.textContent = parts.filter(Boolean).join(' · ');
  }

  function showError(message) {
    if (!message) {
      els.loadError.hidden = true;
      els.loadError.textContent = '';
      return;
    }
    els.loadError.textContent = message;
    els.loadError.hidden = false;
  }

  function fillSelect(select, items, allLabel, labelFor) {
    var current = select.value;
    var html = ['<option value="">' + V.esc(allLabel) + '</option>'];
    items.forEach(function (item) {
      html.push('<option value="' + V.esc(item.id) + '">' + V.esc(labelFor(item)) + '</option>');
    });
    select.innerHTML = html.join('');
    select.value = current;
  }

  function populateFilters(store) {
    var projects = store.projects.slice().sort(function (a, b) {
      if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
      return String(a.title).localeCompare(String(b.title));
    });
    fillSelect(els.fProject, projects, 'All projects', function (p) { return p.title; });
    fillSelect(els.fTag, store.tags, 'All tags', function (t) { return t.title; });
    els.fFrom.value = state.filter.from || '';
    els.fTo.value = state.filter.to || '';
    els.fDone.value = state.filter.done || '';
  }

  function renderChips(store) {
    var chips = F.chips(store, state.filter);
    els.fChips.innerHTML = chips.map(function (c) {
      return '<span class="chip" data-key="' + V.esc(c.key) + '">' + V.esc(c.label) + '<span class="x" data-key="' + V.esc(c.key) + '">×</span></span>';
    }).join('');
    els.fClear.hidden = !chips.length;
  }

  function renderNotes(store) {
    var warn = (store && store.warnings) || [];
    if (!warn.length) {
      els.ingestNotes.hidden = true;
      els.ingestNotes.innerHTML = '';
      return;
    }
    els.ingestNotes.hidden = false;
    els.ingestNotes.innerHTML = warn.map(function (w, i) {
      return '<span class="chip warn" data-note="' + i + '">' + V.esc(w) + '</span>';
    }).join(' ');
  }

  function pickDayFromBucket(bucket) {
    var dayTotals = (state.lastSeries && state.lastSeries.matrix.dayTotals) || {};
    var best = null;
    var bestMs = -1;
    bucket.days.forEach(function (day) {
      var ms = dayTotals[day] || 0;
      if (ms > bestMs) { bestMs = ms; best = day; }
    });
    return best || bucket.days[0];
  }

  function renderTimeline(store, units) {
    var gran = effectiveGranularity(store);
    var series = A.buildSeries(store, gran, units);
    state.lastSeries = series;

    var colors = {};
    series.segments.forEach(function (p) { colors[p.id] = p.color; });
    V.setProjectColors(colors);

    els.timelineHint.textContent = V.timelineHint(series, store) + ' · ' + state.mode;

    if (state.mode === 'matrix') {
      els.chartTimeline.hidden = true;
      els.matrixTimeline.hidden = false;
      V.renderMatrix(els.matrixTimeline, series);
    } else {
      els.chartTimeline.hidden = false;
      els.matrixTimeline.hidden = true;
      var selectedIndex = -1;
      if (state.selectedDay) {
        series.buckets.forEach(function (b, i) {
          if (b.days.indexOf(state.selectedDay) !== -1) selectedIndex = i;
        });
      }
      setOption('chart-timeline', C.timelineOption(series, { selectedIndex: selectedIndex }));
      bindTimelineHandlers();
    }
    return series;
  }

  function bindTimelineHandlers() {
    var instance = chartInstances['chart-timeline'];
    if (!instance || instance.__spBound) return;
    instance.__spBound = true;
    instance.on('click', function (params) {
      if (!state.store || state.mode !== 'bars') return;
      var series = state.lastSeries;
      var bucket = series && series.buckets[params.dataIndex];
      if (!bucket) return;
      state.selectedDay = pickDayFromBucket(bucket);
      render();
      document.getElementById('sec-day').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    instance.on('datazoom', function () {
      var series = state.lastSeries;
      if (!series) return;
      var opt = instance.getOption();
      var dz = opt.dataZoom && opt.dataZoom[0];
      if (!dz) return;
      var total = series.buckets.length;
      var start = Math.floor(((dz.start === undefined ? 0 : dz.start) / 100) * total);
      var end = Math.ceil(((dz.end === undefined ? 100 : dz.end) / 100) * total);
      var visibleDays = 0;
      for (var i = start; i < end && i < total; i += 1) visibleDays += series.buckets[i].days.length;
      state.visibleDayCount = visibleDays;
    });
  }

  function renderDay(store, units) {
    if (state.selectedDay) els.dayPicker.value = state.selectedDay;
    var detail = state.selectedDay ? A.dayDetail(store, state.selectedDay, units) : null;
    V.renderDay(els.dayBody, detail, store);

    if (detail && detail.overEnvelope) {
      els.dayQuality.hidden = false;
      els.dayQuality.textContent = 'data quality: tracked ' + A.formatDuration(detail.trackedTotal) +
        ' exceeds the ' + A.formatDuration(detail.envelopeSpan) + ' envelope on ' + detail.day;
    } else {
      els.dayQuality.hidden = true;
      els.dayQuality.textContent = '';
    }
  }

  function renderHeatmap(store, units) {
    var stats = A.stats(store, units);
    var days = A.activeDays(store);
    var years = 1;
    if (days.length) {
      years = (+days[days.length - 1].slice(0, 4)) - (+days[0].slice(0, 4)) + 1;
    }
    els.chartHeatmap.style.height = Math.max(180, 40 + years * 148 + 40) + 'px';
    setOption('chart-heatmap', C.calendarHeatmapOption(store, stats));
    var instance = chartInstances['chart-heatmap'];
    if (instance) instance.resize();
    els.heatmapTotal.textContent = 'total ' + A.formatDuration(stats.trackedMs) + ' over ' + stats.trackedDayCount + ' days';
  }

  function renderEstimates(store, units) {
    var ev = A.estimateVsActual(store, units);
    V.renderEstimates(els.estimatesSummary, els.estimatesTable, ev);
    setOption('chart-estimates', C.estimateScatterOption(ev.rows));
  }

  function renderQuadrants(store, units) {
    var quad = A.quadrants(store, units);
    V.renderQuadrants(els.quadGrid, els.quadHint, quad, store);
  }

  function renderDigest(store, units) {
    var digest = A.digest(store, units);
    els.digestRange.textContent = digest.from ? digest.from + ' to ' + digest.to : 'no days in range';
    V.renderDigest(els.digestBody, digest, store);
  }

  function render() {
    if (!state.store) {
      els.overlay.hidden = false;
      els.content.hidden = true;
      els.filterbar.hidden = true;
      els.sectionNav.hidden = true;
      els.resetBtn.hidden = true;
      renderMeta(null);
      renderNotes(null);
      return;
    }

    els.overlay.hidden = true;
    els.content.hidden = false;
    els.filterbar.hidden = false;
    els.sectionNav.hidden = false;
    els.resetBtn.hidden = false;

    var store = F.apply(state.store, state.filter);
    var units = A.units(store);

    renderMeta(state.store);
    renderTimeline(store, units);
    renderDay(store, units);
    renderHeatmap(store, units);
    renderEstimates(store, units);
    renderQuadrants(store, units);
    renderDigest(store, units);
    renderChips(state.store);
    renderNotes(state.store);

    Object.keys(chartInstances).forEach(function (id) {
      var el = $(id);
      if (el && el.offsetParent !== null) chartInstances[id].resize();
    });
  }

  function defaultDay(store) {
    var stats = A.stats(store);
    var best = null;
    var bestMs = -1;
    Object.keys(stats.dayTotals).forEach(function (day) {
      if (stats.dayTotals[day] > bestMs) {
        bestMs = stats.dayTotals[day];
        best = day;
      }
    });
    if (best) return best;
    return store.days.length ? store.days[store.days.length - 1] : null;
  }

  function loadStore(store, name) {
    state.store = store;
    state.filter = F.empty();
    state.selectedDay = defaultDay(store);
    state.visibleDayCount = null;
    state.sourceName = name || '';
    state.granularity = 'auto';
    state.mode = 'bars';
    els.granularity.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.gran === 'auto');
    });
    els.timelineMode.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === 'bars');
    });
    if (state.selectedDay) els.dayPicker.value = state.selectedDay;
    populateFilters(store);
    showError('');
    render();
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return Promise.resolve();
    var messages = [];
    var loaded = false;
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        if (loaded) return null;
        return readText(file).then(function (text) {
          var result = SP.ingest.parseText(text);
          if (result.kind === 'backup') {
            var store = SP.ingest.buildStore(result.data, result.meta, { name: file.name, size: file.size });
            loadStore(store, file.name);
            loaded = true;
            return null;
          }
          if (result.kind === 'csv') {
            messages.push(file.name + ': worklog CSV import is not built yet (the CSV seam). Showing nothing from it.');
            return null;
          }
          messages.push(file.name + ': unrecognized file, expected a Super Productivity backup JSON export.');
          return null;
        });
      }).catch(function (err) {
        messages.push(file.name + ': could not read (' + (err && err.message ? err.message : err) + ')');
      });
    });
    return chain.then(function () {
      showError(messages.length ? messages.join(' ') : '');
      if (loaded) {
        document.getElementById('sec-timeline').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function downloadChart(id, name) {
    var instance = chartInstances[id];
    if (!instance) return;
    var url = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: C.palette.BG });
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function stepDay(delta) {
    if (!state.store) return;
    var days = state.store.days;
    if (!days.length) return;
    var idx = state.selectedDay ? days.indexOf(state.selectedDay) : -1;
    if (idx === -1) {
      idx = delta > 0 ? -1 : days.length;
    }
    var next = Math.min(days.length - 1, Math.max(0, idx + delta));
    state.selectedDay = days[next];
    render();
  }

  function wire() {
    els = {
      meta: $('meta'),
      content: $('content'),
      overlay: $('drop-overlay'),
      dropStatus: $('drop-status'),
      filterbar: $('filterbar'),
      sectionNav: $('section-nav'),
      loadError: $('load-error'),
      ingestNotes: $('ingest-notes'),
      resetBtn: $('reset-btn'),
      fileInput: $('file-input'),
      fProject: $('f-project'),
      fTag: $('f-tag'),
      fDone: $('f-done'),
      fFrom: $('f-from'),
      fTo: $('f-to'),
      fClear: $('f-clear'),
      fChips: $('f-chips'),
      granularity: $('granularity'),
      timelineMode: $('timeline-mode'),
      timelineHint: $('timeline-hint'),
      chartTimeline: $('chart-timeline'),
      matrixTimeline: $('matrix-timeline'),
      pngTimeline: $('png-timeline'),
      dayQuality: $('day-quality'),
      dayPicker: $('day-picker'),
      dayPrev: $('day-prev'),
      dayNext: $('day-next'),
      dayBody: $('day-body'),
      chartHeatmap: $('chart-heatmap'),
      heatmapTotal: $('heatmap-total'),
      pngHeatmap: $('png-heatmap'),
      estimatesSummary: $('estimates-summary'),
      estimatesTable: $('estimates-table'),
      chartEstimates: $('chart-estimates'),
      pngEstimates: $('png-estimates'),
      quadGrid: $('quad-grid'),
      quadHint: $('quad-hint'),
      digestRange: $('digest-range'),
      digestBody: $('digest-body')
    };

    els.fileInput.addEventListener('change', function (e) {
      handleFiles(e.target.files).then(function () { els.fileInput.value = ''; });
    });

    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('dragenter', function (e) {
      e.preventDefault();
      document.body.classList.add('dragging');
      els.overlay.hidden = false;
      els.dropStatus.textContent = 'Release to load.';
    });
    window.addEventListener('dragleave', function (e) {
      if (e.relatedTarget) return;
      document.body.classList.remove('dragging');
      els.dropStatus.textContent = 'Nothing loads until you drop a file. No requests leave this page.';
      els.overlay.hidden = !!state.store;
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      document.body.classList.remove('dragging');
      els.dropStatus.textContent = 'Nothing loads until you drop a file. No requests leave this page.';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      } else {
        els.overlay.hidden = !!state.store;
      }
    });

    els.resetBtn.addEventListener('click', function () {
      state.store = null;
      state.filter = F.empty();
      state.selectedDay = null;
      state.sourceName = '';
      showError('');
      render();
    });

    els.granularity.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      state.granularity = btn.dataset.gran;
      els.granularity.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      render();
    });

    els.timelineMode.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      state.mode = btn.dataset.mode;
      els.timelineMode.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      render();
    });

    els.dayPicker.addEventListener('change', function (e) {
      state.selectedDay = e.target.value || null;
      render();
    });
    els.dayPrev.addEventListener('click', function () { stepDay(-1); });
    els.dayNext.addEventListener('click', function () { stepDay(1); });

    els.fProject.addEventListener('change', function (e) { state.filter.project = e.target.value; render(); });
    els.fTag.addEventListener('change', function (e) { state.filter.tag = e.target.value; render(); });
    els.fDone.addEventListener('change', function (e) { state.filter.done = e.target.value; render(); });
    els.fFrom.addEventListener('change', function (e) { state.filter.from = e.target.value; render(); });
    els.fTo.addEventListener('change', function (e) { state.filter.to = e.target.value; render(); });
    els.fClear.addEventListener('click', function () {
      state.filter = F.empty();
      populateFilters(state.store);
      render();
    });
    els.fChips.addEventListener('click', function (e) {
      var key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      state.filter[key] = '';
      populateFilters(state.store);
      render();
    });

    els.pngTimeline.addEventListener('click', function () { downloadChart('chart-timeline', 'sp-dash-timeline.png'); });
    els.pngHeatmap.addEventListener('click', function () { downloadChart('chart-heatmap', 'sp-dash-heatmap.png'); });
    els.pngEstimates.addEventListener('click', function () { downloadChart('chart-estimates', 'sp-dash-estimates.png'); });

    window.addEventListener('resize', function () {
      Object.keys(chartInstances).forEach(function (id) { chartInstances[id].resize(); });
    });
  }

  function boot() {
    wire();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  SP.app = { state: state, render: render, handleFiles: handleFiles, boot: boot };
})(typeof globalThis !== 'undefined' ? globalThis : this);
