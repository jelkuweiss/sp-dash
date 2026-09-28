(function (root) {
  'use strict';

  var SP = (root.SP = root.SP || {});
  var fmt = (SP.aggregate && SP.aggregate.formatDuration) || function (ms) { return ms + 'ms'; };

  var TEXT = '#e6ecf3';
  var DIM = '#9aa8ba';
  var FAINT = '#6d7b8d';
  var LINE = '#2a3442';
  var BG = '#161c25';

  function baseGrid() {
    return { left: 62, right: 24, top: 34, bottom: 58, containLabel: false };
  }

  function axisCommon() {
    return {
      axisLine: { lineStyle: { color: LINE } },
      axisTick: { lineStyle: { color: LINE } },
      axisLabel: { color: DIM, fontSize: 11 },
      splitLine: { lineStyle: { color: LINE, type: 'dashed' } }
    };
  }

  function hoursAxis(maxMs) {
    var a = axisCommon();
    a.type = 'value';
    a.name = 'hours';
    a.nameTextStyle = { color: FAINT, fontSize: 11 };
    a.max = maxMs || null;
    a.axisLabel = {
      color: DIM,
      fontSize: 11,
      formatter: function (v) { return v <= 0 ? '0' : (v / 3600000).toFixed(v >= 3600000 * 10 ? 0 : 1); }
    };
    return a;
  }

  function timelineOption(series, opts) {
    var options = opts || {};
    var labels = series.buckets.map(function (b) { return b.label; });

    var maxTotal = 0;
    series.totals.forEach(function (t) { if (t > maxTotal) maxTotal = t; });

    var chartSeries = series.segments.map(function (p, i) {
      var s = {
        name: p.title,
        type: 'bar',
        stack: 'tracked',
        barMaxWidth: 42,
        emphasis: { focus: 'series' },
        itemStyle: { color: p.color || undefined },
        data: series.values[p.id].map(function (ms) { return ms || 0; })
      };
      if (i === 0 && options.selectedIndex >= 0 && options.selectedIndex < labels.length) {
        s.markArea = {
          silent: true,
          itemStyle: { color: 'rgba(41,161,170,0.07)', borderColor: 'rgba(41,161,170,0.35)', borderWidth: 1 },
          data: [[{ xAxis: labels[options.selectedIndex] }, { xAxis: labels[options.selectedIndex] }]]
        };
      }
      return s;
    });

    if (!chartSeries.length) {
      chartSeries = [{ name: 'tracked', type: 'bar', stack: 'tracked', data: [] }];
    }

    return {
      backgroundColor: 'transparent',
      color: series.segments.map(function (p, i) { return p.color || ['#29a1aa', '#ff4081', '#7c6cf0'][i % 3]; }),
      animation: false,
      grid: baseGrid(),
      legend: {
        type: 'scroll',
        top: 4,
        textStyle: { color: DIM, fontSize: 11 },
        inactiveColor: FAINT,
        pageTextStyle: { color: DIM }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#10141b',
        borderColor: LINE,
        textStyle: { color: TEXT, fontSize: 12 },
        formatter: function (params) {
          if (!params || !params.length) return '';
          var head = params[0].axisValueLabel || params[0].name;
          var lines = [head];
          var total = 0;
          params.forEach(function (p) {
            if (!p.value) return;
            total += p.value;
            lines.push(p.marker + ' ' + p.seriesName + ': ' + fmt(p.value));
          });
          lines.push('<strong>total ' + fmt(total) + '</strong>');
          return lines.join('<br>');
        }
      },
      xAxis: Object.assign(axisCommon(), {
        type: 'category',
        data: labels,
        splitLine: { show: false },
        axisLabel: { color: DIM, fontSize: 10, rotate: labels.length > 26 ? 60 : 0, hideOverlap: true }
      }),
      yAxis: hoursAxis(maxTotal),
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift' },
        { type: 'slider', xAxisIndex: 0, height: 18, bottom: 24, borderColor: LINE, backgroundColor: BG, fillerColor: 'rgba(41,161,170,0.18)', handleStyle: { color: '#29a1aa' }, textStyle: { color: FAINT, fontSize: 10 } }
      ],
      series: chartSeries
    };
  }

  function calendarHeatmapOption(store, stats) {
    var days = SP.aggregate.activeDays(store);
    var dayTotals = stats.dayTotals || {};

    if (!days.length) {
      return {
        backgroundColor: 'transparent',
        animation: false,
        title: { text: 'no days in range', left: 'center', top: 'middle', textStyle: { color: FAINT, fontSize: 13 } },
        series: []
      };
    }

    var minDay = days[0];
    var maxDay = days[days.length - 1];
    var maxMs = 0;

    var allDays = [];
    var cursor = minDay;
    var guard = 0;
    while (cursor <= maxDay && guard < 20000) {
      allDays.push(cursor);
      cursor = SP.aggregate.addDays(cursor, 1);
      guard += 1;
    }

    allDays.forEach(function (d) { if ((dayTotals[d] || 0) > maxMs) maxMs = dayTotals[d]; });
    if (maxMs <= 0) maxMs = 1;

    var years = [];
    for (var y = +minDay.slice(0, 4); y <= +maxDay.slice(0, 4); y += 1) years.push(y);

    var calendars = [];
    var top = 30;
    years.forEach(function (year) {
      var first = null;
      var last = null;
      allDays.forEach(function (d) {
        if (+d.slice(0, 4) !== year) return;
        if (first === null) first = d;
        last = d;
      });
      calendars.push({
        top: top,
        left: 68,
        right: 30,
        cellSize: ['auto', 14],
        range: [first, last],
        orient: 'horizontal',
        splitLine: { show: false },
        itemStyle: { color: 'transparent', borderColor: '#0e131a', borderWidth: 1 },
        yearLabel: { show: true, color: DIM, fontSize: 11, position: 'left' },
        dayLabel: { color: FAINT, fontSize: 10, nameMap: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
        monthLabel: { color: DIM, fontSize: 10 }
      });
      top += 148;
    });

    var dataByYear = {};
    years.forEach(function (year) { dataByYear[year] = []; });
    allDays.forEach(function (d) {
      var year = +d.slice(0, 4);
      dataByYear[year].push([d, dayTotals[d] || 0]);
    });

    var series = years.map(function (year, i) {
      return {
        name: 'tracked',
        type: 'heatmap',
        coordinateSystem: 'calendar',
        calendarIndex: i,
        data: dataByYear[year],
        itemStyle: { borderColor: '#0e131a', borderWidth: 1, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: '#e6ecf3', borderWidth: 1 } }
      };
    });

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        backgroundColor: '#10141b',
        borderColor: LINE,
        textStyle: { color: TEXT, fontSize: 12 },
        formatter: function (p) {
          if (!p.value) return 'no data';
          return p.value[0] + ': ' + fmt(p.value[1]);
        }
      },
      visualMap: {
        type: 'continuous',
        min: 0,
        max: maxMs,
        orient: 'horizontal',
        left: 'center',
        bottom: 2,
        itemWidth: 12,
        itemHeight: 120,
        text: ['more', 'none'],
        textStyle: { color: DIM, fontSize: 11 },
        inRange: { color: ['#16232c', '#123f43', '#1c7276', '#29a1aa', '#6fd0cf', '#c8f3ef'] }
      },
      calendar: calendars,
      series: series
    };
  }

  function estimateScatterOption(rows) {
    var points = rows.filter(function (r) { return r.estimate > 0 || r.actual > 0; });
    var max = 0;
    points.forEach(function (r) {
      if (r.estimate > max) max = r.estimate;
      if (r.actual > max) max = r.actual;
    });
    max = max || 3600000;

    var done = [];
    var open = [];
    points.forEach(function (r, i) {
      var item = {
        value: [r.estimate, r.actual],
        name: r.title,
        project: r.projectTitle,
        ratio: r.ratio,
        index: i
      };
      (r.isDone ? done : open).push(item);
    });

    return {
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 70, right: 30, top: 30, bottom: 46 },
      tooltip: {
        backgroundColor: '#10141b',
        borderColor: LINE,
        textStyle: { color: TEXT, fontSize: 12 },
        formatter: function (p) {
          var d = p.data;
          var lines = ['<strong>' + d.name + '</strong>', d.project];
          lines.push('estimate ' + fmt(d.value[0]));
          lines.push('actual ' + fmt(d.value[1]));
          if (d.ratio !== null && d.ratio !== undefined) lines.push('ratio ' + d.ratio.toFixed(2) + 'x');
          return lines.join('<br>');
        }
      },
      legend: { top: 2, textStyle: { color: DIM, fontSize: 11 }, data: ['done', 'not done'] },
      xAxis: Object.assign(axisCommon(), {
        type: 'value',
        name: 'estimate',
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: FAINT, fontSize: 11 },
        max: max * 1.05,
        axisLabel: { color: DIM, fontSize: 11, formatter: function (v) { return (v / 3600000).toFixed(1); } }
      }),
      yAxis: Object.assign(axisCommon(), {
        type: 'value',
        name: 'actual',
        nameTextStyle: { color: FAINT, fontSize: 11 },
        max: max * 1.05,
        axisLabel: { color: DIM, fontSize: 11, formatter: function (v) { return (v / 3600000).toFixed(1); } }
      }),
      series: [
        {
          name: 'parity',
          type: 'line',
          data: [[0, 0], [max * 1.05, max * 1.05]],
          symbol: 'none',
          lineStyle: { color: '#3a4a5e', type: 'dashed', width: 1 },
          silent: true,
          tooltip: { show: false }
        },
        { name: 'done', type: 'scatter', data: done, symbolSize: 11, itemStyle: { color: '#29a1aa', opacity: 0.85 } },
        { name: 'not done', type: 'scatter', data: open, symbolSize: 11, itemStyle: { color: '#ff4081', opacity: 0.85 } }
      ]
    };
  }

  SP.charts = {
    timelineOption: timelineOption,
    calendarHeatmapOption: calendarHeatmapOption,
    estimateScatterOption: estimateScatterOption,
    palette: { TEXT: TEXT, DIM: DIM, FAINT: FAINT, LINE: LINE, BG: BG }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
