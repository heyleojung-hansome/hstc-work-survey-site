/*
 * 관리자 [설문 편집] — 상태와 동작. 화면 그리기는 editor-views.js.
 *
 * - 편집 비밀번호로 받은 편집 토큰(2시간)은 sessionStorage에만 둔다.
 * - 초안(draft)은 회차 정의의 복사본이다. 글자 입력은 다시 그리지 않고 초안만 바꾸고,
 *   문항·선택지 추가·삭제·이동처럼 구조가 바뀌면 다시 그린다.
 * - 구조가 바뀌면 문항 번호를 Q1부터 다시 매기고, 건너뛰기 조건·분석 설정의 참조도 함께 고친다.
 * - 잠금: full(모두) / wording(문구만 — 응답이 들어온 진행 회차) / none(읽기 전용 — 종료 회차)
 */
var AdminEditor = (function () {
  var EDIT_KEY = 'hstc_admin_edit';
  var PREVIEW_KEY = 'hstc_preview_def';

  var TYPE_LABELS = { single: '단일 선택', multi: '복수 선택', scale: '점수(척도)', grid: '항목별 점수', text: '주관식' };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function newState() {
    var token = null;
    try { token = sessionStorage.getItem(EDIT_KEY); } catch (e) { /* 무시 */ }
    return {
      editToken: token, unlockPw: '', unlockError: '', busy: false,
      view: 'list', rounds: null, activeRoundId: '', listError: '',
      roundId: '', round: null, lock: 'full', responseCount: 0,
      draft: null, meta: null, baseVersion: '', dirty: false,
      errors: [], saveError: '', openQ: 0, branchesText: null
    };
  }

  // 새 문항·형식 바꿀 때의 기본값
  function typeDefaults(type) {
    switch (type) {
      case 'single': return { options: [{ value: 1, label: '선택지 1' }, { value: 2, label: '선택지 2' }] };
      case 'multi': return { options: [{ value: 1, label: '선택지 1' }, { value: 2, label: '선택지 2' }, { value: 3, label: '선택지 3' }], maxSelect: 2 };
      case 'scale': return { min: 1, max: 5, scaleLabels: { 1: '전혀 그렇지 않다', 5: '매우 그렇다' } };
      case 'grid': return { items: ['항목 1', '항목 2'], min: 1, max: 5, scaleLabels: { 1: '낮음', 5: '높음' }, na: { value: 0, label: '해당 없음' } };
      default: return {};
    }
  }
  var TYPE_FIELDS = ['options', 'maxSelect', 'min', 'max', 'scaleLabels', 'items', 'na', 'guide', 'examples'];

  /*
   * 오류 경로를 사람이 읽는 위치로: 'questions.2.options.1.label' → 'Q3 · 선택지 2 · 글자'
   */
  function describePath(path, draft) {
    var p = String(path || '').split('.');
    if (!p[0]) return '설문 전체';
    var names = { title: '설문 제목', textMaxLength: '주관식 글자 수 한도', sections: '섹션', analysis: '분석 설정', texts: '안내문' };
    if (p[0] === 'questions' && p.length > 1) {
      var q = draft && draft.questions[Number(p[1])];
      var label = (q && q.id ? q.id : '문항 ' + (Number(p[1]) + 1));
      var parts = [label];
      var field = { title: '질문 문구', type: '형식', section: '섹션', required: '필수 여부', options: '선택지', maxSelect: '최대 선택 수',
        min: '점수 범위', scaleLabels: '점수 라벨', items: '항목', na: '해당 없음', showIf: '건너뛰기 조건', guide: '안내', examples: '예시', id: '문항 번호' }[p[2]];
      if (field) parts.push(field);
      if (p[3] !== undefined && /^\d+$/.test(p[3])) parts.push((Number(p[3]) + 1) + '번째');
      if (p[4] === 'label') parts.push('글자');
      return parts.join(' · ');
    }
    if (p[0] === 'texts') {
      if (p[1] === 'done') return '완료 문구';
      var sub = { greeting: '인사 문단', items: '안내 항목', closing: '맺음말' }[p[2]];
      return '안내문 · ' + (sub || '') + (p[3] !== undefined ? ' ' + (Number(p[3]) + 1) + '번째' : '') + (p[4] === 'label' ? ' 제목' : p[4] === 'text' ? ' 내용' : '');
    }
    return names[p[0]] ? names[p[0]] + (p[1] ? ' · ' + p[1] : '') : path;
  }

  function questionErrorCount(errors, index) {
    var prefix = 'questions.' + index + '.';
    return errors.filter(function (e) { return e.path === 'questions.' + index || e.path.indexOf(prefix) === 0; }).length;
  }

  /*
   * 동작 만들기. ctx = { state, render, call(action, payload), toast }
   * state.ed 가 편집기 상태다.
   */
  function createActions(ctx) {
    function ed() { return ctx.state.ed; }
    function render() { ctx.render(); }

    function editCall(action, payload) {
      return ctx.call(action, Object.assign({ editToken: ed().editToken }, payload || {})).then(function (res) {
        if (res && !res.ok && /편집 권한이 만료/.test(res.error)) {
          lockEditor(res.error);
          return null;
        }
        return res;
      });
    }

    function lockEditor(msg) {
      var e = ed();
      try { sessionStorage.removeItem(EDIT_KEY); } catch (er) { /* 무시 */ }
      e.editToken = null;
      e.unlockError = msg || '';
      e.view = 'list';
      render();
    }

    function markDirty() { ed().dirty = true; }

    // 구조가 바뀐 뒤: 문항 번호 다시 매기기 + 참조 고치기
    function renumber() {
      var d = ed().draft;
      var map = {};
      d.questions.forEach(function (q, i) { map[q.id] = 'Q' + (i + 1); });
      d.questions.forEach(function (q) {
        q.id = map[q.id];
        if (q.showIf && map[q.showIf.question]) q.showIf.question = map[q.showIf.question];
      });
      // 건너뛰기 조건은 앞 문항만 가리킬 수 있다 — 뒤로 가 버린 조건은 지운다
      d.questions.forEach(function (q, i) {
        if (!q.showIf) return;
        var srcIndex = d.questions.findIndex(function (x) { return x.id === q.showIf.question; });
        if (srcIndex === -1 || srcIndex >= i) delete q.showIf;
      });
      var a = d.analysis || (d.analysis = {});
      if (a.groupBy) a.groupBy = map[a.groupBy] || '';
      if (Array.isArray(a.crosstabs)) {
        a.crosstabs = a.crosstabs.map(function (pair) { return [map[pair[0]] || '', map[pair[1]] || '']; })
          .filter(function (pair) { return pair[0] && pair[1]; });
      }
    }

    function structural(fn) {
      if (ed().lock !== 'full') return;
      fn(ed().draft);
      renumber();
      markDirty();
      validateLocal();
      render();
    }

    function validateLocal() {
      var r = SurveyDefCheck.validate(ed().draft);
      ed().errors = r.ok ? [] : r.errors;
      return r.ok;
    }

    function nextValue(list) {
      return list.reduce(function (m, o) { return Math.max(m, o.value); }, 0) + 1;
    }

    function move(arr, i, d) {
      var j = i + d;
      if (j < 0 || j >= arr.length) return;
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }

    function openRound(id) {
      var e = ed();
      e.busy = true;
      render();
      return ctx.call('adminRoundGet', { roundId: id }).then(function (res) {
        e.busy = false;
        if (!res) return;
        if (!res.ok) { e.listError = res.error; return render(); }
        loadRound(res.data);
        e.view = 'edit';
        e.openQ = 0;
        render();
        window.scrollTo(0, 0);
      });
    }

    function loadRound(data) {
      var e = ed();
      e.roundId = data.round.id;
      e.round = data.round;
      e.lock = data.lock;
      e.responseCount = data.responseCount || 0;
      e.draft = clone(data.definition);
      if (!e.draft.analysis) e.draft.analysis = {};
      e.meta = { startDate: data.round.startDate || '', endDate: data.round.endDate || '', shareMonth: data.round.shareMonth || '' };
      e.baseVersion = data.definition.version;
      e.dirty = false;
      e.errors = [];
      e.saveError = '';
      validateLocal();
    }

    function loadRounds() {
      var e = ed();
      return ctx.call('adminRounds').then(function (res) {
        if (!res) return;
        if (!res.ok) { e.listError = res.error; return render(); }
        e.rounds = res.data.rounds;
        e.activeRoundId = res.data.activeRoundId;
        e.listError = '';
        render();
      });
    }

    var act = {
      TYPE_LABELS: TYPE_LABELS,
      describePath: describePath,
      questionErrorCount: questionErrorCount,

      enter: function () {
        var e = ed();
        if (e.editToken && !e.rounds) loadRounds();
      },

      setUnlockPw: function (v) { ed().unlockPw = v; },

      unlock: function () {
        var e = ed();
        if (e.busy) return;
        if (!e.unlockPw) { e.unlockError = '편집 비밀번호를 입력해 주세요.'; return render(); }
        e.busy = true;
        e.unlockError = '';
        render();
        ctx.call('adminEditUnlock', { password: e.unlockPw }).then(function (res) {
          e.busy = false;
          e.unlockPw = '';
          if (!res) return;
          if (!res.ok) { e.unlockError = res.error; return render(); }
          e.editToken = res.data.editToken;
          try { sessionStorage.setItem(EDIT_KEY, e.editToken); } catch (er) { /* 무시 */ }
          render();
          loadRounds();
        });
      },

      lockEditor: lockEditor,
      refreshList: loadRounds,
      openRound: openRound,

      backToList: function () {
        var e = ed();
        if (e.dirty && !window.confirm('저장하지 않은 변경이 있습니다. 버리고 목록으로 갈까요?')) return;
        e.view = 'list';
        e.dirty = false;
        render();
        loadRounds();
      },

      newRound: function (mode, sourceId) {
        var e = ed();
        var label = { blank: '빈 설문', template: '기본 템플릿(업무환경 설문)', copy: sourceId + ' 복제' }[mode];
        if (!window.confirm(label + '으로 새 회차를 만들까요? "작성중" 상태로 만들어지고, 진행을 시작하기 전까지 직원에게 보이지 않습니다.')) return;
        editCall('adminRoundCreate', { mode: mode, sourceId: sourceId }).then(function (res) {
          if (!res) return;
          if (!res.ok) { e.listError = res.error; return render(); }
          ctx.toast(res.data.round.id + ' 회차를 만들었습니다.');
          loadRound({ round: res.data.round, definition: res.data.definition, lock: 'full', responseCount: 0 });
          e.view = 'edit';
          e.openQ = 0;
          render();
          window.scrollTo(0, 0);
        });
      },

      startRound: function (r) {
        var msg = r.id + ' "' + r.title + '"의 진행을 시작할까요?\n\n' +
          '· 참여자명부의 참여 상태·초기화 횟수가 모두 비워집니다.\n' +
          '· 응답 받기는 꺼진 상태로 시작합니다. [설문 설정]에서 켜야 직원이 응답할 수 있습니다.\n' +
          '· 응답이 한 건이라도 들어오면 문구만 고칠 수 있습니다.';
        if (!window.confirm(msg)) return;
        editCall('adminRoundStart', { roundId: r.id }).then(function (res) {
          if (!res) return;
          if (!res.ok) { ed().listError = res.error + (res.details ? ' (' + res.details.length + '곳)' : ''); return render(); }
          ctx.toast(r.id + ' 진행을 시작했습니다. 응답 받기는 [설문 설정]에서 켜 주세요.');
          loadRounds();
          ctx.reloadOverview();
        });
      },

      closeRound: function (r) {
        var msg = r.id + ' "' + r.title + '"을 종료할까요?\n\n' +
          '· 더 이상 응답을 받지 않습니다.\n· 소속별 참여 숫자만 남기고, 누가 참여했는지는 남기지 않습니다.\n· 종료한 회차는 고칠 수 없습니다(복제는 가능).';
        if (!window.confirm(msg)) return;
        editCall('adminRoundClose', { roundId: r.id }).then(function (res) {
          if (!res) return;
          if (!res.ok) { ed().listError = res.error; return render(); }
          ctx.toast(r.id + ' 회차를 종료했습니다.');
          loadRounds();
          ctx.reloadOverview();
        });
      },

      deleteRound: function (r) {
        if (!window.confirm(r.id + ' "' + r.title + '"(작성중)을 삭제할까요? 되돌릴 수 없습니다.')) return;
        editCall('adminRoundDelete', { roundId: r.id }).then(function (res) {
          if (!res) return;
          if (!res.ok) { ed().listError = res.error; return render(); }
          ctx.toast(r.id + ' 회차를 삭제했습니다.');
          loadRounds();
        });
      },

      /* ── 글자 입력(다시 그리지 않음) ── */
      setText: function (obj, key, value) {
        obj[key] = value;
        markDirty();
      },
      setMeta: function (key, value) {
        ed().meta[key] = value;
        markDirty();
      },
      setNumber: function (obj, key, value) {
        if (ed().lock !== 'full') return;
        var n = Number(value);
        obj[key] = value === '' || !isFinite(n) ? value : n;
        markDirty();
      },

      /* ── 구조 변경(다시 그림) ── */
      toggleOpen: function (i) {
        var e = ed();
        e.openQ = e.openQ === i ? -1 : i;
        render();
      },
      addQuestion: function (type) {
        structural(function (d) {
          var section = Object.keys(d.sections)[0];
          var q = Object.assign({ id: 'Q' + (d.questions.length + 1), section: section, type: type, required: type !== 'text', title: '새 질문' }, clone(typeDefaults(type)));
          d.questions.push(q);
          ed().openQ = d.questions.length - 1;
        });
      },
      removeQuestion: function (i) {
        var q = ed().draft.questions[i];
        if (!window.confirm(q.id + ' "' + q.title + '" 문항을 삭제할까요?')) return;
        structural(function (d) {
          d.questions.splice(i, 1);
          ed().openQ = -1;
        });
      },
      moveQuestion: function (i, delta) {
        structural(function (d) {
          move(d.questions, i, delta);
          if (ed().openQ === i) ed().openQ = i + delta;
        });
      },
      changeType: function (i, type) {
        var q = ed().draft.questions[i];
        if (q.type === type) return;
        if ((q.options || q.items) && !window.confirm('형식을 바꾸면 이 문항의 선택지·항목 설정이 초기화됩니다. 바꿀까요?')) return render();
        structural(function () {
          TYPE_FIELDS.forEach(function (f) { delete q[f]; });
          q.type = type;
          if (type === 'text') q.required = false;
          Object.assign(q, clone(typeDefaults(type)));
        });
      },
      setRequired: function (i, on) {
        structural(function (d) { d.questions[i].required = on; });
      },
      setSection: function (i, key) {
        ed().draft.questions[i].section = key;
        markDirty();
        validateLocal();
        render();
      },
      addOption: function (i) {
        structural(function (d) {
          var q = d.questions[i];
          q.options.push({ value: nextValue(q.options), label: '선택지 ' + (q.options.length + 1) });
        });
      },
      removeOption: function (i, j) {
        structural(function (d) {
          var q = d.questions[i];
          var removed = q.options.splice(j, 1)[0];
          // 이 선택지를 조건으로 쓰던 건너뛰기는 지운다
          d.questions.forEach(function (x) {
            if (x.showIf && x.showIf.question === q.id && (x.showIf.notEquals === removed.value || x.showIf.equals === removed.value)) delete x.showIf;
          });
          if (q.maxSelect && q.maxSelect > q.options.length) q.maxSelect = q.options.length;
        });
      },
      moveOption: function (i, j, delta) {
        structural(function (d) { move(d.questions[i].options, j, delta); });
      },
      toggleFlag: function (i, j, flag) {
        structural(function (d) {
          var q = d.questions[i];
          var o = q.options[j];
          var on = !o[flag];
          if (flag === 'etc' && on) q.options.forEach(function (x) { delete x.etc; }); // 기타는 하나만
          if (on) o[flag] = true; else delete o[flag];
          if (flag === 'etc' && on) delete o.exclusive;
          if (flag === 'exclusive' && on) delete o.etc;
        });
      },
      setMaxSelect: function (i, v) {
        structural(function (d) { d.questions[i].maxSelect = Number(v); });
      },
      setRange: function (i, key, v) {
        structural(function (d) {
          var q = d.questions[i];
          q[key] = Number(v);
          // 범위 밖이 된 라벨은 지운다
          Object.keys(q.scaleLabels || {}).forEach(function (k) { if (Number(k) < q.min || Number(k) > q.max) delete q.scaleLabels[k]; });
        });
      },
      setScaleLabel: function (q, point, value) {
        q.scaleLabels = q.scaleLabels || {};
        if (value) q.scaleLabels[point] = value; else delete q.scaleLabels[point];
        markDirty();
      },
      addItem: function (i) {
        structural(function (d) { d.questions[i].items.push('항목 ' + (d.questions[i].items.length + 1)); });
      },
      removeItem: function (i, j) {
        structural(function (d) { d.questions[i].items.splice(j, 1); });
      },
      moveItem: function (i, j, delta) {
        // 항목 순서는 응답 열 순서라 구조 변경이다
        structural(function (d) { move(d.questions[i].items, j, delta); });
      },
      setItem: function (q, j, value) {
        q.items[j] = value;
        markDirty();
      },
      toggleNa: function (i) {
        structural(function (d) {
          var q = d.questions[i];
          if (q.na) delete q.na;
          else q.na = { value: q.min > 0 ? 0 : q.max + 1, label: '해당 없음' };
        });
      },
      setShowIf: function (i, srcId, value) {
        structural(function (d) {
          var q = d.questions[i];
          if (!srcId) { delete q.showIf; return; }
          var src = d.questions.find(function (x) { return x.id === srcId; });
          var v = Number(value) || (src && src.options && src.options[src.options.length - 1].value);
          q.showIf = { question: srcId, notEquals: v };
        });
      },
      addExample: function (q) {
        if (ed().lock === 'none') return;
        q.examples = q.examples || [];
        q.examples.push('');
        markDirty();
        render();
      },
      removeExample: function (q, j) {
        if (ed().lock === 'none') return;
        q.examples.splice(j, 1);
        if (!q.examples.length) delete q.examples;
        markDirty();
        render();
      },

      /* ── 안내문·섹션 (구조 서명에 들지 않아 '문구만' 잠금에서도 바꿀 수 있음) ── */
      listAdd: function (arr, value) {
        if (ed().lock === 'none') return;
        arr.push(value);
        markDirty();
        validateLocal();
        render();
      },
      listRemove: function (arr, j) {
        if (ed().lock === 'none') return;
        arr.splice(j, 1);
        markDirty();
        validateLocal();
        render();
      },
      listMove: function (arr, j, delta) {
        if (ed().lock === 'none') return;
        move(arr, j, delta);
        markDirty();
        render();
      },
      addSection: function () {
        if (ed().lock === 'none') return;
        var s = ed().draft.sections;
        var keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(function (k) { return !s[k]; });
        if (!keys.length) return;
        s[keys[0]] = '새 섹션';
        markDirty();
        render();
      },
      removeSection: function (key) {
        if (ed().lock === 'none') return;
        var d = ed().draft;
        if (d.questions.some(function (q) { return q.section === key; })) {
          return window.alert('이 섹션을 쓰는 문항이 있습니다. 먼저 문항의 섹션을 바꿔 주세요.');
        }
        if (Object.keys(d.sections).length <= 1) return window.alert('섹션은 하나 이상 있어야 합니다.');
        delete d.sections[key];
        markDirty();
        render();
      },
      setAnalysis: function (key, value) {
        if (ed().lock === 'none') return;
        var a = ed().draft.analysis;
        if (value === '' || value === null) delete a[key]; else a[key] = value;
        markDirty();
        validateLocal();
        render();
      },
      addCrosstab: function () {
        if (ed().lock === 'none') return;
        var a = ed().draft.analysis;
        a.crosstabs = a.crosstabs || [];
        a.crosstabs.push(['', '']);
        markDirty();
        render();
      },
      setCrosstab: function (k, side, id) {
        ed().draft.analysis.crosstabs[k][side] = id;
        markDirty();
        validateLocal();
        render();
      },
      removeCrosstab: function (k) {
        var a = ed().draft.analysis;
        a.crosstabs.splice(k, 1);
        if (!a.crosstabs.length) delete a.crosstabs;
        markDirty();
        validateLocal();
        render();
      },

      /* ── 미리보기·저장 ── */
      preview: function () {
        var e = ed();
        var branches = (ctx.state.overview && ctx.state.overview.branchList) || [];
        try {
          localStorage.setItem(PREVIEW_KEY, JSON.stringify({ definition: e.draft, meta: e.meta, branches: branches }));
        } catch (er) {
          return window.alert('미리보기를 열 수 없습니다(브라우저 저장소 사용 불가).');
        }
        window.open('index.html?preview=1' + (APP_CONFIG.MOCK ? '&mock=1' : ''), '_blank');
      },

      save: function () {
        var e = ed();
        if (e.busy || e.lock === 'none') return;
        // 빈 '건너뛰기·교차표' 줄 정리
        if (e.draft.analysis && Array.isArray(e.draft.analysis.crosstabs)) {
          e.draft.analysis.crosstabs = e.draft.analysis.crosstabs.filter(function (p) { return p[0] && p[1]; });
          if (!e.draft.analysis.crosstabs.length) delete e.draft.analysis.crosstabs;
        }
        if (!validateLocal()) {
          e.saveError = '고칠 곳이 ' + e.errors.length + '곳 있습니다. 아래 목록을 확인해 주세요.';
          render();
          window.scrollTo(0, 0);
          return;
        }
        e.busy = true;
        e.saveError = '';
        render();
        editCall('adminRoundSave', { roundId: e.roundId, baseVersion: e.baseVersion, definition: e.draft, meta: e.meta }).then(function (res) {
          e.busy = false;
          if (!res) return;
          if (!res.ok) {
            e.saveError = res.error;
            if (res.details) e.errors = res.details;
            render();
            window.scrollTo(0, 0);
            return;
          }
          loadRound({ round: res.data.round, definition: res.data.definition, lock: res.data.lock, responseCount: e.responseCount });
          render();
          ctx.toast('저장했습니다 (' + res.data.definition.version + ').');
          if (e.round.status === '진행') ctx.reloadOverview();
        });
      },

      reload: function () {
        var e = ed();
        if (e.dirty && !window.confirm('저장하지 않은 변경을 버리고 다시 불러올까요?')) return;
        openRound(e.roundId);
      },

      /* ── 소속 목록 ── */
      setBranchesText: function (v) { ed().branchesText = v; },
      saveBranches: function () {
        var e = ed();
        var list = String(e.branchesText || '').split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (!window.confirm('소속 목록을 "' + list.join(', ') + '"로 바꿀까요?\n설문 첫 화면의 소속 선택과 시트의 소속 목록이 바뀝니다.')) return;
        editCall('adminSetBranches', { branches: list }).then(function (res) {
          if (!res) return;
          if (!res.ok) { e.listError = res.error; return render(); }
          ctx.state.overview = res.data;
          e.branchesText = null;
          ctx.toast('소속 목록을 바꿨습니다.');
          render();
        });
      }
    };
    return act;
  }

  return { newState: newState, createActions: createActions, TYPE_LABELS: TYPE_LABELS, describePath: describePath };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AdminEditor;
