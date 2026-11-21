/*
 * 관리자 화면 집계 — 응답 시트 원본(열 이름 + 문자열 행)을 읽어 문항별로 센다.
 * DOM 없이 순수 함수만 둔다(Node 테스트용). 개인을 특정하는 값은 다루지 않는다.
 */
var SurveyStats = (function () {
  function getDef() {
    if (typeof SURVEY_DEF !== 'undefined') return SURVEY_DEF;
    return require('./questions.js');
  }
  function getLogic() {
    if (typeof SurveyLogic !== 'undefined') return SurveyLogic;
    return require('./logic.js');
  }

  var ROLES = {
    all: { label: '전체', value: null },
    sales: { label: '영업직', value: 1 },
    support: { label: '관리·지원직', value: 2 }
  };

  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /*
   * 응답 시트 행 → 응답 객체 배열
   * columns: ['응답ID','제출일','Q1',...], rows: [['abc','2026-11-24','1',...], ...]
   */
  function parseRows(columns, rows) {
    var idx = {};
    columns.forEach(function (c, i) { idx[c] = i; });
    var L = getLogic();
    return rows.map(function (r) {
      var a = { id: r[idx['응답ID']] || '', date: r[idx['제출일']] || '' };
      getDef().questions.forEach(function (q) {
        if (q.type === 'grid') {
          a[q.id] = q.items.map(function (_, i) { return num(r[idx[q.id + '_' + (i + 1)]]); });
        } else if (q.type === 'multi') {
          var raw = String(r[idx[q.id]] || '');
          a[q.id] = raw ? raw.split(',').map(num).filter(function (x) { return x !== null; }) : [];
        } else if (q.type === 'text') {
          a[q.id] = String(r[idx[q.id]] || '');
        } else {
          a[q.id] = num(r[idx[q.id]]);
        }
        if (L.etcOption(q)) a[L.etcKey(q)] = String(r[idx[L.etcKey(q)]] || '');
      });
      return a;
    });
  }

  function filterByRole(list, role) {
    var r = ROLES[role] || ROLES.all;
    if (r.value === null) return list;
    return list.filter(function (a) { return a.Q1 === r.value; });
  }

  function emptyCounts(q) {
    var c = {};
    q.options.forEach(function (o) { c[o.value] = 0; });
    return c;
  }

  // 단일 선택: { n(응답한 사람), counts{코드: 인원} }
  function single(list, qid) {
    var q = getLogic().findQuestion(qid);
    var counts = emptyCounts(q);
    var n = 0;
    list.forEach(function (a) {
      if (a[qid] === null || a[qid] === undefined || counts[a[qid]] === undefined) return;
      counts[a[qid]]++;
      n++;
    });
    return { n: n, counts: counts };
  }

  // 5점 척도: { n, mean, counts{1..5} }
  function scale(list, qid) {
    var q = getLogic().findQuestion(qid);
    var counts = {};
    for (var v = q.min; v <= q.max; v++) counts[v] = 0;
    var n = 0;
    var sum = 0;
    list.forEach(function (a) {
      var x = a[qid];
      if (x === null || x === undefined || counts[x] === undefined) return;
      counts[x]++;
      n++;
      sum += x;
    });
    return { n: n, mean: n ? sum / n : null, counts: counts };
  }

  // 복수 선택: { n(이 문항에 답한 사람), counts{코드: 고른 사람 수} }
  function multi(list, qid) {
    var q = getLogic().findQuestion(qid);
    var counts = emptyCounts(q);
    var n = 0;
    list.forEach(function (a) {
      var arr = a[qid];
      if (!Array.isArray(arr) || !arr.length) return;
      n++;
      arr.forEach(function (x) { if (counts[x] !== undefined) counts[x]++; });
    });
    return { n: n, counts: counts };
  }

  /*
   * Q4 항목별: { index, label, n(해당 있음 응답 수), mean('해당 없음' 제외), high(4~5점 인원), na(해당 없음) }
   */
  function grid(list, qid) {
    var q = getLogic().findQuestion(qid);
    return q.items.map(function (label, i) {
      var n = 0;
      var sum = 0;
      var high = 0;
      var na = 0;
      list.forEach(function (a) {
        var x = Array.isArray(a[qid]) ? a[qid][i] : null;
        if (x === null || x === undefined) return;
        if (x === q.na.value) { na++; return; }
        n++;
        sum += x;
        if (x >= 4) high++;
      });
      return { index: i, label: label, n: n, mean: n ? sum / n : null, high: high, na: na };
    });
  }

  /*
   * Q5 × Q6 교차표: 가장 큰 어려움(Q5)별로 원인(Q6)을 고른 인원.
   * 반환: { rows: [{ value, label, n, counts{Q6코드: 인원} }], none(특별한 어려움 없음 인원) }
   * 응답이 있는 Q5 항목만, 인원 많은 순.
   */
  function cross(list, rowQid, colQid) {
    var L = getLogic();
    var rq = L.findQuestion(rowQid);
    var cq = L.findQuestion(colQid);
    var rows = [];
    var none = 0;
    rq.options.forEach(function (o) {
      var members = list.filter(function (a) { return a[rowQid] === o.value; });
      if (!members.length) return;
      if (o.none) { none = members.length; return; }
      var counts = emptyCounts(cq);
      members.forEach(function (a) {
        (a[colQid] || []).forEach(function (x) { if (counts[x] !== undefined) counts[x]++; });
      });
      rows.push({ value: o.value, label: o.label, n: members.length, counts: counts });
    });
    rows.sort(function (a, b) { return b.n - a.n || a.value - b.value; });
    return { rows: rows, none: none };
  }

  // 날짜별 응답 수 (오래된 날짜부터)
  function byDate(list) {
    var m = {};
    list.forEach(function (a) { if (a.date) m[a.date] = (m[a.date] || 0) + 1; });
    return Object.keys(m).sort().map(function (d) { return { date: d, count: m[d] }; });
  }

  // 주관식·기타 원문 (빈 글 제외). 순서는 응답 시트 순서(무작위)를 따른다.
  function texts(list, key) {
    return list.map(function (a) { return String(a[key] || '').trim(); }).filter(Boolean);
  }

  function pct(m, n) { return n ? Math.round((m / n) * 100) : 0; }

  function fmtMean(x) { return x === null || x === undefined ? '-' : (Math.round(x * 100) / 100).toFixed(2); }

  return {
    ROLES: ROLES,
    parseRows: parseRows,
    filterByRole: filterByRole,
    single: single,
    scale: scale,
    multi: multi,
    grid: grid,
    cross: cross,
    byDate: byDate,
    texts: texts,
    pct: pct,
    fmtMean: fmtMean
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SurveyStats;
