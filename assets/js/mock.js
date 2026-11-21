/*
 * MOCK 서버 — GAS 없이 화면을 테스트하기 위한 가짜 백엔드.
 * 실제 서버(2단계)와 같은 규칙을 흉내 낸다: 명부와 응답을 따로 저장하고, 응답에는 이름·소속·토큰을 남기지 않는다.
 * 데이터는 이 브라우저의 localStorage에만 있다. 명단은 실명처럼 보이지 않는 테스트 이름만 쓴다.
 */
var MockServer = (function () {
  var KEY_ROSTER = 'hstc_mock_roster_v1';
  var KEY_TOKENS = 'hstc_mock_tokens_v1';
  var KEY_RESPONSES = 'hstc_mock_responses_v1';
  var KEY_ACCEPTING = 'hstc_mock_accepting_v1';
  var KEY_ADMIN = 'hstc_mock_admin_tokens_v1';
  var TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2시간
  var ADMIN_TTL_MS = 6 * 60 * 60 * 1000; // 6시간
  var MOCK_ADMIN_PASSWORD = 'mock-admin'; // MOCK 전용. 실제 비밀번호는 GAS Script Properties에만 있다.

  var SEED_ROSTER = [
    { branch: '죽전', name: '테스트1', status: '미참여', resets: 0 },
    { branch: '죽전', name: '테스트2', status: '미참여', resets: 0 },
    { branch: '하남', name: '테스트3', status: '미참여', resets: 0 },
    { branch: '천안', name: '테스트4', status: '미참여', resets: 0 },
    { branch: '운영팀', name: '테스트5', status: '미참여', resets: 0 },
    { branch: '죽전', name: '완료자', status: '완료', resets: 0 }
  ];

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경은 무시 */ }
  }

  function roster() { return read(KEY_ROSTER, null) || JSON.parse(JSON.stringify(SEED_ROSTER)); }

  function randomId(len) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    var out = '';
    var buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    for (var i = 0; i < len; i++) out += chars[buf[i] % chars.length];
    return out;
  }

  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function ok(data) { return { ok: true, data: data }; }
  function fail(msg) { return { ok: false, error: msg }; }

  // 응답 받기 상태. URL ?mock=off|before|after 로 다른 상태를 흉내 낸다.
  function status() {
    var mode = new URLSearchParams(location.search).get('mock');
    var state = { off: 'off', before: 'before', after: 'after' }[mode] || (read(KEY_ACCEPTING, true) ? 'open' : 'off');
    return ok({ state: state, startDate: '2026-11-24', endDate: '2026-12-05', shareMonth: '12월', version: SURVEY_DEF.version });
  }

  function start(payload) {
    var st = status().data;
    if (st.state !== 'open') return fail('지금은 설문에 참여할 수 없습니다.');
    var branch = payload && payload.branch;
    var name = SurveyLogic.normalizeName(payload && payload.name);
    if (SURVEY_DEF.branches.indexOf(branch) === -1) return fail('소속을 선택해 주세요.');
    if (!name) return fail('이름을 입력해 주세요.');

    var list = roster();
    var key = SurveyLogic.nameKey(name);
    var matches = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].branch === branch && SurveyLogic.nameKey(list[i].name) === key) matches.push(i);
    }
    if (matches.length === 0) return fail('명단에서 찾을 수 없습니다. 소속과 이름을 확인해 주세요.');
    if (matches.length > 1) return fail('같은 소속에 같은 이름이 있어 확인이 필요합니다. 관리자에게 문의해 주세요.');
    var row = matches[0];
    if (list[row].status === '완료') return fail('이미 참여하셨습니다. 다시 응답해야 하면 관리자에게 문의해 주세요.');

    var tokens = read(KEY_TOKENS, {});
    var token = randomId(32);
    tokens[token] = { row: row, exp: Date.now() + TOKEN_TTL_MS };
    write(KEY_TOKENS, tokens);
    return ok({ token: token });
  }

  function submit(payload) {
    var st = status().data;
    if (st.state !== 'open') return fail('응답 기간이 끝나 제출할 수 없습니다.');
    if (!payload || payload.version !== SURVEY_DEF.version) return fail('설문 문항이 갱신되었습니다. 새로고침한 뒤 다시 시도해 주세요.');

    var tokens = read(KEY_TOKENS, {});
    var t = tokens[payload.token];
    if (!t || t.exp < Date.now()) return fail('참여 확인 시간이 지났습니다. 처음 화면에서 소속과 이름을 다시 입력해 주세요. 작성한 응답은 유지됩니다.');

    var v = SurveyLogic.validateAnswers(payload.answers);
    if (!v.ok) return fail(v.error);

    var list = roster();
    if (list[t.row].status === '완료') return fail('이미 참여하셨습니다. 다시 응답해야 하면 관리자에게 문의해 주세요.');

    // ① 토큰 검증(위) ② 명부 완료 ③ 응답을 이름 없이 추가 ④ 토큰 삭제
    list[t.row].status = '완료';
    write(KEY_ROSTER, list);
    var responses = read(KEY_RESPONSES, []);
    responses.splice(Math.floor(Math.random() * (responses.length + 1)), 0, { id: randomId(12), date: todayStr(), answers: v.data });
    write(KEY_RESPONSES, responses);
    delete tokens[payload.token];
    write(KEY_TOKENS, tokens);
    return ok({});
  }

  // 테스트용: MOCK 명부·응답을 처음 상태로 되돌린다.
  function reset() {
    try {
      [KEY_ROSTER, KEY_TOKENS, KEY_RESPONSES, KEY_ACCEPTING, KEY_ADMIN].forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* 무시 */ }
  }

  /* ── 관리자 (실제 서버 gas/Admin.js와 같은 응답 모양) ── */

  function adminCheck(token) {
    var tokens = read(KEY_ADMIN, {});
    return !!(token && tokens[token] && tokens[token] > Date.now());
  }

  function admin(payload) {
    var p = payload || {};
    if (p.action === 'adminLogin') {
      if (p.password !== MOCK_ADMIN_PASSWORD) return fail('비밀번호가 맞지 않습니다.');
      var tokens = read(KEY_ADMIN, {});
      var t = randomId(64);
      tokens[t] = Date.now() + ADMIN_TTL_MS;
      write(KEY_ADMIN, tokens);
      return ok({ token: t, expiresInSec: ADMIN_TTL_MS / 1000 });
    }
    if (!adminCheck(p.token)) return fail('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    var list = roster();
    switch (p.action) {
      case 'adminLogout':
        var all = read(KEY_ADMIN, {});
        delete all[p.token];
        write(KEY_ADMIN, all);
        return ok({});
      case 'adminOverview':
        var st = status().data;
        return ok({
          settings: { state: st.state, accepting: read(KEY_ACCEPTING, true), startDate: st.startDate, endDate: st.endDate, shareMonth: st.shareMonth },
          branches: SURVEY_DEF.branches.map(function (b) {
            var mine = list.filter(function (r) { return r.branch === b; });
            return { branch: b, total: mine.length, done: mine.filter(function (r) { return r.status === '완료'; }).length };
          }),
          unknownBranch: 0,
          version: SURVEY_DEF.version
        });
      case 'adminRoster':
        return ok({ list: list.map(function (r, i) { return { row: i + 2, branch: r.branch, name: r.name, status: r.status, resets: r.resets || 0 }; }) });
      case 'adminResponses':
        var rows = read(KEY_RESPONSES, []).map(function (x) {
          return [x.id, x.date].concat(SurveyLogic.answersToCells(x.answers)).map(function (v) { return v === null || v === undefined ? '' : String(v); });
        });
        return ok({ columns: SurveyLogic.responseColumns(), rows: rows, version: SURVEY_DEF.version });
      case 'adminReset':
        var e = list[p.row - 2];
        if (!e || e.branch !== p.branch || e.name !== p.name) return fail('명부가 그 사이 바뀌었습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.');
        e.status = '미참여';
        e.resets = (e.resets || 0) + 1;
        write(KEY_ROSTER, list);
        return ok({ row: p.row, status: e.status, resets: e.resets });
      case 'adminSetAccepting':
        write(KEY_ACCEPTING, p.accepting === true);
        return admin({ action: 'adminOverview', token: p.token });
      default:
        return fail('요청이 올바르지 않습니다.');
    }
  }

  /*
   * 관리자 화면 시연용 샘플 응답 n건을 만든다(무작위, 모두 검증 통과).
   * 명부에도 '샘플01'처럼 실명이 아닌 완료자를 같은 수만큼 넣어 현황 숫자가 맞게 한다.
   */
  var SAMPLE_TEXTS = [
    '같은 건인데 지점마다 처리 기준이 달라 다시 확인하는 일이 잦습니다.',
    '결재가 몰리는 날에는 고객에게 답을 늦게 드리게 됩니다.',
    '필요한 자료가 여러 파일에 흩어져 있어 찾는 데 시간이 걸립니다.',
    '신규 입사자 교육 자료가 정리되어 있으면 좋겠습니다.',
    '주간 회의에서 이슈를 바로 공유하는 방식은 계속 유지되었으면 합니다.'
  ];
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pickDistinct(pool, k) {
    var copy = pool.slice();
    var out = [];
    while (out.length < k && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }
  function sampleAnswers() {
    var a = { Q1: Math.random() < 0.6 ? 1 : 2, Q2: rnd(1, 5), Q3: rnd(1, 5), Q4: [] };
    for (var i = 0; i < 13; i++) a.Q4.push(Math.random() < 0.08 ? 0 : rnd(1, 5));
    a.Q5 = Math.random() < 0.1 ? 15 : (Math.random() < 0.08 ? 14 : rnd(1, 13));
    if (a.Q5 === 14) a.Q5_etc = '주차 공간이 부족합니다.';
    if (a.Q5 !== 15) {
      a.Q6 = pickDistinct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], rnd(1, 2));
      if (a.Q6.indexOf(12) !== -1) a.Q6_etc = '인수인계가 잘 되지 않습니다.';
    }
    a.Q7 = Math.random() < 0.1 ? [8] : pickDistinct([1, 2, 3, 4, 5, 6, 7, 9], rnd(1, 3));
    if (a.Q7.indexOf(9) !== -1) a.Q7_etc = '고객 불만이 늘었습니다.';
    a.Q8 = rnd(1, 7);
    a.Q9 = pickDistinct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], rnd(1, 2));
    if (a.Q9.indexOf(12) !== -1) a.Q9_etc = '지점 간 정보 공유 채널';
    a.Q10 = rnd(1, 5);
    a.Q11 = rnd(1, 6);
    a.Q12 = Math.random() < 0.5 ? pick(SAMPLE_TEXTS) : '';
    a.Q13 = Math.random() < 0.3 ? pick(SAMPLE_TEXTS) : '';
    a.Q14 = Math.random() < 0.2 ? pick(SAMPLE_TEXTS) : '';
    return a;
  }
  function seedSamples(n) {
    var responses = read(KEY_RESPONSES, []);
    var list = roster();
    var dates = ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'];
    for (var i = 0; i < n; i++) {
      var v = SurveyLogic.validateAnswers(sampleAnswers());
      if (!v.ok) continue;
      responses.splice(Math.floor(Math.random() * (responses.length + 1)), 0, { id: randomId(12), date: pick(dates), answers: v.data });
      list.push({ branch: pick(SURVEY_DEF.branches), name: '샘플' + (list.length + 1), status: '완료', resets: 0 });
    }
    write(KEY_RESPONSES, responses);
    write(KEY_ROSTER, list);
  }

  function hint() {
    return SEED_ROSTER.map(function (r) { return r.name + '(' + r.branch + ')'; }).join(', ');
  }

  return { status: status, start: start, submit: submit, reset: reset, hint: hint, admin: admin, seedSamples: seedSamples, ADMIN_PASSWORD: MOCK_ADMIN_PASSWORD };
})();
