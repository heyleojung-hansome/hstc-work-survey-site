/*
 * 설문 화면 진행 — 상태 관리, 화면 전환, 키보드 조작, 임시 저장.
 *
 * 임시 저장(sessionStorage): 새로고침해도 진행 내용이 남도록 토큰·응답·현재 단계만 저장한다.
 * 이름은 저장하지 않는다. 제출에 성공하면 바로 지운다. 회차·정의 버전이 바뀌면 임시 저장은 버린다.
 *
 * 문항은 서버가 내려주는 진행 중 회차의 정의(status.definition)로 그린다(state.def, state.logic).
 * 미리보기(?preview=1): 편집기가 localStorage에 넣어 둔 초안으로 그리고, 서버에 아무것도 보내지 않는다.
 */
(function () {
  var STORE_KEY = 'hstc_survey_progress';
  var PREVIEW_KEY = 'hstc_preview_def';   // 편집기 미리보기 초안 (문항만, 개인 정보 없음)
  var PREVIEW = new URLSearchParams(location.search).get('preview') === '1';
  var AUTO_ADVANCE_MS = 260;   // 단일 선택 후 다음으로 넘어가기까지
  var TWO_DIGIT_WAIT_MS = 450; // 선택지가 10개 이상일 때 두 자리 숫자 입력 대기

  var root = document.getElementById('app');

  var state = {
    screen: 'loading',   // loading | start | closed | error | question | confirm | done
    status: null,
    def: null,           // 진행 중 회차(또는 미리보기 초안)의 설문 정의
    logic: null,         // createSurveyLogic(def)
    roundId: '',
    branches: [],
    preview: PREVIEW,
    token: null,
    answers: {},
    steps: [],
    stepIndex: 0,
    branch: '',
    name: '',            // 메모리에만 둔다
    startError: '',
    submitError: '',
    loadError: '',
    flash: '',
    busy: false,
    anim: ''
  };

  var advanceTimer = null;
  var digitBuffer = '';
  var digitTimer = null;

  /* ── 임시 저장 ── */
  function save() {
    if (state.screen !== 'question' && state.screen !== 'confirm') return;
    if (state.preview) return; // 미리보기는 저장하지 않는다
    var data = {
      round: state.roundId,
      v: state.def.version,
      token: state.token,
      answers: state.answers,
      stepKey: state.screen === 'confirm' ? '__confirm' : currentStep().key
    };
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* 저장 불가 환경은 무시 */ }
  }

  function load() {
    try {
      var data = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      if (data && data.round === state.roundId && data.v === state.def.version && data.answers) return data;
    } catch (e) { /* 무시 */ }
    return null;
  }

  function clearSaved() {
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ }
  }

  /* ── 단계 ── */
  function refreshSteps() {
    var key = state.steps.length ? currentStep().key : null;
    state.steps = state.logic.buildSteps(state.answers);
    if (key) {
      var i = indexOfKey(key);
      if (i !== -1) state.stepIndex = i;
    }
  }

  function indexOfKey(key) {
    for (var i = 0; i < state.steps.length; i++) if (state.steps[i].key === key) return i;
    return -1;
  }

  function currentStep() { return state.steps[state.stepIndex]; }
  function currentQuestion() { return state.logic.findQuestion(currentStep().qid); }

  // 처음으로 답이 안 된 단계. 모두 답했으면 -1.
  function firstUnanswered() {
    for (var i = 0; i < state.steps.length; i++) {
      var q = state.logic.findQuestion(state.steps[i].qid);
      if (!q.required) continue;
      if (state.logic.checkStep(state.steps[i], state.answers) !== null) return i;
    }
    return -1;
  }

  /* ── 그리기 ── */
  function render(anim, focusKey) {
    state.anim = anim || '';
    var view = Views[state.screen] || Views.loading;
    var node = view(state, act);
    root.replaceChildren(node);
    if (focusKey) {
      var el = root.querySelector('[data-focus="' + focusKey + '"]');
      if (el) el.focus({ preventScroll: true });
    } else if (anim !== null) {
      // 화면이 바뀌면 제목으로 초점을 옮겨 화면 읽기 프로그램이 새 문항을 읽게 한다.
      var title = root.querySelector('#q-title');
      if (title) title.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  // 같은 화면에서 선택만 바뀐 경우: 전환 효과 없이 다시 그리고 초점을 유지한다.
  function rerender() {
    var active = document.activeElement;
    var key = active && active.getAttribute ? active.getAttribute('data-focus') : null;
    var y = window.scrollY;
    render(null, key);
    window.scrollTo(0, y);
  }

  function goTo(screen, anim) {
    clearTimeout(advanceTimer);
    state.screen = screen;
    state.flash = '';
    render(anim || 'fade');
    save();
  }

  function goStep(index, dir) {
    clearTimeout(advanceTimer);
    state.stepIndex = index;
    state.flash = '';
    state.screen = 'question';
    render(dir === 'back' ? 'from-left' : 'from-right');
    save();
  }

  /* ── 동작 ── */
  var act = {
    setBranch: function (b) {
      state.branch = b;
      state.startError = '';
      rerender();
    },

    setName: function (v) {
      state.name = v;
      if (state.startError) { state.startError = ''; rerender(); }
    },

    startSurvey: function () {
      if (state.busy) return;
      if (state.preview) {
        state.token = 'preview';
        state.steps = state.logic.buildSteps(state.answers);
        return goStep(0, 'forward');
      }
      var name = state.logic.normalizeName(state.name);
      if (!state.branch) { state.startError = '소속을 선택해 주세요.'; return rerender(); }
      if (!name) { state.startError = '이름을 입력해 주세요.'; return rerender(); }
      state.busy = true;
      state.startError = '';
      rerender();
      Api.start(state.branch, name).then(function (res) {
        state.busy = false;
        if (!res.ok) { state.startError = res.error; return rerender(); }
        state.token = res.data.token;
        state.name = '';
        // 이전에 작성하던 응답이 있으면 이어서(토큰 만료 후 다시 시작한 경우 등)
        state.steps = state.logic.buildSteps(state.answers);
        var next = firstUnanswered();
        if (next === -1 && Object.keys(state.answers).length) return goTo('confirm');
        goStep(next === -1 ? 0 : next, 'forward');
      });
    },

    // 선택지·척도·Q4 점수 고르기
    choose: function (value) {
      var step = currentStep();
      var q = currentQuestion();
      state.flash = '';

      if (q.type === 'multi') {
        var r = state.logic.toggleMulti(q, state.answers[q.id], value);
        if (r.error) { state.flash = r.error; return rerender(); }
        state.answers[q.id] = r.values;
        save();
        rerender();
        var etc = state.logic.etcOption(q);
        if (etc && value === etc.value && r.values.indexOf(value) !== -1) focusEtc();
        return;
      }

      if (q.type === 'grid') {
        var arr = Array.isArray(state.answers[q.id]) ? state.answers[q.id].slice() : new Array(q.items.length).fill(null);
        arr[step.item] = value;
        state.answers[q.id] = arr;
      } else {
        state.answers[q.id] = value;
      }
      refreshSteps(); // Q5 선택에 따라 Q6이 빠지거나 들어온다
      save();
      rerender();

      var opt = q.options ? state.logic.findOption(q, value) : null;
      if (opt && opt.etc) { focusEtc(); return; }
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(act.next, AUTO_ADVANCE_MS);
    },

    setEtc: function (v) {
      var q = currentQuestion();
      state.answers[state.logic.etcKey(q)] = v;
      if (state.flash) { state.flash = ''; rerender(); }
      save();
    },

    setText: function (v) {
      var q = currentQuestion();
      var hadText = !!(state.answers[q.id] || '').trim();
      state.answers[q.id] = v;
      save();
      // 글자 수와 [건너뛰기]↔[다음] 버튼만 갱신한다(입력란을 다시 그리지 않음).
      var max = state.def.textMaxLength;
      var cnt = document.getElementById('char-count');
      if (cnt) {
        cnt.textContent = v.length.toLocaleString() + ' / ' + max.toLocaleString();
        cnt.className = 'char-count' + (v.length > max ? ' over' : '');
      }
      if (hadText !== !!v.trim()) {
        var btn = document.getElementById('next-btn');
        if (btn) {
          btn.textContent = v.trim() ? '다음' : '건너뛰기';
          btn.className = 'btn ' + (v.trim() ? 'btn-primary' : 'btn-secondary') + ' btn-block';
        }
      }
    },

    next: function () {
      clearTimeout(advanceTimer);
      if (state.screen !== 'question') return;
      var err = state.logic.checkStep(currentStep(), state.answers);
      if (err) {
        state.flash = err;
        rerender();
        if (err.indexOf('기타') !== -1) focusEtc();
        return;
      }
      if (state.stepIndex < state.steps.length - 1) goStep(state.stepIndex + 1, 'forward');
      else { state.submitError = ''; goTo('confirm', 'from-right'); }
    },

    prev: function () {
      clearTimeout(advanceTimer);
      if (state.screen === 'confirm') return goStep(state.steps.length - 1, 'back');
      if (state.stepIndex > 0) goStep(state.stepIndex - 1, 'back');
    },

    submit: function () {
      if (state.busy) return;
      var v = state.logic.validateAnswers(state.answers);
      if (!v.ok) { state.submitError = v.error; return rerender(); }
      if (state.preview) {
        state.answers = {};
        state.screen = 'done';
        return render('fade');
      }
      state.busy = true;
      state.submitError = '';
      rerender();
      Api.submit(state.token, v.data, state.roundId, state.def.version).then(function (res) {
        state.busy = false;
        if (!res.ok) { state.submitError = res.error; return rerender(); }
        clearSaved();
        state.token = null;
        state.answers = {};
        state.screen = 'done';
        render('fade');
      });
    },

    // 토큰 만료 등으로 다시 참여 확인이 필요할 때. 작성한 응답은 유지한다.
    backToStart: function () {
      state.token = null;
      state.submitError = '';
      clearSaved();
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ round: state.roundId, v: state.def.version, token: null, answers: state.answers, stepKey: null }));
      } catch (e) { /* 무시 */ }
      state.screen = 'start';
      render('fade');
    },

    resetMock: function () {
      MockServer.reset();
      clearSaved();
      location.reload();
    },

    reload: function () { location.reload(); }
  };

  function focusEtc() {
    setTimeout(function () {
      var el = document.getElementById('etc-input');
      if (el) el.focus();
    }, 0);
  }

  /* ── 키보드 (PC): 숫자 키로 선택, Enter로 다음 ── */
  document.addEventListener('keydown', function (e) {
    if (state.screen !== 'question' || e.altKey || e.metaKey && e.key !== 'Enter' || e.ctrlKey && e.key !== 'Enter') return;
    var tag = (e.target.tagName || '').toLowerCase();
    var q = currentQuestion();

    if (e.key === 'Enter') {
      if (tag === 'textarea' && !(e.metaKey || e.ctrlKey)) return; // 주관식은 Ctrl/⌘+Enter
      if (tag === 'button' && !e.target.id) return;                 // 선택지 버튼의 Enter는 클릭으로 처리
      e.preventDefault();
      act.next();
      return;
    }
    if (tag === 'input' || tag === 'textarea') return;
    if (!/^[0-9]$/.test(e.key)) return;
    e.preventDefault();

    if (q.type === 'scale' || q.type === 'grid') {
      var n = Number(e.key);
      if (q.type === 'grid' && n === 0) return q.na ? act.choose(q.na.value) : undefined;
      if (n >= q.min && n <= q.max) act.choose(n);
      return;
    }
    if (q.type !== 'single' && q.type !== 'multi') return;

    var count = q.options.length;
    clearTimeout(digitTimer);
    digitBuffer += e.key;
    var num = Number(digitBuffer);
    // 10개 이상이면 '1' 다음에 두 번째 숫자를 잠깐 기다린다.
    var mayContinue = count >= 10 && num * 10 <= count && digitBuffer.length === 1;
    if (mayContinue) {
      digitTimer = setTimeout(function () { pickByNumber(Number(digitBuffer)); }, TWO_DIGIT_WAIT_MS);
    } else {
      pickByNumber(num);
    }
  });

  function pickByNumber(num) {
    digitBuffer = '';
    var q = currentQuestion();
    if (num >= 1 && num <= q.options.length) act.choose(q.options[num - 1].value);
  }

  /* ── 시작 ── */
  // 설문 정의를 받아 화면 상태에 넣는다
  function useDefinition(def, data) {
    state.def = def;
    state.logic = createSurveyLogic(def);
    state.roundId = data.round ? data.round.id : '';
    state.branches = data.branches || [];
    document.title = def.title + ' | HSTC 중고차사업부';
  }

  // 미리보기 초안: 편집기가 { definition, meta: { startDate, endDate, shareMonth }, branches }로 넣어 둔다
  function loadPreview() {
    try {
      var p = JSON.parse(localStorage.getItem(PREVIEW_KEY) || 'null');
      if (p && p.definition && p.definition.questions) return p;
    } catch (e) { /* 무시 */ }
    return null;
  }

  function init() {
    render('fade');
    if (state.preview) {
      var p = loadPreview();
      if (!p) {
        state.loadError = '미리볼 설문이 없습니다. 관리자 화면 [설문 편집]에서 [미리보기]를 눌러 열어 주세요.';
        state.screen = 'error';
        return render('fade');
      }
      var meta = p.meta || {};
      state.status = { state: 'open', startDate: meta.startDate || '', endDate: meta.endDate || '', shareMonth: meta.shareMonth || '' };
      useDefinition(p.definition, { round: { id: 'preview' }, branches: p.branches || [] });
      state.screen = 'start';
      return render('fade');
    }
    Api.status().then(function (res) {
      if (!res.ok) {
        state.loadError = res.error;
        state.screen = 'error';
        return render('fade');
      }
      state.status = res.data;
      if (res.data.state !== 'open' || !res.data.definition) {
        state.screen = 'closed';
        return render('fade');
      }
      useDefinition(res.data.definition, res.data);
      var saved = load();
      if (saved) {
        state.answers = saved.answers || {};
        state.steps = state.logic.buildSteps(state.answers);
        if (saved.token) {
          state.token = saved.token;
          if (saved.stepKey === '__confirm') return goTo('confirm');
          var i = indexOfKey(saved.stepKey);
          return goStep(i === -1 ? 0 : i, 'forward');
        }
      }
      state.screen = 'start';
      render('fade');
    });
  }

  init();
})();
