/*
 * 설문 화면 그리기 — 상태(state)와 동작(act)을 받아 화면 노드를 만든다.
 * 상태 변경은 하지 않는다. 모든 동작은 survey.js의 act.* 함수가 처리한다.
 */
var Views = (function () {
  var h = Dom.h;
  var icon = Dom.icon;
  var DEF = SURVEY_DEF;
  var TITLE = '업무환경·프로세스 개선 설문';
  var INTRO_ICONS = { time: 'clock', period: 'calendar', anonymity: 'lock', scope: 'eye', share: 'megaphone' };
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function wordmark() {
    return h('div', { class: 'wordmark' }, [h('span', { class: 'spark', 'aria-hidden': 'true' }), 'HSTC 중고차사업부']);
  }

  // '2026-11-24' → '11월 24일(화)'
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number(m[2]) + '월 ' + Number(m[3]) + '일(' + WEEKDAYS[d.getDay()] + ')';
  }

  function periodText(status) {
    if (!status || !status.startDate || !status.endDate) return '';
    return formatDate(status.startDate) + ' ~ ' + formatDate(status.endDate);
  }

  /*
   * spec 원문의 자리표시를 서버 설정값으로 채운다(사용자 결정 2026-11-21).
   *   '○월 ○일(○) ~ ○월 ○일(○)' → 시작일·종료일,  '○월 중' → 결과 공유 월 + ' 중'
   * 설정값이 없으면 원문 그대로 둔다.
   */
  var PERIOD_PLACEHOLDER = '○월 ○일(○) ~ ○월 ○일(○)';
  var SHARE_PLACEHOLDER = '○월 중';
  function fillText(text, status) {
    var out = text;
    var period = periodText(status);
    if (period) out = out.split(PERIOD_PLACEHOLDER).join(period);
    if (status && status.shareMonth) out = out.split(SHARE_PLACEHOLDER).join(status.shareMonth + ' 중');
    return out;
  }

  function notice(msg) {
    if (!msg) return null;
    return h('div', { class: 'notice inline-msg', role: 'alert' }, [icon('alert', 18), h('span', { text: msg })]);
  }

  function spinner() { return h('span', { class: 'spinner', 'aria-hidden': 'true' }); }

  /* ── 시작 화면 ── */
  function start(state, act) {
    var intro = DEF.texts.intro;
    var form = h('form', { class: 'start-form', novalidate: true, onsubmit: function (e) { e.preventDefault(); act.startSurvey(); } }, [
      h('div', null, [
        h('span', { class: 'field-label', id: 'branch-label' }, '소속'),
        h('div', { class: 'branch-grid', role: 'radiogroup', 'aria-labelledby': 'branch-label' },
          DEF.branches.map(function (b) {
            var on = state.branch === b;
            return h('button', {
              type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-focus': 'branch-' + b,
              onclick: function () { act.setBranch(b); }
            }, b);
          }))
      ]),
      h('div', null, [
        h('label', { class: 'field-label', for: 'name-input' }, '이름'),
        h('input', {
          id: 'name-input', class: 'text-input', type: 'text', value: state.name, maxlength: 30,
          autocomplete: 'name', placeholder: '이름을 입력하세요', 'aria-describedby': 'name-help',
          oninput: function (e) { act.setName(e.target.value); }
        }),
        h('p', { class: 'field-help', id: 'name-help' }, [icon('lock', 14), h('span', { text: '이름은 참여 여부 확인에만 사용되며, 응답과 분리되어 저장됩니다.' })]),
        notice(state.startError)
      ]),
      h('button', { type: 'submit', class: 'btn btn-primary btn-block', 'aria-busy': state.busy ? 'true' : 'false' },
        state.busy ? [spinner(), '확인 중'] : '시작하기')
    ]);

    var mock = APP_CONFIG.MOCK ? h('div', { class: 'mock-banner' }, [
      h('strong', null, 'MOCK 모드 · '), '실제 서버 없이 이 브라우저 안에서만 동작합니다.', h('br'),
      '테스트 명단: ' + MockServer.hint(), h('br'),
      h('button', { type: 'button', onclick: act.resetMock }, 'MOCK 명부·응답 초기화')
    ]) : null;

    return h('div', { class: 'screen' }, [
      h('header', { class: 'hero' }, [
        wordmark(),
        h('h1', { text: TITLE }),
        h('div', { class: 'greeting' }, intro.greeting.map(function (p) { return h('p', { text: p }); }))
      ]),
      h('ul', { class: 'intro-card' }, intro.items.map(function (it) {
        return h('li', null, [
          h('span', { class: 'ico' }, icon(INTRO_ICONS[it.key], 18)),
          h('div', null, [h('div', { class: 'lbl', text: it.label }), h('div', { class: 'txt', text: fillText(it.text, state.status) })])
        ]);
      })),
      h('p', { class: 'closing', text: intro.closing }),
      form,
      mock
    ]);
  }

  /* ── 문항 화면 ── */
  function topbar(state, act) {
    var step = state.steps[state.stepIndex];
    var q = SurveyLogic.findQuestion(step.qid);
    var total = DEF.questions.length;
    var num = q.id.replace('Q', '');
    var counter = q.type === 'grid'
      ? h('span', { class: 'counter' }, [h('b', null, q.id), ' · ' + (step.item + 1) + '/' + q.items.length])
      : h('span', { class: 'counter' }, [h('b', null, 'Q' + num), ' / ' + total]);
    var pct = Math.max(2, Math.round((state.stepIndex / state.steps.length) * 100));
    return h('div', { class: 'topbar' }, [
      h('div', { class: 'topbar-row' }, [
        h('button', { type: 'button', class: 'back-btn', onclick: act.prev, hidden: state.stepIndex === 0, 'aria-label': '이전 문항' },
          [icon('back', 20), '이전']),
        counter
      ]),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': '진행률' },
        h('div', { class: 'progress-fill', style: { width: pct + '%' } }))
    ]);
  }

  function hotkeyLabel(i) { return String(i + 1); }

  function optionButton(q, opt, i, state, act) {
    var multi = q.type === 'multi';
    var on = SurveyLogic.isSelected(q, state.answers, opt.value);
    var parts = multi
      ? [h('span', { class: 'box' }, icon('check', 15, 3)), h('span', { class: 'label', text: opt.label }), h('span', { class: 'hotkey', text: hotkeyLabel(i) })]
      : [h('span', { class: 'key', text: hotkeyLabel(i) }), h('span', { class: 'label', text: opt.label }), h('span', { class: 'tick' }, icon('check', 20, 2.6))];
    return h('button', {
      type: 'button', class: 'opt', role: multi ? 'checkbox' : 'radio',
      'aria-checked': on ? 'true' : 'false', 'data-focus': q.id + '-' + opt.value,
      onclick: function () { act.choose(opt.value); }
    }, parts);
  }

  function etcInput(q, state, act) {
    var etc = SurveyLogic.etcOption(q);
    if (!etc || !SurveyLogic.isSelected(q, state.answers, etc.value)) return null;
    var key = SurveyLogic.etcKey(q);
    return h('div', { class: 'etc-wrap' }, h('input', {
      class: 'text-input', type: 'text', id: 'etc-input', 'data-focus': 'etc', maxlength: DEF.textMaxLength,
      value: state.answers[key] || '', placeholder: '기타 내용을 적어 주세요', 'aria-label': '기타 내용',
      oninput: function (e) { act.setEtc(e.target.value); }
    }));
  }

  // 단일·복수 선택지 목록. 기타 입력란은 '기타' 선택지 바로 아래에 넣는다.
  function optionList(q, state, act) {
    var etc = SurveyLogic.etcOption(q);
    var children = [];
    q.options.forEach(function (opt, i) {
      children.push(optionButton(q, opt, i, state, act));
      if (etc && opt.value === etc.value) children.push(etcInput(q, state, act));
    });
    return h('div', { class: 'options', role: q.type === 'multi' ? 'group' : 'radiogroup', 'aria-labelledby': 'q-title' }, children);
  }

  function scaleRow(q, current, onPick, focusPrefix) {
    var btns = [];
    for (var v = q.min; v <= q.max; v++) {
      (function (val) {
        btns.push(h('button', {
          type: 'button', role: 'radio', 'aria-checked': current === val ? 'true' : 'false',
          'data-focus': focusPrefix + val, 'aria-label': val + (q.scaleLabels[val] ? ' ' + q.scaleLabels[val] : '') + '점',
          onclick: function () { onPick(val); }
        }, String(val)));
      })(v);
    }
    var labels = [];
    var mid = Math.round((q.min + q.max) / 2);
    labels.push(h('span', { text: q.scaleLabels[q.min] || '' }));
    labels.push(h('span', { text: q.scaleLabels[mid] || '' }));
    labels.push(h('span', { text: q.scaleLabels[q.max] || '' }));
    return [
      h('div', { class: 'scale', role: 'radiogroup', 'aria-labelledby': 'q-title' }, btns),
      h('div', { class: 'scale-labels', 'aria-hidden': 'true' }, labels)
    ];
  }

  function gridCard(q, step, state, act) {
    var arr = state.answers[q.id] || [];
    var cur = arr[step.item];
    var dots = [];
    for (var i = 0; i < q.items.length; i++) {
      dots.push(h('i', { class: i < step.item ? 'done' : (i === step.item ? 'now' : '') }));
    }
    return [
      h('div', { class: 'grid-card' }, [
        h('div', { class: 'pos', text: (step.item + 1) + ' / ' + q.items.length }),
        h('div', { class: 'item', id: 'grid-item', text: q.items[step.item] }),
        scaleRow(q, cur, act.choose, 'g-')
      ]),
      h('button', {
        type: 'button', class: 'na-btn', role: 'radio', 'data-focus': 'g-na',
        'aria-checked': cur === q.na.value ? 'true' : 'false', onclick: function () { act.choose(q.na.value); }
      }, [q.na.label, h('span', { class: 'hotkey', text: ' · 0' })]),
      h('div', { class: 'dots', 'aria-hidden': 'true' }, dots)
    ];
  }

  function textField(q, state, act) {
    var max = DEF.textMaxLength;
    var val = state.answers[q.id] || '';
    var count = h('div', { class: 'char-count' + (val.length > max ? ' over' : ''), id: 'char-count', 'aria-live': 'polite' },
      val.length.toLocaleString() + ' / ' + max.toLocaleString());
    var guide = q.guide ? h('div', { class: 'guide' }, [
      h('p', { text: q.guide }),
      q.examples ? h('p', { class: 'examples-title' }, '예시') : null,
      q.examples ? h('ul', { class: 'examples' }, q.examples.map(function (ex) { return h('li', { text: '"' + ex + '"' }); })) : null
    ]) : null;
    return [
      guide,
      h('div', { style: { marginTop: guide ? '14px' : '0' } }, [
        h('textarea', {
          class: 'text-area', id: 'text-input', 'data-focus': 'text', maxlength: max, rows: 7,
          'aria-labelledby': 'q-title', placeholder: '자유롭게 적어 주세요 (선택)',
          oninput: function (e) { act.setText(e.target.value); }
        }, val),
        count
      ])
    ];
  }

  function contextChip(q, state) {
    // Q6: 앞에서 고른 어려움(Q5)을 함께 보여준다.
    if (!q.showIf) return null;
    var src = SurveyLogic.findQuestion(q.showIf.question);
    var opt = SurveyLogic.findOption(src, state.answers[src.id]);
    if (!opt) return null;
    var text = opt.etc ? (state.answers[SurveyLogic.etcKey(src)] || '기타') : opt.label;
    return h('div', { class: 'q-context' }, ['고른 어려움 · ', h('b', { text: text })]);
  }

  function footer(q, step, state, act) {
    var answered = SurveyLogic.checkStep(step, state.answers) === null;
    if (q.type === 'text') {
      var hasText = !!(state.answers[q.id] || '').trim();
      return h('div', { class: 'footer' }, h('button', {
        type: 'button', class: 'btn ' + (hasText ? 'btn-primary' : 'btn-secondary') + ' btn-block', id: 'next-btn', onclick: act.next
      }, hasText ? '다음' : '건너뛰기'));
    }
    if (q.type === 'multi') {
      return h('div', { class: 'footer' }, h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'next-btn', onclick: act.next }, '다음'));
    }
    // 단일·척도·Q4: 고르면 자동으로 넘어간다. 이미 답한 문항으로 돌아왔거나 기타를 고른 경우에만 [다음]을 보여준다.
    if (!answered && !isEtcSelected(q, state)) return null;
    return h('div', { class: 'footer' }, h('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'next-btn', onclick: act.next }, '다음'));
  }

  function isEtcSelected(q, state) {
    var etc = SurveyLogic.etcOption(q);
    return !!(etc && SurveyLogic.isSelected(q, state.answers, etc.value));
  }

  function question(state, act) {
    var step = state.steps[state.stepIndex];
    var q = SurveyLogic.findQuestion(step.qid);
    var content;
    var meta = null;
    if (q.type === 'single' || q.type === 'multi') content = optionList(q, state, act);
    else if (q.type === 'scale') content = scaleRow(q, state.answers[q.id], act.choose, 's-');
    else if (q.type === 'grid') content = gridCard(q, step, state, act);
    else content = textField(q, state, act);

    if (q.type === 'multi') meta = h('p', { class: 'q-meta', text: '최대 ' + q.maxSelect + '개까지 고를 수 있습니다.' });
    if (q.type === 'text') meta = h('p', { class: 'q-meta', text: '선택 응답입니다. 적지 않고 넘어가도 됩니다.' });

    var autoHint = (q.type === 'single' || q.type === 'scale' || q.type === 'grid') && !isEtcSelected(q, state)
      ? h('p', { class: 'hint', text: '고르면 다음으로 넘어갑니다' }) : null;

    return h('div', { class: 'screen' + (state.anim ? ' ' + state.anim : '') }, [
      topbar(state, act),
      h('main', { class: 'q-body' }, [
        h('div', { class: 'q-section', text: q.section + '. ' + DEF.sections[q.section] }),
        h('h2', { class: 'q-title', id: 'q-title', tabindex: '-1', style: q.type === 'grid' ? { fontSize: '17px', fontWeight: '500', color: 'var(--text-2)' } : null }, q.id + '. ' + q.title),
        contextChip(q, state),
        meta,
        h('div', { class: 'q-content' }, content),
        notice(state.flash),
        autoHint
      ]),
      footer(q, step, state, act)
    ]);
  }

  /* ── 제출 확인 화면 ── */
  function confirm(state, act) {
    var requiredTotal = 0;
    var optionalTotal = 0;
    var optionalDone = 0;
    DEF.questions.forEach(function (q) {
      if (!SurveyLogic.isVisible(q, state.answers)) return;
      if (q.required) requiredTotal++;
      else {
        optionalTotal++;
        if ((state.answers[q.id] || '').trim()) optionalDone++;
      }
    });
    return h('div', { class: 'screen' + (state.anim ? ' ' + state.anim : '') }, [
      h('main', { class: 'center-body' }, [
        h('div', { class: 'badge-ico' }, [icon('send', 30, 2), h('span', { class: 'spark', 'aria-hidden': 'true' })]),
        h('h2', { id: 'q-title', tabindex: '-1', text: '응답을 제출할까요?' }),
        h('p', { class: 'desc', text: '제출하면 수정할 수 없습니다.' }),
        h('div', { class: 'summary' }, [
          h('div', null, [h('span', null, '필수 문항'), h('b', null, requiredTotal + '개 모두 응답')]),
          h('div', null, [h('span', null, '선택 문항(주관식)'), h('b', null, optionalDone + ' / ' + optionalTotal + '개 작성')])
        ]),
        notice(state.submitError),
        state.submitError ? h('button', { type: 'button', class: 'btn btn-secondary', style: { marginTop: '12px', alignSelf: 'center' }, onclick: act.backToStart }, '처음 화면으로') : null
      ]),
      h('div', { class: 'footer' }, [
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: act.prev }, [icon('back', 18), '이전']),
        h('button', { type: 'button', class: 'btn btn-primary', id: 'submit-btn', onclick: act.submit, 'aria-busy': state.busy ? 'true' : 'false' },
          state.busy ? [spinner(), '제출 중'] : '제출하기')
      ])
    ]);
  }

  /* ── 완료 화면 ── */
  function done(state) {
    // spec 원문 한 문장씩: 첫 문장은 제목, 나머지는 설명
    var t = fillText(DEF.texts.done, state.status);
    var cut = t.indexOf('. ') + 1;
    return h('div', { class: 'screen' }, [
      h('div', { class: 'done-top' }, wordmark()),
      h('main', { class: 'center-body' }, [
        h('div', { class: 'badge-ico' }, [icon('check', 34, 2.6), h('span', { class: 'spark', 'aria-hidden': 'true' })]),
        h('h2', { id: 'q-title', tabindex: '-1', text: t.slice(0, cut) }),
        h('p', { class: 'desc', text: t.slice(cut).trim() })
      ])
    ]);
  }

  /* ── 기간 외·꺼짐 안내 ── */
  function closed(state) {
    var st = state.status || {};
    var period = periodText(st);
    var title = {
      off: '지금은 응답을 받고 있지 않습니다.',
      before: '아직 설문 기간이 아닙니다.',
      after: '설문 기간이 끝났습니다.'
    }[st.state] || '지금은 설문에 참여할 수 없습니다.';
    var desc = st.state === 'after'
      ? '참여해 주신 모든 분께 감사드립니다.'
      : (st.state === 'off' ? '잠시 후 다시 접속해 주세요. 문의는 중고차사업부 본부로 해 주세요.' : '응답 기간에 다시 접속해 주세요.');
    return h('div', { class: 'screen' }, [
      h('div', { class: 'done-top' }, wordmark()),
      h('main', { class: 'center-body' }, [
        h('div', { class: 'badge-ico warn' }, icon(st.state === 'off' ? 'pause' : 'calendar', 32, 2)),
        h('h2', { id: 'q-title', tabindex: '-1', text: title }),
        h('p', { class: 'desc', text: desc }),
        period ? h('div', { class: 'summary' }, h('div', null, [h('span', null, '응답 기간'), h('b', { text: period })])) : null
      ])
    ]);
  }

  /* ── 오류(서버 연결 실패) ── */
  function error(state, act) {
    return h('div', { class: 'screen' }, [
      h('div', { class: 'done-top' }, wordmark()),
      h('main', { class: 'center-body' }, [
        h('div', { class: 'badge-ico warn' }, icon('alert', 32, 2)),
        h('h2', { id: 'q-title', tabindex: '-1', text: '설문을 불러오지 못했습니다.' }),
        h('p', { class: 'desc', text: state.loadError || '' }),
        h('button', { type: 'button', class: 'btn btn-primary', style: { marginTop: '24px', alignSelf: 'center', minWidth: '160px' }, onclick: act.reload }, '다시 시도')
      ])
    ]);
  }

  function loading() {
    return h('div', { class: 'screen loading', 'aria-busy': 'true' }, [spinner(), h('span', { class: 'sr-only' }, '불러오는 중')]);
  }

  return { start: start, question: question, confirm: confirm, done: done, closed: closed, error: error, loading: loading };
})();
