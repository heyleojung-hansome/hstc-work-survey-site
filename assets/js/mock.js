/*
 * MOCK 서버 — GAS 없이 화면을 테스트하기 위한 가짜 백엔드(로컬 ?mock=1).
 * 실제 서버(gas/)와 같은 규칙·같은 응답 모양을 흉내 낸다:
 *   - 회차(작성중→진행→종료), 회차별 정의·응답, 편집 잠금(문구만), 편집 비밀번호 분리
 *   - 명부와 응답을 따로 저장하고, 응답에는 이름·소속·토큰을 남기지 않는다
 * 데이터는 이 브라우저의 localStorage에만 있다. 명단은 실명처럼 보이지 않는 테스트 이름만 쓴다.
 */
var MockServer = (function () {
  var KEY_ROSTER = 'hstc_mock_roster_v1';
  var KEY_TOKENS = 'hstc_mock_tokens_v1';
  var KEY_RESPONSES = 'hstc_mock_responses_v2';
  var KEY_STORE = 'hstc_mock_rounds_v2';      // { rounds, defs, active, accepting, branches }
  var KEY_ADMIN = 'hstc_mock_admin_tokens_v1';
  var KEY_EDIT = 'hstc_mock_edit_tokens_v1';
  var TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
  var ADMIN_TTL_MS = 6 * 60 * 60 * 1000;
  var EDIT_TTL_MS = 2 * 60 * 60 * 1000;
  // MOCK 전용 비밀번호. 실제 비밀번호는 GAS Script Properties에만 있다.
  var MOCK_ADMIN_PASSWORD = 'mock-admin';
  var MOCK_EDIT_PASSWORD = 'mock-edit';

  var SEED_ROSTER = [
    { branch: '죽전', name: '테스트1', status: '미참여', resets: 0 },
    { branch: '죽전', name: '테스트2', status: '미참여', resets: 0 },
    { branch: '하남', name: '테스트3', status: '미참여', resets: 0 },
    { branch: '천안', name: '테스트4', status: '미참여', resets: 0 },
    { branch: '운영팀', name: '테스트5', status: '미참여', resets: 0 },
    { branch: '죽전', name: '완료자', status: '완료', resets: 0 }
  ];

  var MSG = {
    SESSION: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    EDIT_SESSION: '편집 권한이 만료되었습니다. 편집 비밀번호를 다시 입력해 주세요.',
    WRONG_PW: '비밀번호가 맞지 않습니다.',
    NO_ROUND: '회차를 찾을 수 없습니다.',
    CONFLICT: '다른 사람이 먼저 이 설문을 저장했습니다. 새로 불러온 뒤 다시 고쳐 주세요.',
    CLOSED_ROUND: '종료된 회차는 고칠 수 없습니다. 복제해서 새 회차를 만들어 주세요.',
    WORDING_ONLY: '응답이 들어온 회차는 문구만 고칠 수 있습니다. 문항·선택지 추가·삭제·순서·형식은 바꿀 수 없습니다.',
    INVALID_DEF: '설문 내용에 고칠 곳이 있습니다.',
    NEED_PERIOD: '설문 기간(시작일·종료일)을 먼저 정해 주세요.',
    BAD_PERIOD: '설문 기간이 올바르지 않습니다. 날짜 형식(예: 2026-12-01)과 시작일 ≤ 종료일을 확인해 주세요.',
    BAD_SHARE: '결과 공유 월은 "12월"처럼 적어 주세요.',
    NOT_DRAFT: '작성중인 회차만 할 수 있습니다.',
    NOT_OPEN: '진행 중인 회차만 종료할 수 있습니다.',
    OTHER_OPEN: '이미 진행 중인 회차가 있습니다. 먼저 종료해 주세요.',
    NO_ACTIVE: '진행 중인 회차가 없습니다. [설문 편집]에서 회차를 시작해 주세요.',
    BAD_BRANCHES: '소속은 1~20개, 각 1~20자로, 서로 겹치지 않게 적어 주세요.'
  };

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
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function ok(data) { return { ok: true, data: data }; }
  function fail(msg, details) { var r = { ok: false, error: msg }; if (details) r.details = details; return r; }

  function randomId(len) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    var out = '';
    var buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    for (var i = 0; i < len; i++) out += chars[buf[i] % chars.length];
    return out;
  }
  function hexToken() {
    var buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    return Array.prototype.map.call(buf, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }
  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ── 저장소 ── */

  function roster() { return read(KEY_ROSTER, null) || clone(SEED_ROSTER); }

  // 처음에는 기본 템플릿으로 R1을 '진행' 상태로 둔다
  function store() {
    var s = read(KEY_STORE, null);
    if (s) return s;
    var def = clone(SURVEY_DEF);
    delete def.branches;
    def.version = 'R1-v1';
    return {
      rounds: [{ id: 'R1', title: def.title, status: '진행', startDate: '2026-11-24', endDate: '2026-12-05', shareMonth: '12월', version: def.version, counts: null, createdAt: todayStr(), updatedAt: todayStr() }],
      defs: { R1: def }, active: 'R1', accepting: true, branches: SURVEY_DEF.branches.slice()
    };
  }
  function saveStore(s) { write(KEY_STORE, s); }
  function findRound(s, id) {
    for (var i = 0; i < s.rounds.length; i++) if (s.rounds[i].id === id) return s.rounds[i];
    return null;
  }
  function responses() { return read(KEY_RESPONSES, []); }
  function countResponses(id) { return responses().filter(function (r) { return r.round === id; }).length; }
  function lockLevel(r) {
    if (r.status === '종료') return 'none';
    if (r.status === '진행' && countResponses(r.id) > 0) return 'wording';
    return 'full';
  }
  function active(s) {
    var r = s.active ? findRound(s, s.active) : null;
    return r && r.status === '진행' ? r : null;
  }

  /* ── 응답자 ── */

  // ?mock=off|before|after 로 다른 상태를 흉내 낸다
  function status() {
    var s = store();
    var r = active(s);
    var mode = new URLSearchParams(location.search).get('mock');
    var state = !r ? 'off' : ({ off: 'off', before: 'before', after: 'after' }[mode] || (s.accepting ? 'open' : 'off'));
    var def = r ? s.defs[r.id] : null;
    return ok({
      state: state, startDate: r ? r.startDate : '', endDate: r ? r.endDate : '', shareMonth: r ? r.shareMonth : '',
      branches: s.branches, round: r ? { id: r.id, title: r.title } : null, version: def ? def.version : '', definition: def
    });
  }

  function start(payload) {
    var st = status().data;
    if (st.state !== 'open') return fail('지금은 설문에 참여할 수 없습니다.');
    var branch = payload && payload.branch;
    var name = SurveyLogic.normalizeName(payload && payload.name);
    if (st.branches.indexOf(branch) === -1) return fail('소속을 선택해 주세요.');
    if (!name) return fail('이름을 입력해 주세요.');
    var list = roster();
    var key = SurveyLogic.nameKey(name);
    var matches = [];
    for (var i = 0; i < list.length; i++) if (list[i].branch === branch && SurveyLogic.nameKey(list[i].name) === key) matches.push(i);
    if (matches.length === 0) return fail('명단에서 찾을 수 없습니다. 소속과 이름을 확인해 주세요.');
    if (matches.length > 1) return fail('같은 소속에 같은 이름이 있어 확인이 필요합니다. 관리자에게 문의해 주세요.');
    if (list[matches[0]].status === '완료') return fail('이미 참여하셨습니다. 다시 응답해야 하면 관리자에게 문의해 주세요.');
    var tokens = read(KEY_TOKENS, {});
    var token = hexToken();
    tokens[token] = { row: matches[0], round: st.round.id, exp: Date.now() + TOKEN_TTL_MS };
    write(KEY_TOKENS, tokens);
    return ok({ token: token });
  }

  function submit(payload) {
    var st = status().data;
    if (st.state !== 'open') return fail('응답 기간이 아니어서 제출할 수 없습니다.');
    if (!payload || payload.roundId !== st.round.id || payload.version !== st.version) return fail('설문 문항이 갱신되었습니다. 새로고침한 뒤 다시 시도해 주세요.');
    var tokens = read(KEY_TOKENS, {});
    var t = tokens[payload.token];
    if (!t || t.exp < Date.now() || t.round !== st.round.id) return fail('참여 확인 시간이 지났습니다. 처음 화면에서 소속과 이름을 다시 입력해 주세요. 작성한 응답은 유지됩니다.');
    var v = createSurveyLogic(st.definition).validateAnswers(payload.answers);
    if (!v.ok) return fail(v.error);
    var list = roster();
    if (list[t.row].status === '완료') return fail('이미 참여하셨습니다. 다시 응답해야 하면 관리자에게 문의해 주세요.');
    // ① 토큰 검증(위) ② 명부 완료 ③ 응답을 이름 없이 무작위 위치에 ④ 토큰 삭제
    list[t.row].status = '완료';
    write(KEY_ROSTER, list);
    var all = responses();
    all.splice(Math.floor(Math.random() * (all.length + 1)), 0, { round: st.round.id, id: randomId(12), date: todayStr(), answers: v.data });
    write(KEY_RESPONSES, all);
    delete tokens[payload.token];
    write(KEY_TOKENS, tokens);
    return ok({});
  }

  // 테스트용: MOCK 데이터를 처음 상태로 되돌린다
  function reset() {
    try {
      [KEY_ROSTER, KEY_TOKENS, KEY_RESPONSES, KEY_STORE, KEY_ADMIN, KEY_EDIT, 'hstc_mock_responses_v1', 'hstc_mock_accepting_v1'].forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* 무시 */ }
  }

  /* ── 관리자 (gas/Admin.js와 같은 응답 모양) ── */

  function tokenOk(key, token) {
    var tokens = read(key, {});
    return !!(token && tokens[token] && tokens[token] > Date.now());
  }
  function issue(key, ttl) {
    var tokens = read(key, {});
    var t = hexToken();
    tokens[t] = Date.now() + ttl;
    write(key, tokens);
    return t;
  }
  function summary(r) { return clone(r); }

  function overview(s) {
    var r = active(s);
    var list = roster();
    var st = status().data;
    return ok({
      settings: { state: st.state, accepting: s.accepting, startDate: r ? r.startDate : '', endDate: r ? r.endDate : '', shareMonth: r ? r.shareMonth : '', hasEditPassword: true },
      round: r ? summary(r) : null,
      branchList: s.branches,
      branches: s.branches.map(function (b) {
        var mine = list.filter(function (x) { return x.branch === b; });
        return { branch: b, total: mine.length, done: mine.filter(function (x) { return x.status === '완료'; }).length };
      }),
      unknownBranch: list.filter(function (x) { return s.branches.indexOf(x.branch) === -1; }).length,
      version: r ? s.defs[r.id].version : ''
    });
  }

  function nextVersion(id, current) {
    var m = /-v(\d+)$/.exec(current || '');
    return id + '-v' + (m ? Number(m[1]) + 1 : 1);
  }

  function blankDef() {
    return {
      title: '새 설문', version: '', textMaxLength: 2000, sections: { A: '기본 정보' },
      texts: { intro: { greeting: [], items: [], closing: '' }, done: '응답해 주셔서 감사합니다.' },
      questions: [{ id: 'Q1', section: 'A', type: 'single', required: true, title: '질문을 입력하세요', options: [{ value: 1, label: '선택지 1' }, { value: 2, label: '선택지 2' }] }],
      analysis: {}
    };
  }

  function admin(payload) {
    var p = payload || {};
    if (p.action === 'adminLogin') {
      if (p.password !== MOCK_ADMIN_PASSWORD) return fail(MSG.WRONG_PW);
      return ok({ token: issue(KEY_ADMIN, ADMIN_TTL_MS), expiresInSec: ADMIN_TTL_MS / 1000 });
    }
    if (!tokenOk(KEY_ADMIN, p.token)) return fail(MSG.SESSION);
    var s = store();
    var list = roster();
    var r;
    switch (p.action) {
      case 'adminLogout':
        return ok({});
      case 'adminEditUnlock':
        if (p.password !== MOCK_EDIT_PASSWORD) return fail(MSG.WRONG_PW);
        return ok({ editToken: issue(KEY_EDIT, EDIT_TTL_MS), expiresInSec: EDIT_TTL_MS / 1000 });
      case 'adminOverview':
        return overview(s);
      case 'adminRoster':
        return ok({ list: list.map(function (x, i) { return { row: i + 2, branch: x.branch, name: x.name, status: x.status, resets: x.resets || 0 }; }) });
      case 'adminRounds':
        return ok({ activeRoundId: s.active || '', rounds: s.rounds.map(function (x) { var o = summary(x); o.responseCount = countResponses(x.id); return o; }) });
      case 'adminRoundGet':
        r = findRound(s, p.roundId);
        if (!r) return fail(MSG.NO_ROUND);
        return ok({ round: summary(r), definition: clone(s.defs[r.id]), lock: lockLevel(r), responseCount: countResponses(r.id) });
      case 'adminResponses':
        r = p.roundId ? findRound(s, p.roundId) : (active(s) || s.rounds.filter(function (x) { return x.status !== '작성중'; }).slice(-1)[0]);
        if (!r) return ok({ round: null, definition: null, columns: [], rows: [] });
        var logic = createSurveyLogic(s.defs[r.id]);
        var rows = responses().filter(function (x) { return x.round === r.id; }).map(function (x) {
          return [x.id, x.date].concat(logic.answersToCells(x.answers)).map(function (v) { return v === null || v === undefined ? '' : String(v); });
        });
        return ok({ round: summary(r), definition: clone(s.defs[r.id]), columns: logic.responseColumns(), rows: rows });
      case 'adminReset':
        var e = list[p.row - 2];
        if (!e || e.branch !== p.branch || e.name !== p.name) return fail('명부가 그 사이 바뀌었습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.');
        e.status = '미참여';
        e.resets = (e.resets || 0) + 1;
        write(KEY_ROSTER, list);
        return ok({ row: p.row, status: e.status, resets: e.resets });
      case 'adminSetAccepting':
        if (p.accepting === true) {
          r = active(s);
          if (!r) return fail(MSG.NO_ACTIVE);
          if (!r.startDate || !r.endDate) return fail(MSG.NEED_PERIOD);
        }
        s.accepting = p.accepting === true;
        saveStore(s);
        return overview(s);
    }

    // 아래는 편집 권한이 있어야 한다
    if (!tokenOk(KEY_EDIT, p.editToken)) return fail(MSG.EDIT_SESSION);
    switch (p.action) {
      case 'adminRoundCreate':
        var def;
        if (p.mode === 'copy') {
          if (!s.defs[p.sourceId]) return fail(MSG.NO_ROUND);
          def = clone(s.defs[p.sourceId]);
        } else if (p.mode === 'template') {
          def = clone(SURVEY_DEF);
          delete def.branches;
        } else {
          def = blankDef();
        }
        var max = 0;
        s.rounds.forEach(function (x) { var m = /^R(\d+)$/.exec(x.id); if (m) max = Math.max(max, Number(m[1])); });
        var id = 'R' + (max + 1);
        if (p.title && String(p.title).trim()) def.title = String(p.title).trim();
        def.version = nextVersion(id, '');
        r = { id: id, title: def.title, status: '작성중', startDate: '', endDate: '', shareMonth: '', version: def.version, counts: null, createdAt: todayStr(), updatedAt: todayStr() };
        s.rounds.push(r);
        s.defs[id] = def;
        saveStore(s);
        return ok({ round: summary(r), definition: clone(def), lock: 'full' });
      case 'adminRoundSave':
        r = findRound(s, p.roundId);
        if (!r) return fail(MSG.NO_ROUND);
        var lock = lockLevel(r);
        if (lock === 'none') return fail(MSG.CLOSED_ROUND);
        var current = s.defs[r.id];
        if (p.baseVersion !== current.version) return fail(MSG.CONFLICT);
        var check = SurveyDefCheck.validate(p.definition);
        if (!check.ok) return fail(MSG.INVALID_DEF, check.errors);
        if (lock === 'wording' && SurveyDefCheck.signature(p.definition) !== SurveyDefCheck.signature(current)) return fail(MSG.WORDING_ONLY);
        var meta = p.meta || {};
        var sd = typeof meta.startDate === 'string' ? meta.startDate : r.startDate;
        var en = typeof meta.endDate === 'string' ? meta.endDate : r.endDate;
        var sm = typeof meta.shareMonth === 'string' ? meta.shareMonth.trim() : r.shareMonth;
        var dateOk = function (x) { return !x || /^\d{4}-\d{2}-\d{2}$/.test(x); };
        if (!dateOk(sd) || !dateOk(en) || (sd && en && sd > en)) return fail(MSG.BAD_PERIOD);
        if (sm && !/^(1[0-2]|[1-9])월$/.test(sm)) return fail(MSG.BAD_SHARE);
        if (r.status === '진행' && (!sd || !en)) return fail(MSG.NEED_PERIOD);
        var saved = clone(p.definition);
        saved.title = saved.title.trim();
        saved.version = nextVersion(r.id, current.version);
        s.defs[r.id] = saved;
        Object.assign(r, { title: saved.title, version: saved.version, startDate: sd, endDate: en, shareMonth: sm, updatedAt: todayStr() });
        saveStore(s);
        return ok({ round: summary(r), definition: clone(saved), lock: lockLevel(r) });
      case 'adminRoundStart':
        r = findRound(s, p.roundId);
        if (!r) return fail(MSG.NO_ROUND);
        if (r.status !== '작성중') return fail(MSG.NOT_DRAFT);
        if (!r.startDate || !r.endDate) return fail(MSG.NEED_PERIOD);
        if (active(s)) return fail(MSG.OTHER_OPEN);
        var chk = SurveyDefCheck.validate(s.defs[r.id]);
        if (!chk.ok) return fail(MSG.INVALID_DEF, chk.errors);
        list.forEach(function (x) { x.status = '미참여'; x.resets = 0; });
        write(KEY_ROSTER, list);
        r.status = '진행';
        r.updatedAt = todayStr();
        s.active = r.id;
        s.accepting = false;
        saveStore(s);
        return ok({ round: summary(r) });
      case 'adminRoundClose':
        r = findRound(s, p.roundId);
        if (!r) return fail(MSG.NO_ROUND);
        if (r.status !== '진행') return fail(MSG.NOT_OPEN);
        var counts = {};
        s.branches.forEach(function (b) {
          var mine = list.filter(function (x) { return x.branch === b; });
          counts[b] = { total: mine.length, done: mine.filter(function (x) { return x.status === '완료'; }).length };
        });
        Object.assign(r, { counts: counts, status: '종료', updatedAt: todayStr() });
        s.active = '';
        s.accepting = false;
        saveStore(s);
        return ok({ round: summary(r) });
      case 'adminRoundDelete':
        r = findRound(s, p.roundId);
        if (!r) return fail(MSG.NO_ROUND);
        if (r.status !== '작성중') return fail(MSG.NOT_DRAFT);
        s.rounds = s.rounds.filter(function (x) { return x.id !== r.id; });
        delete s.defs[r.id];
        saveStore(s);
        return ok({});
      case 'adminSetBranches':
        var bl = Array.isArray(p.branches) ? p.branches.map(function (b) { return String(b).trim(); }) : [];
        var seen = {};
        var valid = bl.length >= 1 && bl.length <= 20 && bl.every(function (b) { if (!b || b.length > 20 || seen[b]) return false; seen[b] = true; return true; });
        if (!valid) return fail(MSG.BAD_BRANCHES);
        s.branches = bl;
        saveStore(s);
        return overview(s);
      default:
        return fail('요청이 올바르지 않습니다.');
    }
  }

  /*
   * 관리자 화면 시연용 샘플 응답 n건을 진행 중 회차에 만든다(정의에 맞춰 무작위, 모두 검증 통과).
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

  // 어떤 정의든 그 정의에 맞는 무작위 응답을 만든다
  function sampleAnswers(def, logic) {
    var a = {};
    def.questions.forEach(function (q) {
      if (!logic.isVisible(q, a)) return;
      if (q.type === 'single') {
        a[q.id] = pick(q.options).value;
      } else if (q.type === 'scale') {
        a[q.id] = rnd(q.min, q.max);
      } else if (q.type === 'grid') {
        a[q.id] = q.items.map(function () { return q.na && Math.random() < 0.08 ? q.na.value : rnd(q.min, q.max); });
      } else if (q.type === 'multi') {
        var ex = q.options.filter(function (o) { return o.exclusive; });
        if (ex.length && Math.random() < 0.1) a[q.id] = [ex[0].value];
        else {
          var pool = q.options.filter(function (o) { return !o.exclusive; }).map(function (o) { return o.value; });
          var k = rnd(1, Math.min(q.maxSelect, pool.length));
          var out = [];
          while (out.length < k) { var v = pick(pool); if (out.indexOf(v) === -1) out.push(v); }
          a[q.id] = out;
        }
      } else if (q.type === 'text') {
        a[q.id] = Math.random() < 0.4 ? pick(SAMPLE_TEXTS) : '';
      }
      var etc = logic.etcOption(q);
      if (etc && logic.isSelected(q, a, etc.value)) a[logic.etcKey(q)] = '샘플 기타 응답';
    });
    return a;
  }

  function seedSamples(n) {
    var s = store();
    var r = active(s);
    if (!r) return 0;
    var def = s.defs[r.id];
    var logic = createSurveyLogic(def);
    var all = responses();
    var list = roster();
    var dates = ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'];
    var made = 0;
    for (var i = 0; i < n; i++) {
      var v = logic.validateAnswers(sampleAnswers(def, logic));
      if (!v.ok) continue;
      all.splice(Math.floor(Math.random() * (all.length + 1)), 0, { round: r.id, id: randomId(12), date: pick(dates), answers: v.data });
      list.push({ branch: pick(s.branches), name: '샘플' + (list.length + 1), status: '완료', resets: 0 });
      made++;
    }
    write(KEY_RESPONSES, all);
    write(KEY_ROSTER, list);
    return made;
  }

  function hint() {
    return SEED_ROSTER.map(function (r) { return r.name + '(' + r.branch + ')'; }).join(', ');
  }

  return {
    status: status, start: start, submit: submit, reset: reset, hint: hint, admin: admin, seedSamples: seedSamples,
    ADMIN_PASSWORD: MOCK_ADMIN_PASSWORD, EDIT_PASSWORD: MOCK_EDIT_PASSWORD
  };
})();
