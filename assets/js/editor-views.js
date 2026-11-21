/*
 * 관리자 [설문 편집] 화면 그리기 — state.ed(편집기 상태)와 act(AdminEditor 동작)를 받는다.
 * 사용자 입력은 모두 textContent·value로 넣는다(innerHTML 사용 금지).
 */
var EditorViews = (function () {
  var h = Dom.h;
  var icon = Dom.icon;
  var STATUS_CLASS = { '작성중': 'draft', '진행': 'open', '종료': 'closed' };
  var LOCK_TEXT = {
    full: '모두 고칠 수 있음',
    wording: '응답이 들어와 문구만 고칠 수 있음',
    none: '종료된 회차 — 읽기 전용'
  };

  function notice(msg) {
    if (!msg) return null;
    return h('div', { class: 'notice', role: 'alert', style: { marginBottom: '14px' } }, [icon('alert', 18), h('span', { text: msg })]);
  }

  function btn(label, onclick, opts) {
    var o = opts || {};
    return h('button', {
      type: 'button', class: o.cls || 'btn-sm', onclick: onclick, disabled: !!o.disabled,
      title: o.title || null, 'aria-label': o.aria || null
    }, label);
  }

  /* ── 편집 권한 ── */
  function unlock(e, act) {
    return h('div', { class: 'card', style: { maxWidth: '460px' } }, [
      h('h3', { text: '편집 비밀번호 확인' }),
      h('p', { class: 'sub', text: '설문을 만들고 고치거나 회차를 시작·종료하려면 편집 비밀번호가 필요합니다. 결과 보기용 관리자 비밀번호와 다릅니다.' }),
      h('form', { class: 'card-body', style: { display: 'flex', flexDirection: 'column', gap: '12px' }, onsubmit: function (ev) { ev.preventDefault(); act.unlock(); } }, [
        h('input', { class: 'text-input', type: 'password', autocomplete: 'off', placeholder: '편집 비밀번호', 'aria-label': '편집 비밀번호', 'data-focus': 'edit-pw', oninput: function (ev) { act.setUnlockPw(ev.target.value); } }),
        e.unlockError ? h('div', { class: 'notice', role: 'alert' }, [icon('alert', 18), h('span', { text: e.unlockError })]) : null,
        h('button', { type: 'submit', class: 'btn btn-primary btn-md', 'aria-busy': e.busy ? 'true' : 'false' }, e.busy ? '확인 중' : '편집 시작'),
        APP_CONFIG.MOCK ? h('p', { class: 'small', text: 'MOCK 편집 비밀번호: ' + MockServer.EDIT_PASSWORD }) : null
      ])
    ]);
  }

  /* ── 회차 목록 ── */
  function roundCard(r, e, act) {
    var actions = [];
    if (r.status === '작성중') {
      actions.push(btn('편집', function () { act.openRound(r.id); }, { cls: 'btn-sm primary' }));
      actions.push(btn('진행 시작', function () { act.startRound(r); }));
      actions.push(btn('삭제', function () { act.deleteRound(r); }, { cls: 'btn-sm danger' }));
    } else if (r.status === '진행') {
      actions.push(btn(r.responseCount ? '문구 고치기' : '편집', function () { act.openRound(r.id); }, { cls: 'btn-sm primary' }));
      actions.push(btn('종료', function () { act.closeRound(r); }, { cls: 'btn-sm danger' }));
    } else {
      actions.push(btn('보기', function () { act.openRound(r.id); }));
    }
    actions.push(btn('복제', function () { act.newRound('copy', r.id); }, { title: '이 회차의 문항으로 새 회차 만들기' }));
    return h('div', { class: 'round-card' }, [
      h('div', { class: 'round-head' }, [
        h('span', { class: 'round-id', text: r.id }),
        h('span', { class: 'round-status ' + (STATUS_CLASS[r.status] || ''), text: r.status }),
        r.id === e.activeRoundId ? h('span', { class: 'small', text: '· 진행 중인 회차' }) : null
      ]),
      h('div', { class: 'round-title', text: r.title }),
      h('div', { class: 'small', text: (r.startDate && r.endDate ? r.startDate + ' ~ ' + r.endDate : '기간 미정') +
        ' · 응답 ' + (r.responseCount || 0) + '건 · 버전 ' + r.version }),
      h('div', { class: 'btn-row', style: { marginTop: '12px' } }, actions)
    ]);
  }

  function list(state, e, act) {
    var ov = state.overview;
    var branchesText = e.branchesText !== null ? e.branchesText : (ov && ov.branchList ? ov.branchList.join(', ') : '');
    return h('div', null, [
      h('div', { class: 'page-head' }, [
        h('h2', { text: '설문 편집' }),
        btn('새로고침', act.refreshList),
        btn('편집 잠그기', function () { act.lockEditor(''); }, { title: '편집 권한을 지금 끝냅니다' })
      ]),
      notice(e.listError),
      h('section', { class: 'card', style: { marginBottom: '16px' } }, [
        h('h3', { text: '새 회차 만들기' }),
        h('p', { class: 'sub', text: '새 회차는 "작성중"으로 만들어집니다. 문항을 다듬고 기간을 정한 뒤 [진행 시작]을 누르세요. 진행 중인 회차는 한 번에 하나입니다.' }),
        h('div', { class: 'btn-row' }, [
          btn('빈 설문으로', function () { act.newRound('blank'); }, { cls: 'btn btn-secondary btn-md' }),
          btn('기본 템플릿(업무환경 설문)으로', function () { act.newRound('template'); }, { cls: 'btn btn-secondary btn-md' })
        ]),
        h('p', { class: 'small', style: { marginTop: '10px' }, text: '지난 회차와 비슷하게 하려면 아래 목록에서 [복제]를 누르세요.' })
      ]),
      e.rounds === null ? h('div', { class: 'loading-row' }, [h('span', { class: 'spinner', 'aria-hidden': 'true' }), '회차 목록을 불러오는 중'])
        : (e.rounds.length ? h('div', { class: 'round-list' }, e.rounds.slice().reverse().map(function (r) { return roundCard(r, e, act); }))
          : h('div', { class: 'card empty', text: '아직 회차가 없습니다. 위에서 새 회차를 만드세요.' })),
      h('section', { class: 'card', style: { marginTop: '16px' } }, [
        h('h3', { text: '소속 목록' }),
        h('p', { class: 'sub', text: '설문 첫 화면의 소속 선택과 시트 [참여자명부]의 소속 목록입니다. 쉼표로 구분해 적습니다.' }),
        h('div', { class: 'card-body', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
          h('input', { class: 'text-input', style: { flex: '1', minWidth: '220px' }, value: branchesText, 'data-focus': 'branches', 'aria-label': '소속 목록',
            oninput: function (ev) { act.setBranchesText(ev.target.value); } }),
          btn('저장', act.saveBranches, { cls: 'btn btn-secondary btn-md' })
        ])
      ])
    ]);
  }

  /* ── 편집 화면 ── */
  function field(label, control, hint) {
    return h('label', { class: 'ed-field' }, [h('span', { class: 'ed-label', text: label }), control, hint ? h('span', { class: 'ed-hint', text: hint }) : null]);
  }

  function textInput(obj, key, act, opts) {
    var o = opts || {};
    var tag = o.multiline ? 'textarea' : 'input';
    var attrs = {
      class: o.multiline ? 'ed-textarea' : 'text-input ed-input', value: obj[key] === undefined || obj[key] === null ? '' : String(obj[key]),
      'data-focus': o.focus, placeholder: o.placeholder || '', disabled: !!o.disabled, maxlength: o.max || null, 'aria-label': o.aria || null,
      oninput: function (ev) { (o.onInput || act.setText)(obj, key, ev.target.value); }
    };
    if (o.multiline) {
      attrs.rows = o.rows || 2;
      delete attrs.value;
      return h('textarea', attrs, obj[key] === undefined || obj[key] === null ? '' : String(obj[key]));
    }
    attrs.type = o.type || 'text';
    return h(tag, attrs);
  }

  function select(options, value, onchange, opts) {
    var o = opts || {};
    return h('select', { class: 'ed-select', disabled: !!o.disabled, 'aria-label': o.aria || null, onchange: function (ev) { onchange(ev.target.value); } },
      options.map(function (op) { return h('option', { value: String(op[0]), selected: String(op[0]) === String(value) }, op[1]); }));
  }

  function iconBtn(label, onclick, disabled) {
    return h('button', { type: 'button', class: 'icon-btn', onclick: onclick, disabled: !!disabled, 'aria-label': label, title: label },
      label === '위로' ? '↑' : label === '아래로' ? '↓' : '✕');
  }

  function basics(e, act) {
    var d = e.draft;
    var ro = e.lock === 'none';
    var months = [['', '미정']].concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return [m + '월', m + '월']; }));
    return h('section', { class: 'card' }, [
      h('h3', { text: '기본 정보' }),
      h('div', { class: 'ed-grid card-body' }, [
        field('설문 제목', textInput(d, 'title', act, { focus: 'title', disabled: ro, max: 100 })),
        field('시작일', h('input', { class: 'text-input ed-input', type: 'date', value: e.meta.startDate, disabled: ro, 'data-focus': 'start', oninput: function (ev) { act.setMeta('startDate', ev.target.value); } })),
        field('종료일', h('input', { class: 'text-input ed-input', type: 'date', value: e.meta.endDate, disabled: ro, 'data-focus': 'end', oninput: function (ev) { act.setMeta('endDate', ev.target.value); } }), '종료일 당일까지 응답할 수 있습니다.'),
        field('결과 공유 월', select(months, e.meta.shareMonth, function (v) { act.setMeta('shareMonth', v); }, { disabled: ro, aria: '결과 공유 월' }), '안내문의 {공유월} 자리에 들어갑니다.'),
        field('주관식 글자 수 한도', h('input', { class: 'text-input ed-input', type: 'number', min: 100, max: 5000, step: 100, value: d.textMaxLength, disabled: e.lock !== 'full', 'data-focus': 'tmax',
          oninput: function (ev) { act.setNumber(d, 'textMaxLength', ev.target.value); } }))
      ])
    ]);
  }

  function intro(e, act) {
    var t = e.draft.texts;
    var ro = e.lock === 'none';
    return h('section', { class: 'card' }, [
      h('h3', { text: '안내문' }),
      h('p', { class: 'sub', text: '설문 첫 화면에 보입니다. {기간}은 시작일~종료일로, {공유월}은 결과 공유 월로 바뀝니다.' }),
      h('div', { class: 'card-body stack' }, [
        h('div', null, [h('div', { class: 'ed-label', text: '인사 문단' })].concat(t.intro.greeting.map(function (p, j) {
          return h('div', { class: 'ed-row' }, [
            textInput(t.intro.greeting, j, act, { multiline: true, focus: 'gr' + j, disabled: ro, aria: '인사 문단 ' + (j + 1) }),
            iconBtn('삭제', function () { act.listRemove(t.intro.greeting, j); }, ro)
          ]);
        })).concat([btn('+ 문단 추가', function () { act.listAdd(t.intro.greeting, ''); }, { disabled: ro || t.intro.greeting.length >= 5 })])),
        h('div', null, [h('div', { class: 'ed-label', text: '안내 항목 (아이콘과 함께 보이는 줄)' })].concat(t.intro.items.map(function (it, j) {
          return h('div', { class: 'ed-row' }, [
            textInput(it, 'label', act, { focus: 'il' + j, disabled: ro, placeholder: '제목(예: 응답 기간)', aria: '안내 항목 ' + (j + 1) + ' 제목' }),
            textInput(it, 'text', act, { focus: 'it' + j, disabled: ro, placeholder: '내용(예: {기간})', aria: '안내 항목 ' + (j + 1) + ' 내용' }),
            iconBtn('위로', function () { act.listMove(t.intro.items, j, -1); }, ro || j === 0),
            iconBtn('아래로', function () { act.listMove(t.intro.items, j, 1); }, ro || j === t.intro.items.length - 1),
            iconBtn('삭제', function () { act.listRemove(t.intro.items, j); }, ro)
          ]);
        })).concat([btn('+ 항목 추가', function () { act.listAdd(t.intro.items, { label: '', text: '' }); }, { disabled: ro || t.intro.items.length >= 10 })])),
        field('맺음말', textInput(t.intro, 'closing', act, { multiline: true, focus: 'closing', disabled: ro })),
        field('완료 문구 (제출 뒤 화면)', textInput(t, 'done', act, { multiline: true, focus: 'done', disabled: ro }), '첫 문장이 제목처럼 크게 보입니다.')
      ])
    ]);
  }

  function sections(e, act) {
    var s = e.draft.sections;
    var ro = e.lock === 'none';
    return h('section', { class: 'card' }, [
      h('h3', { text: '섹션' }),
      h('p', { class: 'sub', text: '문항 위에 작게 보이는 묶음 이름입니다(예: A. 기본 정보).' }),
      h('div', { class: 'card-body' }, Object.keys(s).map(function (k) {
        return h('div', { class: 'ed-row' }, [
          h('span', { class: 'ed-key', text: k }),
          textInput(s, k, act, { focus: 'sec' + k, disabled: ro, aria: '섹션 ' + k }),
          iconBtn('삭제', function () { act.removeSection(k); }, ro)
        ]);
      }).concat([btn('+ 섹션 추가', act.addSection, { disabled: ro })]))
    ]);
  }

  function optionsEditor(q, i, e, act) {
    var full = e.lock === 'full';
    var ro = e.lock === 'none';
    var rows = q.options.map(function (o, j) {
      var flags = [];
      flags.push(h('label', { class: 'ed-flag' }, [h('input', { type: 'checkbox', checked: !!o.etc, disabled: !full, onchange: function () { act.toggleFlag(i, j, 'etc'); } }), '기타(직접 입력)']));
      if (q.type === 'multi') flags.push(h('label', { class: 'ed-flag' }, [h('input', { type: 'checkbox', checked: !!o.exclusive, disabled: !full, onchange: function () { act.toggleFlag(i, j, 'exclusive'); } }), '단독 선택']));
      if (q.type === 'single') flags.push(h('label', { class: 'ed-flag', title: '결과 교차표에서 따로 세는 "해당 없음/어려움 없음" 같은 선택지' }, [h('input', { type: 'checkbox', checked: !!o.none, disabled: !full, onchange: function () { act.toggleFlag(i, j, 'none'); } }), '없음 표시']));
      return h('div', { class: 'ed-option' }, [
        h('span', { class: 'ed-key', title: '선택지 코드(응답 시트에 저장되는 값)', text: String(o.value) }),
        textInput(o, 'label', act, { focus: 'q' + i + 'o' + j, disabled: ro, aria: q.id + ' 선택지 ' + (j + 1) }),
        h('div', { class: 'ed-flags' }, flags),
        h('div', { class: 'ed-opt-btns' }, [
          iconBtn('위로', function () { act.moveOption(i, j, -1); }, !full || j === 0),
          iconBtn('아래로', function () { act.moveOption(i, j, 1); }, !full || j === q.options.length - 1),
          iconBtn('삭제', function () { act.removeOption(i, j); }, !full || q.options.length <= 1)
        ])
      ]);
    });
    var extra = [];
    if (q.type === 'multi') {
      extra.push(field('최대 선택 수', select(q.options.map(function (_, k) { return [k + 1, (k + 1) + '개']; }), q.maxSelect, function (v) { act.setMaxSelect(i, v); }, { disabled: !full, aria: '최대 선택 수' })));
    }
    return h('div', { class: 'stack' }, [
      h('div', { class: 'ed-label', text: '선택지' }),
      h('div', null, rows),
      btn('+ 선택지 추가', function () { act.addOption(i); }, { disabled: !full || q.options.length >= 30 })
    ].concat(extra));
  }

  function scaleEditor(q, i, e, act) {
    var full = e.lock === 'full';
    var ro = e.lock === 'none';
    var nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return [n, String(n)]; });
    var mid = Math.round((q.min + q.max) / 2);
    var labelInput = function (point, ph) {
      return field(point + '점 라벨', h('input', {
        class: 'text-input ed-input', value: (q.scaleLabels || {})[point] || '', placeholder: ph, disabled: ro, 'data-focus': 'q' + i + 'sl' + point,
        oninput: function (ev) { act.setScaleLabel(q, point, ev.target.value); }
      }));
    };
    var out = [
      h('div', { class: 'ed-grid' }, [
        field('가장 낮은 점수', select(nums, q.min, function (v) { act.setRange(i, 'min', v); }, { disabled: !full, aria: '가장 낮은 점수' })),
        field('가장 높은 점수', select(nums, q.max, function (v) { act.setRange(i, 'max', v); }, { disabled: !full, aria: '가장 높은 점수' })),
        labelInput(q.min, '예: 전혀 그렇지 않다'),
        mid !== q.min && mid !== q.max ? labelInput(mid, '(선택) 예: 보통') : null,
        labelInput(q.max, '예: 매우 그렇다')
      ])
    ];
    if (q.type === 'grid') {
      out.unshift(h('div', { class: 'stack' }, [h('div', { class: 'ed-label', text: '항목 (하나씩 카드로 묻습니다)' })].concat(q.items.map(function (it, j) {
        return h('div', { class: 'ed-row' }, [
          h('input', { class: 'text-input ed-input', value: it, disabled: ro, 'data-focus': 'q' + i + 'it' + j, 'aria-label': q.id + ' 항목 ' + (j + 1), oninput: function (ev) { act.setItem(q, j, ev.target.value); } }),
          iconBtn('위로', function () { act.moveItem(i, j, -1); }, !full || j === 0),
          iconBtn('아래로', function () { act.moveItem(i, j, 1); }, !full || j === q.items.length - 1),
          iconBtn('삭제', function () { act.removeItem(i, j); }, !full || q.items.length <= 1)
        ]);
      })).concat([btn('+ 항목 추가', function () { act.addItem(i); }, { disabled: !full || q.items.length >= 30 })])));
      out.push(h('div', { class: 'ed-row' }, [
        h('label', { class: 'ed-flag' }, [h('input', { type: 'checkbox', checked: !!q.na, disabled: !full, onchange: function () { act.toggleNa(i); } }), '"해당 없음" 버튼 두기']),
        q.na ? h('input', { class: 'text-input ed-input', value: q.na.label, disabled: ro, 'data-focus': 'q' + i + 'na', 'aria-label': '해당 없음 글자', oninput: function (ev) { act.setText(q.na, 'label', ev.target.value); } }) : null
      ]));
    }
    return h('div', { class: 'stack' }, out);
  }

  function textEditor(q, i, e, act) {
    var ro = e.lock === 'none';
    var ex = q.examples || [];
    return h('div', { class: 'stack' }, [
      field('안내 (선택)', textInput(q, 'guide', act, { multiline: true, rows: 3, focus: 'q' + i + 'guide', disabled: ro })),
      h('div', null, [h('div', { class: 'ed-label', text: '예시 (선택)' })].concat(ex.map(function (x, j) {
        return h('div', { class: 'ed-row' }, [
          textInput(ex, j, act, { focus: 'q' + i + 'ex' + j, disabled: ro, aria: '예시 ' + (j + 1) }),
          iconBtn('삭제', function () { act.removeExample(q, j); }, ro)
        ]);
      })).concat([btn('+ 예시 추가', function () { act.addExample(q); }, { disabled: ro || ex.length >= 5 })])),
      h('p', { class: 'small', text: '주관식은 항상 선택 응답입니다(건너뛰기 버튼이 있습니다).' })
    ]);
  }

  function showIfEditor(q, i, e, act) {
    var full = e.lock === 'full';
    var d = e.draft;
    var sources = d.questions.slice(0, i).filter(function (x) { return x.type === 'single'; });
    if (!sources.length && !q.showIf) return null;
    var src = q.showIf ? d.questions.find(function (x) { return x.id === q.showIf.question; }) : null;
    return h('div', { class: 'ed-showif' }, [
      h('span', { class: 'ed-label', text: '건너뛰기 조건' }),
      h('div', { class: 'ed-row' }, [
        select([['', '없음 (항상 묻기)']].concat(sources.map(function (x) { return [x.id, x.id + '. ' + x.title.slice(0, 24)]; })), q.showIf ? q.showIf.question : '',
          function (v) { act.setShowIf(i, v, ''); }, { disabled: !full, aria: '조건 문항' }),
        src ? h('span', { class: 'small', text: '에서' }) : null,
        src ? select(src.options.map(function (o) { return [o.value, o.label.slice(0, 24)]; }), q.showIf.notEquals,
          function (v) { act.setShowIf(i, src.id, v); }, { disabled: !full, aria: '조건 선택지' }) : null,
        src ? h('span', { class: 'small', text: '를 고르면 이 문항을 건너뜁니다' }) : null
      ])
    ]);
  }

  function questionCard(q, i, e, act) {
    var full = e.lock === 'full';
    var ro = e.lock === 'none';
    var open = e.openQ === i;
    var errCount = act.questionErrorCount(e.errors, i);
    var typeOptions = Object.keys(act.TYPE_LABELS).map(function (k) { return [k, act.TYPE_LABELS[k]]; });
    var head = h('div', { class: 'q-card-head' }, [
      h('button', { type: 'button', class: 'q-card-toggle', 'aria-expanded': open ? 'true' : 'false', onclick: function () { act.toggleOpen(i); } }, [
        h('span', { class: 'q-card-id', text: q.id }),
        h('span', { class: 'q-card-title', text: q.title || '(질문 없음)' }),
        h('span', { class: 'q-card-meta', text: act.TYPE_LABELS[q.type] + (q.required ? ' · 필수' : ' · 선택') + (q.showIf ? ' · 건너뛰기' : '') }),
        errCount ? h('span', { class: 'q-card-err', text: '고칠 곳 ' + errCount }) : null
      ]),
      h('div', { class: 'ed-opt-btns' }, [
        iconBtn('위로', function () { act.moveQuestion(i, -1); }, !full || i === 0),
        iconBtn('아래로', function () { act.moveQuestion(i, 1); }, !full || i === e.draft.questions.length - 1),
        iconBtn('삭제', function () { act.removeQuestion(i); }, !full || e.draft.questions.length <= 1)
      ])
    ]);
    if (!open) return h('div', { class: 'q-card' + (errCount ? ' has-err' : '') }, head);
    var body;
    if (q.type === 'single' || q.type === 'multi') body = optionsEditor(q, i, e, act);
    else if (q.type === 'text') body = textEditor(q, i, e, act);
    else body = scaleEditor(q, i, e, act);
    return h('div', { class: 'q-card open' + (errCount ? ' has-err' : '') }, [
      head,
      h('div', { class: 'q-card-body stack' }, [
        h('div', { class: 'ed-grid' }, [
          field('형식', select(typeOptions, q.type, function (v) { act.changeType(i, v); }, { disabled: !full, aria: '형식' })),
          field('섹션', select(Object.keys(e.draft.sections).map(function (k) { return [k, k + '. ' + e.draft.sections[k]]; }), q.section,
            function (v) { act.setSection(i, v); }, { disabled: ro, aria: '섹션' })),
          q.type !== 'text' ? h('label', { class: 'ed-flag', style: { alignSelf: 'end', paddingBottom: '10px' } }, [
            h('input', { type: 'checkbox', checked: !!q.required, disabled: !full, onchange: function (ev) { act.setRequired(i, ev.target.checked); } }), '필수 응답'
          ]) : null
        ]),
        field('질문 문구', textInput(q, 'title', act, { multiline: true, focus: 'q' + i + 'title', disabled: ro, max: 300 })),
        body,
        showIfEditor(q, i, e, act)
      ])
    ]);
  }

  function questions(e, act) {
    var full = e.lock === 'full';
    var types = Object.keys(act.TYPE_LABELS);
    return h('section', { class: 'card' }, [
      h('h3', { text: '문항 (' + e.draft.questions.length + '개)' }),
      h('p', { class: 'sub', text: '제목을 누르면 펼쳐집니다. 문항 번호는 순서대로 자동으로 매겨집니다. 이름·사번처럼 개인을 알아볼 수 있는 것을 묻는 문항은 만들지 마세요(익명 약속).' }),
      h('div', { class: 'card-body q-cards' }, e.draft.questions.map(function (q, i) { return questionCard(q, i, e, act); })),
      h('div', { class: 'btn-row' }, [h('span', { class: 'small', style: { alignSelf: 'center' }, text: '문항 추가:' })].concat(types.map(function (t) {
        return btn('+ ' + act.TYPE_LABELS[t], function () { act.addQuestion(t); }, { disabled: !full || e.draft.questions.length >= 60 });
      })))
    ]);
  }

  function analysis(e, act) {
    var d = e.draft;
    var a = d.analysis || {};
    var ro = e.lock === 'none';
    var singles = d.questions.filter(function (q) { return q.type === 'single'; });
    var choices = d.questions.filter(function (q) { return q.type === 'single' || q.type === 'multi'; });
    var opt = function (list) { return [['', '고르세요']].concat(list.map(function (q) { return [q.id, q.id + '. ' + q.title.slice(0, 24)]; })); };
    var gridQs = d.questions.filter(function (q) { return q.type === 'grid' || q.type === 'scale'; });
    return h('section', { class: 'card' }, [
      h('h3', { text: '분석 설정' }),
      h('p', { class: 'sub', text: '결과 화면에서 쓰는 설정입니다. 응답이 들어온 뒤에도 바꿀 수 있습니다.' }),
      h('div', { class: 'card-body stack' }, [
        field('그룹 필터 문항', select([['', '없음']].concat(singles.map(function (q) { return [q.id, q.id + '. ' + q.title.slice(0, 24)]; })), a.groupBy || '',
          function (v) { act.setAnalysis('groupBy', v); }, { disabled: ro, aria: '그룹 필터 문항' }), '예: 직군. 결과를 이 문항의 답으로 나눠 봅니다. 응답이 3명 미만인 그룹은 숨깁니다.'),
        h('div', null, [h('div', { class: 'ed-label', text: '교차표 (단일 선택 × 선택 문항)' })].concat((a.crosstabs || []).map(function (pair, k) {
          return h('div', { class: 'ed-row' }, [
            select(opt(singles), pair[0], function (v) { act.setCrosstab(k, 0, v); }, { disabled: ro, aria: '교차표 행' }),
            h('span', { class: 'small', text: '×' }),
            select(opt(choices), pair[1], function (v) { act.setCrosstab(k, 1, v); }, { disabled: ro, aria: '교차표 열' }),
            iconBtn('삭제', function () { act.removeCrosstab(k); }, ro)
          ]);
        })).concat([btn('+ 교차표 추가', act.addCrosstab, { disabled: ro || (a.crosstabs || []).length >= 5 })])),
        gridQs.length ? field('높은 점수 기준', select([['', '자동(위에서 두 칸)']].concat([2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return [n, n + '점 이상']; })), a.highThreshold || '',
          function (v) { act.setAnalysis('highThreshold', v === '' ? '' : Number(v)); }, { disabled: ro, aria: '높은 점수 기준' }), '항목별 점수 표에서 "높은 점수 인원"을 셀 기준입니다.') : null
      ])
    ]);
  }

  function errorList(e, act) {
    if (!e.errors.length && !e.saveError) return null;
    return h('div', { class: 'notice', role: 'alert', style: { display: 'block', marginBottom: '16px' } }, [
      e.saveError ? h('strong', { text: e.saveError }) : null,
      e.errors.length ? h('ul', { class: 'ed-errors' }, e.errors.slice(0, 20).map(function (x) {
        return h('li', { text: act.describePath(x.path, e.draft) + ' — ' + x.message });
      })) : null,
      e.errors.length > 20 ? h('div', { class: 'small', text: '외 ' + (e.errors.length - 20) + '곳' }) : null
    ]);
  }

  function edit(state, e, act) {
    var ro = e.lock === 'none';
    return h('div', null, [
      h('div', { class: 'ed-bar' }, [
        btn('← 목록', act.backToList),
        h('div', { class: 'ed-bar-title' }, [
          h('strong', { text: e.roundId + ' · ' + (e.draft.title || '') }),
          h('span', { class: 'small', text: e.round.status + ' · ' + LOCK_TEXT[e.lock] + (e.dirty ? ' · 저장 안 됨' : '') })
        ]),
        btn('미리보기', act.preview),
        ro ? null : h('button', { type: 'button', class: 'btn btn-primary btn-md', onclick: act.save, 'aria-busy': e.busy ? 'true' : 'false' }, e.busy ? '저장 중' : '저장')
      ]),
      e.lock === 'wording' ? h('div', { class: 'notice', style: { marginBottom: '14px' } }, [icon('lock', 18),
        h('span', { text: '응답이 ' + e.responseCount + '건 들어온 회차입니다. 이미 받은 응답의 의미가 바뀌지 않도록 문구만 고칠 수 있습니다. 문항·선택지 추가·삭제·순서·형식을 바꾸려면 [복제]로 새 회차를 만드세요.' })]) : null,
      errorList(e, act),
      /^다른 사람이 먼저/.test(e.saveError) ? h('div', { class: 'btn-row', style: { marginTop: '-6px', marginBottom: '14px' } }, btn('다시 불러오기', act.reload)) : null,
      h('div', { class: 'stack' }, [basics(e, act), intro(e, act), sections(e, act), questions(e, act), analysis(e, act)])
    ]);
  }

  function render(state, act) {
    var e = state.ed;
    if (!e.editToken) return h('div', null, [h('div', { class: 'page-head' }, [h('h2', { text: '설문 편집' })]), unlock(e, act)]);
    if (e.view === 'edit' && e.draft) return edit(state, e, act);
    return list(state, e, act);
  }

  return { render: render };
})();
