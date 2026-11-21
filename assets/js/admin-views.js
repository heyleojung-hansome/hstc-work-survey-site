/*
 * 관리자 화면 그리기 — 상태(state)와 동작(act)을 받아 노드를 만든다. 상태는 바꾸지 않는다.
 *
 * 익명성 규칙 4번: 명부(이름)는 '참여자 관리' 탭에만, 응답은 집계·익명 원문으로만 보여준다.
 * 둘을 한 표에 나란히 두지 않는다.
 * 모든 수치는 'n명 중 m명'으로 쓰고 비율은 보조로만 쓴다.
 */
var AdminViews = (function () {
  var h = Dom.h;
  var icon = Dom.icon;
  // 집계는 state.stats(회차 정의로 만든 createSurveyStats)로 한다
  function pct(m, n) { return n ? Math.round((m / n) * 100) : 0; }
  var TABS = [
    { key: 'overview', label: '응답 현황' },
    { key: 'results', label: '결과 분석' },
    { key: 'texts', label: '주관식 원문' },
    { key: 'roster', label: '참여자 관리' },
    { key: 'settings', label: '설문 설정' },
    { key: 'editor', label: '설문 편집' }
  ];
  var STATE_LABEL = { open: '응답 받는 중', before: '시작 전', after: '종료', off: '응답 받기 꺼짐' };

  function wordmark() {
    return h('div', { class: 'wordmark' }, [h('span', { class: 'spark', 'aria-hidden': 'true' }), 'HSTC 중고차사업부']);
  }

  function spinner() { return h('span', { class: 'spinner', 'aria-hidden': 'true' }); }

  function loadingRow(text) { return h('div', { class: 'loading-row' }, [spinner(), text || '불러오는 중']); }

  function notice(msg) {
    if (!msg) return null;
    return h('div', { class: 'notice', role: 'alert', style: { marginTop: '12px' } }, [icon('alert', 18), h('span', { text: msg })]);
  }

  // 'n명 중 m명 (xx%)'
  function nm(m, n) {
    return [n + '명 중 ' + m + '명', h('span', null, '(' + pct(m, n) + '%)')];
  }

  function bar(name, m, n, opts) {
    var o = opts || {};
    var ratio = o.max ? m / o.max : (n ? m / n : 0);
    return h('div', { class: 'bar-row' + (o.top ? ' top' : '') }, [
      h('div', { class: 'name', text: name }),
      h('div', { class: 'count' }, o.countText ? o.countText : nm(m, n)),
      h('div', { class: 'bar-track', 'aria-hidden': 'true' }, h('div', { class: 'bar-fill', style: { width: Math.round(ratio * 100) + '%' } }))
    ]);
  }

  function qTitle(q, extra) {
    return h('h3', null, [h('span', { class: 'qid', text: q.id }), q.title, extra || '']);
  }

  /* ── 로그인 ── */
  function login(state, act) {
    return h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' }, [
      wordmark(),
      h('h1', { text: '사내 설문조사 운영 시스템' }),
      h('p', { text: '설문 결과와 참여 현황을 확인하고, 설문을 만들고 운영합니다.' }),
      h('form', { onsubmit: function (e) { e.preventDefault(); act.login(); } }, [
        h('label', { class: 'field-label', for: 'pw' }, '관리자 비밀번호'),
        h('input', {
          id: 'pw', class: 'text-input', type: 'password', autocomplete: 'current-password', value: state.password,
          oninput: function (e) { act.setPassword(e.target.value); }
        }),
        notice(state.loginError),
        h('button', { type: 'submit', class: 'btn btn-primary btn-block', 'aria-busy': state.busy ? 'true' : 'false' },
          state.busy ? [spinner(), '확인 중'] : '로그인')
      ]),
      APP_CONFIG.MOCK ? h('div', { class: 'mock-note' }, ['MOCK 모드 · 비밀번호: ', h('strong', { text: MockServer.ADMIN_PASSWORD })]) : null
    ]));
  }

  /* ── 공통 틀 ── */
  function shell(state, act, content) {
    return h('div', null, [
      h('header', { class: 'adm-header' }, h('div', { class: 'adm-header-in' }, [
        wordmark(),
        h('span', { class: 'title', text: '사내 설문조사 운영 시스템' }),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'hdr-btn', onclick: act.refresh }, '새로고침'),
        h('button', { type: 'button', class: 'hdr-btn', onclick: act.logout }, '로그아웃')
      ])),
      h('nav', { class: 'tabs', 'aria-label': '관리 메뉴' }, h('div', { class: 'tabs-in', role: 'tablist' }, TABS.map(function (t) {
        return h('button', {
          type: 'button', class: 'tab', role: 'tab', 'aria-selected': state.tab === t.key ? 'true' : 'false',
          onclick: function () { act.setTab(t.key); }
        }, t.label);
      }))),
      h('main', { class: 'adm-main' }, [
        APP_CONFIG.MOCK ? h('div', { class: 'mock-note', style: { marginTop: '0', marginBottom: '16px' } }, [
          'MOCK 모드 · 이 브라우저 안의 가짜 데이터입니다. ',
          h('button', { type: 'button', class: 'btn-sm', onclick: act.seedSamples }, '샘플 응답 20건 추가')
        ]) : null,
        notice(state.error),
        content
      ])
    ]);
  }

  /* ── 응답 현황 ── */
  function roundNote(state) {
    var r = state.resultRound;
    if (!r) return null;
    return h('p', { class: 'small', style: { margin: '-8px 0 14px' }, text: '응답 집계 기준: ' + r.id + ' · ' + r.title + ' (' + r.status + ')' });
  }

  function overview(state) {
    var ov = state.overview;
    var list = state.responses;
    var st = state.stats;
    if (!ov || !list) return loadingRow();
    var total = 0;
    var done = 0;
    ov.branches.forEach(function (b) { total += b.total; done += b.done; });
    var s = ov.settings;
    var dates = st ? st.byDate(list) : [];
    var maxDate = dates.reduce(function (m, d) { return Math.max(m, d.count); }, 0);
    var activeId = ov.round ? ov.round.id : '';
    var gq = st && st.groupQuestion;

    return h('div', null, [
      h('div', { class: 'page-head' }, [h('h2', { text: '응답 현황' })]),
      roundNote(state),
      h('div', { class: 'kpis' }, [
        h('div', { class: 'kpi blue' }, [
          h('div', { class: 'lbl', text: '참여 (명부 기준' + (activeId ? ', ' + activeId : '') + ')' }),
          h('div', { class: 'val' }, [total + '명 중 ' + done + '명', h('small', null, pct(done, total) + '%')])
        ]),
        h('div', { class: 'kpi' }, [h('div', { class: 'lbl', text: '응답 건수' + (state.resultRound ? ' (' + state.resultRound.id + ')' : '') }), h('div', { class: 'val' }, [list.length + '건'])]),
        h('div', { class: 'kpi' }, [
          h('div', { class: 'lbl', text: '응답 받기' }),
          h('div', { class: 'val', style: { fontSize: '16px', marginTop: '10px' } }, h('span', { class: 'badge ' + (s.state === 'open' ? 'on' : 'off'), text: STATE_LABEL[s.state] || s.state })),
          h('div', { class: 'small', style: { marginTop: '8px' }, text: ov.round ? ov.round.id + ' · ' + (s.startDate && s.endDate ? s.startDate + ' ~ ' + s.endDate : '기간 미설정') : '진행 중인 회차 없음' })
        ])
      ]),
      state.resultRound && state.resultRound.id === activeId && list.length !== done
        ? h('p', { class: 'small', style: { margin: '-4px 0 16px' }, text: '응답 건수와 참여 완료 수가 다릅니다. 관리자가 초기화한 뒤 다시 응답하면 이전 응답이 남아 응답이 더 많아질 수 있습니다.' }) : null,
      ov.unknownBranch ? notice('명부에 소속이 올바르지 않은 사람이 ' + ov.unknownBranch + '명 있습니다. 스프레드시트 [설문 관리 → 명부 점검]으로 확인해 주세요.') : null,
      h('div', { class: 'grid' }, [
        h('section', { class: 'card' }, [
          h('h3', { text: '소속별 참여' }),
          h('p', { class: 'sub', text: '명부 기준' + (activeId ? ' · 진행 중 회차 ' + activeId : '') }),
          h('div', { class: 'card-body bars' }, ov.branches.map(function (b) { return bar(b.branch, b.done, b.total); }))
        ]),
        gq ? h('section', { class: 'card' }, [
          h('h3', { text: '그룹별 응답 수' }),
          h('p', { class: 'sub', text: gq.id + ' 응답 기준' }),
          h('div', { class: 'card-body bars' }, st.GROUPS.slice(1).map(function (g) {
            return bar(g.short, st.filterByGroup(list, g.key).length, list.length);
          }))
        ]) : null,
        h('section', { class: 'card' }, [
          h('h3', { text: '날짜별 응답 수' }),
          h('div', { class: 'card-body bars' }, dates.length ? dates.map(function (d) {
            return bar(d.date, d.count, list.length, { max: maxDate, countText: d.count + '건' });
          }) : h('div', { class: 'empty', text: '아직 응답이 없습니다.' }))
        ])
      ])
    ]);
  }

  /* ── 결과 분석 ── */
  function roundSelect(state, act) {
    var rounds = (state.rounds || []).filter(function (r) { return r.status !== '작성중'; });
    if (!rounds.length) return null;
    return h('select', { class: 'ed-select', 'aria-label': '회차 선택', onchange: function (e) { act.selectRound(e.target.value); } },
      rounds.slice().reverse().map(function (r) {
        return h('option', { value: r.id, selected: state.resultRound && state.resultRound.id === r.id }, r.id + ' · ' + r.title + ' (' + r.status + ')');
      }));
  }

  function groupSeg(state, act) {
    var st = state.stats;
    if (!st || st.GROUPS.length < 2) return null;
    return h('div', { class: 'seg', role: 'group', 'aria-label': '그룹 필터' }, st.GROUPS.map(function (g) {
      return h('button', { type: 'button', 'aria-pressed': state.group === g.key ? 'true' : 'false', onclick: function () { act.setGroup(g.key); } }, g.short);
    }));
  }

  function hiddenCell() { return h('td', { class: 'num small', text: '3명 미만', title: '응답이 3명 미만인 그룹은 표시하지 않습니다' }); }

  function scaleCard(st, list, q) {
    var r = st.scale(list, q.id);
    var rows = [];
    for (var v = q.max; v >= q.min; v--) rows.push(bar(v + '점' + (q.scaleLabels[v] ? ' · ' + q.scaleLabels[v] : ''), r.counts[v], r.n));
    return h('section', { class: 'card' }, [
      qTitle(q),
      h('div', { class: 'card-body' }, [
        h('div', { class: 'mean' }, [h('b', { text: st.fmtMean(r.mean) }), h('span', { text: '평균 (' + q.min + '~' + q.max + '점) · ' + r.n + '명 응답' })]),
        h('div', { class: 'bars' }, rows)
      ])
    ]);
  }

  function choiceCard(st, list, q) {
    var r = q.type === 'multi' ? st.multi(list, q.id) : st.single(list, q.id);
    var max = Math.max.apply(null, q.options.map(function (o) { return r.counts[o.value]; }));
    return h('section', { class: 'card' }, [
      qTitle(q),
      h('p', { class: 'sub', text: r.n + '명 응답' + (q.type === 'multi' ? ' · 복수 선택(최대 ' + q.maxSelect + '개)' : '') }),
      h('div', { class: 'card-body bars' }, q.options.map(function (o) {
        return bar(o.label, r.counts[o.value], r.n, { top: max > 0 && r.counts[o.value] === max });
      }))
    ]);
  }

  // 항목별 점수: 항목별 평균('해당 없음' 제외)과 높은 점수 인원 — 그룹별로 나란히, 전체 평균 높은 순
  function gridCard(st, all, q) {
    var groups = st.GROUPS;
    var th = st.highThreshold(q);
    var by = {};
    var sizes = {};
    groups.forEach(function (g) {
      var members = st.filterByGroup(all, g.key);
      sizes[g.key] = members.length;
      by[g.key] = st.grid(members, q.id);
    });
    var order = by.all.slice().sort(function (a, b) {
      if (a.mean === null) return 1;
      if (b.mean === null) return -1;
      return b.mean - a.mean || a.index - b.index;
    });
    var head1 = h('tr', null, [h('th', { rowspan: 2, text: '순위' }), h('th', { rowspan: 2, text: '항목' })].concat(groups.map(function (g) {
      return h('th', { class: 'group-head', colspan: 2, text: g.short });
    })));
    var head2 = h('tr', null, groups.reduce(function (acc) {
      return acc.concat([h('th', { class: 'num bl', text: '평균' }), h('th', { class: 'num', text: th + '점 이상' })]);
    }, []));
    var body = order.map(function (it, rank) {
      var cells = [h('td', { class: 'num', text: String(rank + 1) }), h('td', { text: it.label })];
      groups.forEach(function (g) {
        if (st.isHidden(g.key, sizes[g.key])) { cells.push(h('td', { class: 'num small bl', text: '—' })); cells.push(hiddenCell()); return; }
        var x = by[g.key][it.index];
        cells.push(h('td', { class: 'num bl' }, [h('b', { text: st.fmtMean(x.mean) })]));
        cells.push(h('td', { class: 'num' }, [x.n + '명 중 ' + x.high + '명']));
      });
      return h('tr', null, cells);
    });
    return h('section', { class: 'card' }, [
      qTitle(q),
      h('p', { class: 'sub', text: '평균은 ' + (q.na ? '\'' + q.na.label + '\'을 뺀 ' : '') + q.min + '~' + q.max + '점 기준. "' + th + '점 이상"은 ' + (q.na ? '\'' + q.na.label + '\'을 뺀 ' : '') + '응답자 중 그 점수를 고른 인원. 전체 평균이 높은 순.' }),
      h('div', { class: 'card-body table-wrap' }, h('table', null, [h('thead', null, [head1, head2]), h('tbody', null, body)]))
    ]);
  }

  // 복수 선택을 그룹별로 비교
  function multiGroupCard(st, all, q) {
    var groups = st.GROUPS;
    var by = {};
    var sizes = {};
    groups.forEach(function (g) {
      var members = st.filterByGroup(all, g.key);
      sizes[g.key] = members.length;
      by[g.key] = st.multi(members, q.id);
    });
    var order = q.options.slice().sort(function (a, b) { return by.all.counts[b.value] - by.all.counts[a.value] || a.value - b.value; });
    var head = h('tr', null, [h('th', { text: '선택지' })].concat(groups.map(function (g) {
      return h('th', { class: 'num bl', text: g.short + (st.isHidden(g.key, sizes[g.key]) ? '' : ' (' + by[g.key].n + '명)') });
    })));
    var body = order.map(function (o) {
      return h('tr', null, [h('td', { text: o.label })].concat(groups.map(function (g) {
        if (st.isHidden(g.key, sizes[g.key])) return hiddenCell();
        var m = by[g.key].counts[o.value];
        return h('td', { class: 'num bl' }, [h('b', { text: m + '명' }), h('small', { text: '(' + pct(m, by[g.key].n) + '%)' })]);
      })));
    });
    return h('section', { class: 'card' }, [
      qTitle(q),
      h('p', { class: 'sub', text: '복수 선택(최대 ' + q.maxSelect + '개). 괄호 안 머릿수는 그 그룹에서 이 문항에 답한 인원, 비율은 그중 고른 사람. 전체 기준 많은 순.' }),
      h('div', { class: 'card-body table-wrap' }, h('table', null, [h('thead', null, head), h('tbody', null, body)]))
    ]);
  }

  // 교차표: 행(단일 선택) × 열(단일·복수 선택)
  function crossCard(st, list, pair) {
    var rq = st.logic.findQuestion(pair[0]);
    var cq = st.logic.findQuestion(pair[1]);
    if (!rq || !cq) return null;
    var c = st.cross(list, rq.id, cq.id);
    var max = 0;
    c.rows.forEach(function (r) { cq.options.forEach(function (o) { max = Math.max(max, r.counts[o.value]); }); });
    var head = h('tr', null, [h('th', { text: rq.id + ' 답' }), h('th', { class: 'num', text: '인원' })].concat(cq.options.map(function (o) {
      return h('th', { class: 'col', title: o.label, text: o.label });
    })));
    // 행 문항이 그룹 필터 문항(예: 직군·근무지)이면 행 하나가 곧 그룹이다 — 3명 미만 행은 숨긴다
    var rowIsGroup = st.groupQuestion && st.groupQuestion.id === rq.id;
    var body = c.rows.map(function (r) {
      var hideRow = rowIsGroup && r.n < st.MIN_GROUP;
      return h('tr', null, [h('td', { text: r.label }), h('td', { class: 'num', text: r.n + '명' })].concat(cq.options.map(function (o) {
        if (hideRow) return hiddenCell();
        var v = r.counts[o.value];
        if (!v) return h('td', { class: 'num small', text: '·' });
        var alpha = max ? 0.15 + 0.75 * (v / max) : 0;
        return h('td', { class: 'num' }, h('span', {
          class: 'heat', text: String(v),
          style: { background: 'rgba(6, 3, 141, ' + alpha.toFixed(2) + ')', color: alpha > 0.5 ? '#fff' : 'var(--hs-blue)' }
        }));
      })));
    });
    return h('section', { class: 'card' }, [
      h('h3', null, [h('span', { class: 'qid', text: rq.id + ' × ' + cq.id }), rq.title]),
      h('p', { class: 'sub', text: '행: ' + rq.id + '의 답(인원 많은 순). 칸: 그중 ' + cq.id + '(' + cq.title + ')에서 그 선택지를 고른 인원' + (cq.type === 'multi' ? '(복수 선택이라 합계가 인원보다 클 수 있음)' : '') + '.' }),
      c.rows.length
        ? h('div', { class: 'card-body table-wrap cross' }, h('table', null, [h('thead', null, head), h('tbody', null, body)]))
        : h('div', { class: 'empty', text: '응답이 없습니다.' }),
      c.none ? h('p', { class: 'small', style: { marginTop: '10px' }, text: '"' + c.noneLabel + '" ' + c.none + '명 (' + cq.id + '를 건너뜀)' }) : null
    ]);
  }

  function results(state, act) {
    var st = state.stats;
    var all = state.responses;
    if (!all || !st) return loadingRow();
    var hasGroups = st.GROUPS.length > 1;
    var list = st.filterByGroup(all, state.group);
    var hidden = st.isHidden(state.group, list.length);
    var cards = [];
    var small = [];
    function flush() { if (small.length) { cards.push(h('div', { class: 'grid' }, small)); small = []; } }
    if (!hidden) {
      st.def.questions.forEach(function (q) {
        if (q.type === 'text') return;
        if (q.type === 'single') small.push(choiceCard(st, list, q));
        else if (q.type === 'scale') small.push(scaleCard(st, list, q));
        else if (q.type === 'multi' && !hasGroups) small.push(choiceCard(st, list, q));
        else {
          flush();
          cards.push(q.type === 'grid' ? gridCard(st, all, q) : multiGroupCard(st, all, q));
        }
      });
      flush();
      ((st.def.analysis || {}).crosstabs || []).forEach(function (pair) { cards.push(crossCard(st, list, pair)); });
    }
    return h('div', null, [
      h('div', { class: 'page-head' }, [
        h('h2', { text: '결과 분석' }),
        roundSelect(state, act),
        groupSeg(state, act),
        h('span', { class: 'muted', text: '응답 ' + list.length + '건' }),
        h('button', { type: 'button', class: 'btn btn-secondary btn-md', onclick: act.downloadExcel, 'aria-busy': state.excelBusy ? 'true' : 'false' },
          state.excelBusy ? [h('span', { class: 'spinner', style: { borderColor: 'var(--line)', borderTopColor: 'var(--hs-blue)' } }), '만드는 중'] : '엑셀 다운로드')
      ]),
      all.length === 0 ? h('div', { class: 'card empty', text: '아직 응답이 없습니다.' })
        : hidden ? h('div', { class: 'card empty', text: '이 그룹은 응답이 3명 미만이라 결과를 표시하지 않습니다(개인을 알아볼 수 있어서).' })
          : h('div', { class: 'stack' }, [
            hasGroups ? h('p', { class: 'small', text: '항목별 점수·복수 선택 표는 그룹 필터와 관계없이 전체와 그룹을 나란히 보여줍니다. 응답이 3명 미만인 그룹은 숨깁니다.' }) : null
          ].concat(cards))
    ]);
  }

  /* ── 주관식 원문 ── */
  function quoteList(items) {
    if (!items.length) return h('div', { class: 'empty', text: '작성된 내용이 없습니다.' });
    return h('div', { class: 'quotes' }, items.map(function (t) { return h('div', { class: 'quote', text: t }); }));
  }

  function texts(state, act) {
    var all = state.responses;
    var st = state.stats;
    if (!all || !st) return loadingRow();
    var textQs = st.def.questions.filter(function (q) { return q.type === 'text'; });
    var etcQs = st.def.questions.filter(function (q) { return st.logic.etcOption(q); });
    return h('div', null, [
      h('div', { class: 'page-head' }, [h('h2', { text: '주관식 원문' }), roundSelect(state, act)]),
      h('div', { class: 'warn-banner', role: 'note' }, [icon('alert', 20), '개인 식별 정보 삭제 전 원문입니다. 외부 공유 금지']),
      h('p', { class: 'small', style: { margin: '-6px 0 16px' }, text: '원문은 그룹으로 나누지 않고 무작위 순서로 보여줍니다. 보고서에 인용할 때는 이름·고객명·차량번호 등을 지운 뒤 씁니다.' }),
      h('div', { class: 'stack' }, textQs.map(function (q) {
        var items = st.texts(all, q.id);
        return h('section', { class: 'card' }, [qTitle(q), h('p', { class: 'sub', text: items.length + '건' }), h('div', { class: 'card-body' }, quoteList(items))]);
      }).concat(etcQs.length ? [
        h('section', { class: 'card' }, [
          h('h3', { text: '기타(직접 입력)' }),
          h('div', { class: 'card-body stack' }, etcQs.map(function (q) {
            var items = st.texts(all, st.logic.etcKey(q));
            return h('div', null, [h('p', { class: 'muted', style: { marginBottom: '8px' }, text: q.id + '. ' + q.title + ' — ' + items.length + '건' }), quoteList(items)]);
          }))
        ])
      ] : []).concat(!textQs.length && !etcQs.length ? [h('div', { class: 'card empty', text: '이 회차에는 주관식·기타 문항이 없습니다.' })] : []))
    ]);
  }

  /* ── 참여자 관리 ── */
  function roster(state, act) {
    if (!state.roster) return loadingRow('명부를 불러오는 중');
    var f = state.rosterFilter;
    var kw = SurveyLogic.nameKey(f.q);
    var rows = state.roster.filter(function (r) {
      return (!f.branch || r.branch === f.branch) && (!f.status || r.status === f.status) && (!kw || SurveyLogic.nameKey(r.name).indexOf(kw) !== -1);
    });
    var done = state.roster.filter(function (r) { return r.status === '완료'; }).length;
    return h('div', null, [
      h('div', { class: 'page-head' }, [
        h('h2', { text: '참여자 관리' }),
        h('span', { class: 'muted', text: '전체 ' + state.roster.length + '명 중 ' + done + '명 완료' })
      ]),
      h('p', { class: 'small', style: { marginBottom: '14px' }, text: '참여 여부만 표시합니다. 응답 내용은 이름과 연결되어 있지 않아 여기서 볼 수 없습니다. 명부 추가·수정은 스프레드시트 [참여자명부] 탭에서 합니다.' }),
      h('div', { class: 'toolbar' }, [
        h('select', { 'aria-label': '소속', onchange: function (e) { act.setRosterFilter('branch', e.target.value); } },
          [h('option', { value: '' }, '전체 소속')].concat(((state.overview && state.overview.branchList) || []).map(function (b) { return h('option', { value: b, selected: f.branch === b }, b); }))),
        h('select', { 'aria-label': '상태', onchange: function (e) { act.setRosterFilter('status', e.target.value); } }, [
          h('option', { value: '' }, '전체 상태'),
          h('option', { value: '미참여', selected: f.status === '미참여' }, '미참여'),
          h('option', { value: '완료', selected: f.status === '완료' }, '완료')
        ]),
        h('input', { type: 'search', placeholder: '이름 검색', value: f.q, 'aria-label': '이름 검색', 'data-focus': 'roster-q', oninput: function (e) { act.setRosterFilter('q', e.target.value); } }),
        h('span', { class: 'small', text: rows.length + '명 표시' })
      ]),
      h('div', { class: 'table-wrap' }, h('table', null, [
        h('thead', null, h('tr', null, [h('th', { text: '소속' }), h('th', { text: '이름' }), h('th', { text: '상태' }), h('th', { class: 'num', text: '초기화' }), h('th', { text: '' })])),
        h('tbody', null, rows.length ? rows.map(function (r) {
          var isDone = r.status === '완료';
          return h('tr', null, [
            h('td', { text: r.branch }),
            h('td', { text: r.name }),
            h('td', null, h('span', { class: 'status-pill ' + (isDone ? 'done' : 'pending'), text: r.status })),
            h('td', { class: 'num', text: r.resets + '회' }),
            h('td', { class: 'num' }, isDone ? h('button', {
              type: 'button', class: 'btn-sm', disabled: state.resetting === r.row,
              onclick: function () { act.reset(r); }
            }, state.resetting === r.row ? '처리 중' : '초기화') : null)
          ]);
        }) : h('tr', null, h('td', { colspan: 5, class: 'empty', text: '조건에 맞는 사람이 없습니다.' })))
      ]))
    ]);
  }

  /* ── 설문 설정 ── */
  function settings(state, act) {
    var ov = state.overview;
    if (!ov) return loadingRow();
    var st = ov.settings;
    return h('div', null, [
      h('div', { class: 'page-head' }, [h('h2', { text: '설문 설정' })]),
      h('div', { class: 'grid' }, [
        h('section', { class: 'card' }, [
          h('h3', { text: '응답 받기' }),
          h('div', { class: 'card-body' }, [
            h('span', { class: 'badge ' + (st.state === 'open' ? 'on' : 'off'), text: STATE_LABEL[st.state] || st.state }),
            h('p', { class: 'sub', style: { marginTop: '10px' }, text: st.accepting
              ? '응답 받기가 켜져 있습니다. 설문 기간 안에만 응답할 수 있습니다.'
              : '응답 받기가 꺼져 있습니다. 직원이 접속하면 "지금은 응답을 받고 있지 않습니다" 화면이 나옵니다.' }),
            h('div', { class: 'btn-row' }, h('button', {
              type: 'button', class: 'btn ' + (st.accepting ? 'btn-secondary' : 'btn-primary') + ' btn-md', onclick: act.toggleAccepting,
              'aria-busy': state.toggling ? 'true' : 'false'
            }, state.toggling ? '바꾸는 중' : (st.accepting ? '응답 받기 끄기' : '응답 받기 켜기')))
          ])
        ]),
        h('section', { class: 'card' }, [
          h('h3', { text: '설정값' }),
          h('dl', { class: 'kv card-body' }, [
            h('dt', null, '설문 기간'), h('dd', { text: st.startDate && st.endDate ? st.startDate + ' ~ ' + st.endDate : '미설정' }),
            h('dt', null, '결과 공유 월'), h('dd', { text: st.shareMonth || '미설정' }),
            h('dt', null, '문항 버전'), h('dd', { text: ov.version })
          ]),
          h('p', { class: 'sub', style: { marginTop: '14px' }, text: '기간·결과 공유 월·관리자 비밀번호는 스프레드시트 [설문 관리] 메뉴에서 바꿉니다.' })
        ]),
        h('section', { class: 'card' }, [
          h('h3', { text: '엑셀 다운로드' }),
          h('p', { class: 'sub', text: '시트 1: 응답 원본(1행 1응답, Q4는 13열, 복수 선택은 쉼표로 이은 코드). 시트 2: 문항 코드표. 명부는 포함하지 않습니다.' }),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-secondary btn-md', onclick: act.downloadExcel }, state.excelBusy ? '만드는 중' : '엑셀 다운로드'))
        ])
      ])
    ]);
  }

  function app(state, act) {
    if (state.tab === 'editor') return shell(state, act, EditorViews.render(state, act.ed));
    var content = { overview: overview, results: results, texts: texts, roster: roster, settings: settings }[state.tab] || overview;
    return shell(state, act, content(state, act));
  }

  return { login: login, app: app, TABS: TABS };
})();
