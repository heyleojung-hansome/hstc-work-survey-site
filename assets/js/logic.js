/*
 * 설문 흐름·검증 로직 — 화면(DOM)과 무관한 순수 함수만 둔다.
 * 브라우저(설문 화면, MOCK 서버), Node(테스트), GAS(2단계 서버 검증)에서 같은 코드를 쓴다.
 *
 * 응답(answers) 형태:
 *   single/scale: 숫자 코드           예) answers.Q3 = 2
 *   grid(Q4):     항목 수 길이의 배열  예) answers.Q4 = [3, 0, 5, ...]  (0 = 해당 없음, null = 미응답)
 *   multi:        숫자 코드 배열       예) answers.Q6 = [1, 12]
 *   기타 입력:     '<문항ID>_etc' 문자열 예) answers.Q6_etc = '...'
 *   text:         문자열              예) answers.Q12 = '...'
 */
/*
 * createSurveyLogic(def): 설문 정의(def)를 받아 그 정의에 맞는 로직 묶음을 만든다.
 * 회차마다 정의가 다르므로 서버·화면은 회차 정의로 로직을 만들어 쓴다.
 * SurveyLogic은 기본 템플릿(questions.js의 SURVEY_DEF)으로 만든 것이다.
 */
function createSurveyLogic(def) {
  function getDef() { return def; }

  function findQuestion(id) {
    var list = getDef().questions;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function findOption(q, value) {
    if (!q.options) return null;
    for (var i = 0; i < q.options.length; i++) if (q.options[i].value === value) return q.options[i];
    return null;
  }

  function etcKey(q) { return q.id + '_etc'; }

  function etcOption(q) {
    if (!q.options) return null;
    for (var i = 0; i < q.options.length; i++) if (q.options[i].etc) return q.options[i];
    return null;
  }

  // 분기 조건: 조건 문항이 아직 미응답이면 '보인다'로 본다(앞 문항부터 차례로 답하므로).
  function isVisible(q, answers) {
    var c = q.showIf;
    if (!c) return true;
    var v = answers[c.question];
    if (v === undefined || v === null) return true;
    if (c.notEquals !== undefined) return v !== c.notEquals;
    if (c.equals !== undefined) return v === c.equals;
    return true;
  }

  // 화면 단계 목록. Q4는 항목마다 한 단계다.
  function buildSteps(answers) {
    var steps = [];
    getDef().questions.forEach(function (q) {
      if (!isVisible(q, answers)) return;
      if (q.type === 'grid') {
        for (var i = 0; i < q.items.length; i++) steps.push({ key: q.id + '#' + (i + 1), qid: q.id, item: i });
      } else {
        steps.push({ key: q.id, qid: q.id, item: null });
      }
    });
    return steps;
  }

  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function cleanText(s) { return typeof s === 'string' ? s.trim() : ''; }

  // 이름 정리(보여주기·전송용): 앞뒤 공백 제거, 연속 공백은 하나로.
  function normalizeName(s) {
    return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  // 명부 대조용 키: 띄어쓰기를 무시한다('홍 길동' = '홍길동'). 사용자 결정 2026-11-21.
  function nameKey(s) {
    return String(s === undefined || s === null ? '' : s).replace(/\s+/g, '');
  }

  /*
   * 응답 시트 열 순서(문항 ID 기준 고정). 앞의 두 열은 응답ID, 제출일.
   * Q4는 항목마다 한 열(Q4_1~Q4_13), 기타 입력이 있는 문항은 바로 뒤에 '<ID>_etc' 열.
   */
  function responseColumns() {
    var cols = ['응답ID', '제출일'];
    getDef().questions.forEach(function (q) {
      if (q.type === 'grid') {
        for (var i = 1; i <= q.items.length; i++) cols.push(q.id + '_' + i);
      } else {
        cols.push(q.id);
      }
      if (etcOption(q)) cols.push(etcKey(q));
    });
    return cols;
  }

  /*
   * 검증을 마친 응답(validateAnswers의 data)을 시트 한 행의 값 배열로 바꾼다(응답ID·제출일 제외).
   * 복수 선택은 '1,3'처럼 쉼표로 잇고, 숨겨진 문항(Q6 건너뜀)·미작성은 빈 칸.
   */
  function answersToCells(clean) {
    var cells = [];
    getDef().questions.forEach(function (q) {
      var v = clean[q.id];
      if (q.type === 'grid') {
        for (var i = 0; i < q.items.length; i++) cells.push(Array.isArray(v) ? v[i] : '');
      } else if (q.type === 'multi') {
        cells.push(Array.isArray(v) ? v.join(',') : '');
      } else {
        cells.push(v === undefined || v === null ? '' : v);
      }
      if (etcOption(q)) cells.push(clean[etcKey(q)] || '');
    });
    return cells;
  }

  /*
   * 한 단계(문항 또는 Q4 항목)의 응답이 다음으로 넘어갈 만큼 갖춰졌는지 확인한다.
   * 반환: null(통과) 또는 사용자에게 보여줄 오류 문구.
   */
  function checkStep(step, answers) {
    var q = findQuestion(step.qid);
    var max = getDef().textMaxLength;
    var v = answers[q.id];

    if (q.type === 'grid') {
      var arr = Array.isArray(v) ? v : [];
      var iv = arr[step.item];
      if (!isInt(iv)) return '하나를 골라 주세요.';
      return null;
    }
    if (q.type === 'single' || q.type === 'scale') {
      if (!isInt(v)) return '하나를 골라 주세요.';
    }
    if (q.type === 'multi') {
      if (!Array.isArray(v) || v.length === 0) return '하나 이상 골라 주세요.';
      if (v.length > q.maxSelect) return '최대 ' + q.maxSelect + '개까지 고를 수 있습니다.';
    }
    if (q.type === 'text') {
      if (cleanText(v).length > max) return max.toLocaleString() + '자 이하로 적어 주세요.';
      return null;
    }
    // 기타 입력
    var etc = etcOption(q);
    if (etc && isSelected(q, answers, etc.value)) {
      var t = cleanText(answers[etcKey(q)]);
      if (!t) return '기타 내용을 적어 주세요.';
      if (t.length > max) return max.toLocaleString() + '자 이하로 적어 주세요.';
    }
    return null;
  }

  function isSelected(q, answers, value) {
    var v = answers[q.id];
    if (q.type === 'multi') return Array.isArray(v) && v.indexOf(value) !== -1;
    return v === value;
  }

  /*
   * 복수 선택 토글. 최대 개수·단독 선택(exclusive)을 반영한 새 배열을 돌려준다.
   * 반환: { values, error } — error가 있으면 values는 바뀌지 않은 원래 값이다.
   */
  function toggleMulti(q, current, value) {
    var values = Array.isArray(current) ? current.slice() : [];
    var idx = values.indexOf(value);
    if (idx !== -1) {
      values.splice(idx, 1);
      return { values: values, error: null };
    }
    var opt = findOption(q, value);
    if (!opt) return { values: values, error: null };
    if (opt.exclusive) return { values: [value], error: null };
    // 단독 선택지가 골라져 있으면 해제하고 새 값을 넣는다.
    values = values.filter(function (x) {
      var o = findOption(q, x);
      return !(o && o.exclusive);
    });
    if (values.length >= q.maxSelect) {
      return {
        values: Array.isArray(current) ? current.slice() : [],
        error: '최대 ' + q.maxSelect + '개까지 고를 수 있습니다. 다른 항목을 먼저 해제해 주세요.'
      };
    }
    values.push(value);
    return { values: values, error: null };
  }

  /*
   * 제출 전 전체 검증(서버도 같은 함수로 다시 검증한다).
   * 정의에 있는 값만 골라 새 객체를 만들고, 숨겨진 문항·쓰지 않는 기타 입력은 버린다.
   * 반환: { ok: true, data: 정리된 응답 } 또는 { ok: false, error: 문구 }
   */
  function validateAnswers(input) {
    var answers = input && typeof input === 'object' ? input : {};
    var def = getDef();
    var max = def.textMaxLength;
    var clean = {};

    for (var i = 0; i < def.questions.length; i++) {
      var q = def.questions[i];
      var label = q.id.replace('Q', '') + '번 문항';
      if (!isVisible(q, answers)) continue;
      var v = answers[q.id];

      if (q.type === 'single') {
        if (!isInt(v) || !findOption(q, v)) return fail(label + '에 답해 주세요.');
        clean[q.id] = v;
      } else if (q.type === 'scale') {
        if (!isInt(v) || v < q.min || v > q.max) return fail(label + '에 답해 주세요.');
        clean[q.id] = v;
      } else if (q.type === 'grid') {
        if (!Array.isArray(v) || v.length !== q.items.length) return fail(label + '의 모든 항목에 답해 주세요.');
        for (var j = 0; j < v.length; j++) {
          var ok = isInt(v[j]) && ((v[j] >= q.min && v[j] <= q.max) || (!!q.na && v[j] === q.na.value));
          if (!ok) return fail(label + '의 모든 항목에 답해 주세요.');
        }
        clean[q.id] = v.slice();
      } else if (q.type === 'multi') {
        if (!Array.isArray(v) || v.length === 0) return fail(label + '에 답해 주세요.');
        if (v.length > q.maxSelect) return fail(label + '은 최대 ' + q.maxSelect + '개까지 고를 수 있습니다.');
        var seen = {};
        var hasExclusive = false;
        for (var k = 0; k < v.length; k++) {
          var o = isInt(v[k]) ? findOption(q, v[k]) : null;
          if (!o || seen[v[k]]) return fail(label + '의 선택이 올바르지 않습니다.');
          seen[v[k]] = true;
          if (o.exclusive) hasExclusive = true;
        }
        if (hasExclusive && v.length > 1) return fail(label + '에서 "' + exclusiveLabel(q) + '"은 다른 항목과 함께 고를 수 없습니다.');
        // 코드 순서로 정렬해 저장한다(응답 순서로 개인을 추정할 여지를 줄임).
        clean[q.id] = v.slice().sort(function (a, b) { return a - b; });
      } else if (q.type === 'text') {
        if (v !== undefined && v !== null && typeof v !== 'string') return fail(label + '의 입력이 올바르지 않습니다.');
        var t = cleanText(v);
        if (t.length > max) return fail(label + '은 ' + max.toLocaleString() + '자 이하로 적어 주세요.');
        clean[q.id] = t;
      }

      var etc = etcOption(q);
      if (etc && isSelected(q, clean, etc.value)) {
        var et = cleanText(answers[etcKey(q)]);
        if (!et) return fail(label + '의 기타 내용을 적어 주세요.');
        if (et.length > max) return fail(label + '의 기타 내용은 ' + max.toLocaleString() + '자 이하로 적어 주세요.');
        clean[etcKey(q)] = et;
      }
    }
    return { ok: true, data: clean };
  }

  /*
   * 문항 코드표 행: [열, 문항, 값, 뜻]. 스프레드시트 '코드표' 탭과 관리자 엑셀 시트 2가 같이 쓴다.
   */
  function codeTableRows() {
    var def = getDef();
    var rows = [['열', '문항', '값', '뜻']];
    rows.push(['응답ID', '무작위 문자열 (명부와 연결되지 않음)', '', '']);
    rows.push(['제출일', '제출한 날짜 (시각 없음)', '', '']);
    function scaleDesc(q) {
      return Object.keys(q.scaleLabels).map(function (k) { return k + ' = ' + q.scaleLabels[k]; }).join(', ');
    }
    def.questions.forEach(function (q) {
      var title = q.id + '. ' + q.title;
      if (q.type === 'grid') {
        q.items.forEach(function (it, i) {
          rows.push([q.id + '_' + (i + 1), title + ' — ' + it, q.min + '~' + q.max + (q.na ? ', ' + q.na.value : ''), scaleDesc(q) + (q.na ? ', ' + q.na.value + ' = ' + q.na.label : '')]);
        });
      } else if (q.type === 'scale') {
        rows.push([q.id, title, q.min + '~' + q.max, scaleDesc(q)]);
      } else if (q.type === 'text') {
        rows.push([q.id, title, '글', '선택 응답(빈 칸 = 작성 안 함)']);
      } else {
        q.options.forEach(function (o, i) {
          rows.push([i === 0 ? q.id : '', i === 0 ? title + (q.type === 'multi' ? ' (복수 선택, 최대 ' + q.maxSelect + '개, 쉼표로 구분)' : '') : '', String(o.value), o.label]);
        });
        if (q.showIf) rows.push(['', '', '빈 칸', q.showIf.question + '에서 ' + q.showIf.notEquals + '번을 고르면 건너뜀']);
      }
      var etc = etcOption(q);
      if (etc) rows.push([etcKey(q), q.id + ' 기타 직접 입력', '글', etc.value + '번(기타)을 골랐을 때만']);
    });
    rows.push(['', '', '', '']);
    rows.push(['정의 버전', def.version, '', '']);
    return rows;
  }

  function exclusiveLabel(q) {
    for (var i = 0; i < q.options.length; i++) if (q.options[i].exclusive) return q.options[i].label;
    return '';
  }

  function fail(msg) { return { ok: false, error: msg }; }

  return {
    findQuestion: findQuestion,
    findOption: findOption,
    etcKey: etcKey,
    etcOption: etcOption,
    isVisible: isVisible,
    isSelected: isSelected,
    buildSteps: buildSteps,
    checkStep: checkStep,
    toggleMulti: toggleMulti,
    validateAnswers: validateAnswers,
    normalizeName: normalizeName,
    nameKey: nameKey,
    responseColumns: responseColumns,
    answersToCells: answersToCells,
    codeTableRows: codeTableRows,
    def: def
  };
}

// 기본 템플릿 정의로 만든 로직(브라우저: 전역 SURVEY_DEF, Node: require).
// GAS는 파일을 불러오는 순서가 정해져 있지 않아 여기서 null일 수 있다 — 서버 코드는 SurveyLogic을 쓰지 말고
// 회차 정의로 createSurveyLogic(def)를 만들어 쓴다.
var SurveyLogic = typeof SURVEY_DEF !== 'undefined' ? createSurveyLogic(SURVEY_DEF)
  : (typeof module !== 'undefined' && typeof require === 'function' ? createSurveyLogic(require('./questions.js')) : null);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SurveyLogic;
  module.exports.createSurveyLogic = createSurveyLogic;
}
