/*
 * 관리자 화면 진행 — 로그인, 데이터 불러오기, 탭, 초기화, 응답 받기 전환, 엑셀 다운로드.
 * 관리자 토큰은 sessionStorage에만 둔다(창을 닫으면 사라짐, 서버에서 6시간 뒤 만료).
 */
(function () {
  var TOKEN_KEY = 'hstc_admin_token';
  var TAB_KEY = 'hstc_admin_tab';
  // 엑셀 생성 라이브러리(SheetJS) — 다운로드할 때만 불러온다. 무결성 해시(SRI)로 변조를 막는다.
  var XLSX_SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  var XLSX_SRI = 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT';
  var SESSION_ERROR = '로그인이 만료되었습니다. 다시 로그인해 주세요.';

  var root = document.getElementById('admin');

  var state = {
    screen: 'login',
    token: null,
    password: '',
    loginError: '',
    busy: false,
    tab: 'overview',
    role: 'all',
    overview: null,
    columns: null,
    rows: null,
    responses: null,
    roster: null,
    rosterFilter: { branch: '', status: '', q: '' },
    resetting: null,
    toggling: false,
    excelBusy: false,
    error: ''
  };

  function store(key, val) {
    try {
      if (val === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, val);
    } catch (e) { /* 무시 */ }
  }
  function load(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function render() {
    var active = document.activeElement;
    var focusKey = active && active.getAttribute ? active.getAttribute('data-focus') : null;
    var caret = focusKey && active.selectionStart;
    var y = window.scrollY;
    root.replaceChildren(state.screen === 'login' ? AdminViews.login(state, act) : AdminViews.app(state, act));
    if (focusKey) {
      var el = root.querySelector('[data-focus="' + focusKey + '"]');
      if (el) { el.focus(); if (typeof caret === 'number') el.setSelectionRange(caret, caret); }
    }
    window.scrollTo(0, y);
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  // 관리자 API 호출. 세션이 끝났으면 로그인 화면으로 돌아간다.
  function call(action, payload) {
    return Api.admin(action, Object.assign({ token: state.token }, payload || {})).then(function (res) {
      if (!res.ok && res.error === SESSION_ERROR) {
        toLogin(SESSION_ERROR);
        return null;
      }
      return res;
    });
  }

  function toLogin(msg) {
    store(TOKEN_KEY, null);
    state.token = null;
    state.screen = 'login';
    state.loginError = msg || '';
    state.overview = state.rows = state.responses = state.roster = null;
    render();
  }

  /* ── 데이터 ── */
  function loadOverview() {
    return call('adminOverview').then(function (res) {
      if (!res) return;
      if (res.ok) state.overview = res.data; else state.error = res.error;
    });
  }

  function loadResponses() {
    return call('adminResponses').then(function (res) {
      if (!res) return;
      if (!res.ok) { state.error = res.error; return; }
      if (res.data.version !== SURVEY_DEF.version) state.error = '서버와 화면의 문항 버전이 다릅니다. 새로고침해 주세요.';
      state.columns = res.data.columns;
      state.rows = res.data.rows;
      state.responses = SurveyStats.parseRows(res.data.columns, res.data.rows);
    });
  }

  function loadRoster() {
    return call('adminRoster').then(function (res) {
      if (!res) return;
      if (res.ok) state.roster = res.data.list; else state.error = res.error;
    });
  }

  function loadAll() {
    state.error = '';
    state.overview = state.responses = null;
    if (state.tab === 'roster') state.roster = null;
    render();
    var jobs = [loadOverview(), loadResponses()];
    if (state.tab === 'roster' || state.roster) jobs.push(loadRoster());
    return Promise.all(jobs).then(function () { if (state.screen === 'app') render(); });
  }

  /* ── 엑셀 ── */
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = XLSX_SRC;
      s.integrity = XLSX_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = function () { resolve(window.XLSX); };
      s.onerror = function () { reject(new Error('XLSX')); };
      document.head.appendChild(s);
    });
  }

  // 숫자 코드 열(단일 선택·척도·Q4)은 엑셀에서 계산할 수 있게 숫자로 넣는다.
  function numericColumns() {
    var set = {};
    SURVEY_DEF.questions.forEach(function (q) {
      if (q.type === 'single' || q.type === 'scale') set[q.id] = true;
      if (q.type === 'grid') q.items.forEach(function (_, i) { set[q.id + '_' + (i + 1)] = true; });
    });
    return set;
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  /* ── 동작 ── */
  var act = {
    setPassword: function (v) { state.password = v; },

    login: function () {
      if (state.busy) return;
      if (!state.password) { state.loginError = '비밀번호를 입력해 주세요.'; return render(); }
      state.busy = true;
      state.loginError = '';
      render();
      Api.admin('adminLogin', { password: state.password }).then(function (res) {
        state.busy = false;
        state.password = '';
        if (!res.ok) { state.loginError = res.error; return render(); }
        state.token = res.data.token;
        store(TOKEN_KEY, state.token);
        state.screen = 'app';
        loadAll();
      });
    },

    logout: function () {
      if (state.token) Api.admin('adminLogout', { token: state.token });
      toLogin('');
    },

    refresh: function () { loadAll().then(function () { toast('새로 불러왔습니다.'); }); },

    setTab: function (k) {
      state.tab = k;
      store(TAB_KEY, k);
      render();
      if (k === 'roster' && !state.roster) loadRoster().then(render);
    },

    setRole: function (k) { state.role = k; render(); },

    setRosterFilter: function (key, v) { state.rosterFilter[key] = v; render(); },

    reset: function (r) {
      var msg = r.branch + ' ' + r.name + ' 님을 "미참여"로 되돌릴까요?\n\n이전 응답은 삭제되지 않아 다시 응답하면 2건이 남습니다';
      if (!window.confirm(msg)) return;
      state.resetting = r.row;
      render();
      call('adminReset', { row: r.row, branch: r.branch, name: r.name }).then(function (res) {
        state.resetting = null;
        if (!res) return;
        if (!res.ok) { state.error = res.error; render(); return; }
        r.status = res.data.status;
        r.resets = res.data.resets;
        toast(r.name + ' 님을 미참여로 되돌렸습니다.');
        loadOverview().then(render);
      });
    },

    toggleAccepting: function () {
      var st = state.overview.settings;
      var on = !st.accepting;
      var msg = on ? '응답 받기를 켤까요? 설문 기간 안이면 직원들이 바로 응답할 수 있습니다.' : '응답 받기를 끌까요? 응답 중인 직원도 제출할 수 없게 됩니다.';
      if (!window.confirm(msg)) return;
      state.toggling = true;
      render();
      call('adminSetAccepting', { accepting: on }).then(function (res) {
        state.toggling = false;
        if (!res) return;
        if (!res.ok) { state.error = res.error; render(); return; }
        state.error = '';
        state.overview = res.data;
        render();
        toast(on ? '응답 받기를 켰습니다.' : '응답 받기를 껐습니다.');
      });
    },

    downloadExcel: function () {
      if (state.excelBusy || !state.rows) return;
      state.excelBusy = true;
      render();
      loadXlsx().then(function (XLSX) {
        var num = numericColumns();
        var data = [state.columns].concat(state.rows.map(function (r) {
          return r.map(function (v, i) { return num[state.columns[i]] && /^\d+$/.test(v) ? Number(v) : v; });
        }));
        var wb = XLSX.utils.book_new();
        var ws1 = XLSX.utils.aoa_to_sheet(data);
        ws1['!cols'] = state.columns.map(function (c) { return { wch: /^Q1[234]$|_etc$/.test(c) ? 40 : Math.max(8, c.length + 2) }; });
        XLSX.utils.book_append_sheet(wb, ws1, '응답 원본');
        var ws2 = XLSX.utils.aoa_to_sheet(SurveyLogic.codeTableRows());
        ws2['!cols'] = [{ wch: 10 }, { wch: 60 }, { wch: 10 }, { wch: 40 }];
        XLSX.utils.book_append_sheet(wb, ws2, '문항 코드표');
        XLSX.writeFile(wb, 'HSTC_업무환경설문_응답_' + stamp() + '.xlsx');
        state.excelBusy = false;
        render();
      }).catch(function () {
        state.excelBusy = false;
        state.error = '엑셀 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
        render();
      });
    },

    seedSamples: function () {
      MockServer.seedSamples(20);
      loadAll().then(function () { toast('샘플 응답 20건을 추가했습니다.'); });
    }
  };

  /* ── 시작 ── */
  var saved = load(TOKEN_KEY);
  var tab = load(TAB_KEY);
  if (tab && AdminViews.TABS.some(function (t) { return t.key === tab; })) state.tab = tab;
  if (saved) {
    state.token = saved;
    state.screen = 'app';
    loadAll();
  } else {
    render();
  }
})();
