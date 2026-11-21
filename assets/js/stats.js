/*
 * 관리자 화면 집계 — 응답 시트 원본(열 이름 + 문자열 행)을 읽어 문항별로 센다.
 * createSurveyStats(def): 회차 정의에 맞춘 집계 묶음. 어떤 문항 구성이든 형식(type)에 따라 센다.
 * DOM 없이 순수 함수만 둔다(Node 테스트용). 개인을 특정하는 값은 다루지 않는다.
 *
 * 그룹: 정의의 analysis.groupBy(단일 선택 문항)의 선택지마다 한 그룹. 'all'은 전체.
 * 작은 집단 보호: 그룹 응답이 MIN_GROUP(3)명 미만이면 화면에서 그 그룹 결과를 숨긴다(사용자 결정 2026-11-21).
 */
// 브라우저에서는 logic.js가 먼저 불려 전역 createSurveyLogic이 있고, Node에서는 require로 가져온다
var statsLogicFactory_ = typeof createSurveyLogic !== 'undefined' ? createSurveyLogic : require('./logic.js').createSurveyLogic;

function createSurveyStats(def) {
  var L = statsLogicFactory_(def);
  var MIN_GROUP = 3;
  var analysis = def.analysis || {};

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
    return rows.map(function (r) {
      var a = { id: r[idx['응답ID']] || '', date: r[idx['제출일']] || '' };
      def.questions.forEach(function (q) {
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

  /* ── 그룹 ── */

  var groupQ = analysis.groupBy ? L.findQuestion(analysis.groupBy) : null;
  if (groupQ && groupQ.type !== 'single') groupQ = null;

  // [{ key: 'all', label: '전체' }, { key: 'g1', label: '영업직', value: 1 }, ...]
  var GROUPS = [{ key: 'all', label: '전체', short: '전체', value: null }].concat(groupQ ? groupQ.options.map(function (o) {
    // 화면용 짧은 이름: 끝의 괄호 설명은 뺀다 ('관리·지원직 (지점 관리직, 운영팀)' → '관리·지원직')
    return { key: 'g' + o.value, label: o.label, short: o.label.replace(/\s*\([^)]*\)\s*$/, '') || o.label, value: o.value };
  }) : []);

  function group(key) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].key === key) return GROUPS[i];
    return GROUPS[0];
  }

  function filterByGroup(list, key) {
    var g = group(key);
    if (g.value === null || !groupQ) return list;
    return list.filter(function (a) { return a[groupQ.id] === g.value; });
  }

  // 그룹 인원이 적어 결과를 숨겨야 하는지 (전체는 숨기지 않음)
  function isHidden(key, n) {
    return key !== 'all' && n < MIN_GROUP;
  }

  /* ── 문항별 집계 ── */

  function emptyCounts(q) {
    var c = {};
    q.options.forEach(function (o) { c[o.value] = 0; });
    return c;
  }

  // 단일 선택: { n(응답한 사람), counts{코드: 인원} }
  function single(list, qid) {
    var q = L.findQuestion(qid);
    var counts = emptyCounts(q);
    var n = 0;
    list.forEach(function (a) {
      if (a[qid] === null || a[qid] === undefined || counts[a[qid]] === undefined) return;
      counts[a[qid]]++;
      n++;
    });
    return { n: n, counts: counts };
  }

  // 척도: { n, mean, counts{min..max} }
  function scale(list, qid) {
    var q = L.findQuestion(qid);
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
    var q = L.findQuestion(qid);
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

  // 높은 점수 기준: 분석 설정값, 없으면 최고점에서 두 칸(1~5점이면 4점 이상)
  function highThreshold(q) {
    var t = analysis.highThreshold;
    if (typeof t === 'number' && t >= q.min && t <= q.max) return t;
    return Math.max(q.min, q.max - 1);
  }

  /*
   * 항목별 점수: [{ index, label, n(해당 있음 응답 수), mean('해당 없음' 제외), high(높은 점수 인원), na }]
   */
  function grid(list, qid) {
    var q = L.findQuestion(qid);
    var th = highThreshold(q);
    return q.items.map(function (label, i) {
      var n = 0;
      var sum = 0;
      var high = 0;
      var na = 0;
      list.forEach(function (a) {
        var x = Array.isArray(a[qid]) ? a[qid][i] : null;
        if (x === null || x === undefined) return;
        if (q.na && x === q.na.value) { na++; return; }
        n++;
        sum += x;
        if (x >= th) high++;
      });
      return { index: i, label: label, n: n, mean: n ? sum / n : null, high: high, na: na };
    });
  }

  /*
   * 교차표: 행 문항(단일 선택)의 답별로 열 문항(단일·복수 선택)을 고른 인원.
   * 반환: { rows: [{ value, label, n, counts{열코드: 인원} }], none(행에서 '없음 표시' 선택지 인원), noneLabel }
   * 응답이 있는 행만, 인원 많은 순. '없음 표시' 선택지는 열 문항을 건너뛰므로 따로 센다.
   */
  function cross(list, rowQid, colQid) {
    var rq = L.findQuestion(rowQid);
    var cq = L.findQuestion(colQid);
    var rows = [];
    var none = 0;
    var noneLabel = '';
    rq.options.forEach(function (o) {
      var members = list.filter(function (a) { return a[rowQid] === o.value; });
      if (!members.length) return;
      if (o.none) { none += members.length; noneLabel = noneLabel ? noneLabel + ', ' + o.label : o.label; return; }
      var counts = emptyCounts(cq);
      members.forEach(function (a) {
        var v = a[colQid];
        (Array.isArray(v) ? v : (v === null || v === undefined ? [] : [v])).forEach(function (x) { if (counts[x] !== undefined) counts[x]++; });
      });
      rows.push({ value: o.value, label: o.label, n: members.length, counts: counts });
    });
    rows.sort(function (a, b) { return b.n - a.n || a.value - b.value; });
    return { rows: rows, none: none, noneLabel: noneLabel };
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

  return {
    def: def,
    logic: L,
    MIN_GROUP: MIN_GROUP,
    GROUPS: GROUPS,
    groupQuestion: groupQ,
    group: group,
    filterByGroup: filterByGroup,
    isHidden: isHidden,
    parseRows: parseRows,
    single: single,
    scale: scale,
    multi: multi,
    grid: grid,
    highThreshold: highThreshold,
    cross: cross,
    byDate: byDate,
    texts: texts,
    pct: function (m, n) { return n ? Math.round((m / n) * 100) : 0; },
    fmtMean: function (x) { return x === null || x === undefined ? '-' : (Math.round(x * 100) / 100).toFixed(2); }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createSurveyStats;
