/*
 * 설문 정의 검사·구조 비교 — 편집기가 저장한 정의(JSON)를 서버가 받아들이기 전에 확인한다.
 * 브라우저(편집기 미리 검사), Node(테스트), GAS(서버 저장 검사)에서 같은 코드를 쓴다. DOM 없음.
 *
 *   SurveyDefCheck.validate(def)  → { ok: true } 또는 { ok: false, errors: [{ path, message }] }
 *   SurveyDefCheck.signature(def) → 응답 데이터 구조에 영향을 주는 부분만 담은 문자열
 *       (응답이 들어온 회차는 이 값이 바뀌는 저장을 막는다 — '문구만 수정' 규칙)
 */
var SurveyDefCheck = (function () {
  var LIMITS = {
    title: 100, sectionKey: 10, sectionName: 50, sections: 20,
    greeting: 5, paragraph: 500, introItems: 10, introLabel: 30,
    questions: 60, questionTitle: 300, options: 30, optionLabel: 200,
    gridItems: 30, gridItem: 100, scaleLabel: 30, scaleSpan: 10,
    guide: 1000, examples: 5, example: 300, crosstabs: 5, jsonChars: 45000
  };
  var TYPES = ['single', 'multi', 'scale', 'grid', 'text'];
  // 제어 문자(줄바꿈 제외)는 받지 않는다
  var CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/;

  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function validate(def) {
    var errors = [];
    function err(path, message) { errors.push({ path: path, message: message }); }
    function text(path, v, max, required) {
      if (v === undefined || v === null || v === '') {
        if (required) err(path, '내용을 입력해 주세요.');
        return;
      }
      if (typeof v !== 'string') return err(path, '글자여야 합니다.');
      if (required && !v.trim()) return err(path, '내용을 입력해 주세요.');
      if (v.length > max) err(path, max + '자 이하로 줄여 주세요.');
      if (CONTROL.test(v)) err(path, '쓸 수 없는 문자가 들어 있습니다.');
    }

    if (!isObj(def)) return { ok: false, errors: [{ path: '', message: '설문 정의 형식이 올바르지 않습니다.' }] };
    try {
      if (JSON.stringify(def).length > LIMITS.jsonChars) err('', '설문이 너무 큽니다. 문항이나 글을 줄여 주세요.');
    } catch (e) {
      return { ok: false, errors: [{ path: '', message: '설문 정의 형식이 올바르지 않습니다.' }] };
    }

    text('title', def.title, LIMITS.title, true);
    if (!isInt(def.textMaxLength) || def.textMaxLength < 100 || def.textMaxLength > 5000) {
      err('textMaxLength', '주관식 글자 수 한도는 100~5,000 사이여야 합니다.');
    }

    // 섹션
    var sections = def.sections;
    if (!isObj(sections) || !Object.keys(sections).length) {
      err('sections', '섹션이 하나 이상 있어야 합니다.');
      sections = {};
    } else {
      var keys = Object.keys(sections);
      if (keys.length > LIMITS.sections) err('sections', '섹션은 ' + LIMITS.sections + '개까지입니다.');
      keys.forEach(function (k) {
        if (!/^[A-Za-z0-9]{1,10}$/.test(k)) err('sections.' + k, '섹션 기호는 영문·숫자 1~10자여야 합니다.');
        text('sections.' + k, sections[k], LIMITS.sectionName, true);
      });
    }

    // 안내문·완료 문구
    var t = def.texts;
    if (!isObj(t) || !isObj(t.intro)) {
      err('texts', '안내문 형식이 올바르지 않습니다.');
    } else {
      var g = t.intro.greeting;
      if (!Array.isArray(g) || g.length > LIMITS.greeting) err('texts.intro.greeting', '인사 문단은 ' + LIMITS.greeting + '개까지입니다.');
      else g.forEach(function (p, i) { text('texts.intro.greeting.' + i, p, LIMITS.paragraph, true); });
      var items = t.intro.items;
      if (!Array.isArray(items) || items.length > LIMITS.introItems) err('texts.intro.items', '안내 항목은 ' + LIMITS.introItems + '개까지입니다.');
      else items.forEach(function (it, i) {
        if (!isObj(it)) return err('texts.intro.items.' + i, '안내 항목 형식이 올바르지 않습니다.');
        text('texts.intro.items.' + i + '.label', it.label, LIMITS.introLabel, true);
        text('texts.intro.items.' + i + '.text', it.text, LIMITS.paragraph, true);
      });
      text('texts.intro.closing', t.intro.closing, LIMITS.paragraph, false);
      text('texts.done', t.done, LIMITS.paragraph, true);
    }

    // 문항
    var qs = def.questions;
    if (!Array.isArray(qs) || !qs.length) {
      err('questions', '문항이 하나 이상 있어야 합니다.');
      qs = [];
    }
    if (qs.length > LIMITS.questions) err('questions', '문항은 ' + LIMITS.questions + '개까지입니다.');
    var seen = {};
    var byId = {};
    qs.forEach(function (q, i) {
      var path = 'questions.' + i;
      if (!isObj(q)) return err(path, '문항 형식이 올바르지 않습니다.');
      if (typeof q.id !== 'string' || !/^Q[1-9][0-9]{0,2}$/.test(q.id)) err(path + '.id', '문항 번호 형식이 올바르지 않습니다.');
      else if (seen[q.id]) err(path + '.id', '문항 번호 ' + q.id + '가 중복됩니다.');
      seen[q.id] = true;
      if (TYPES.indexOf(q.type) === -1) return err(path + '.type', '문항 형식을 골라 주세요.');
      if (!Object.prototype.hasOwnProperty.call(sections, q.section)) err(path + '.section', '섹션을 골라 주세요.');
      text(path + '.title', q.title, LIMITS.questionTitle, true);
      if (typeof q.required !== 'boolean') err(path + '.required', '필수 여부가 필요합니다.');

      if (q.type === 'single' || q.type === 'multi') checkOptions(q, path);
      if (q.type === 'scale' || q.type === 'grid') checkScale(q, path);
      if (q.type === 'grid') checkGrid(q, path);
      if (q.type === 'text') {
        if (q.required) err(path + '.required', '주관식은 선택 응답으로만 만들 수 있습니다.');
        text(path + '.guide', q.guide, LIMITS.guide, false);
        if (q.examples !== undefined) {
          if (!Array.isArray(q.examples) || q.examples.length > LIMITS.examples) err(path + '.examples', '예시는 ' + LIMITS.examples + '개까지입니다.');
          else q.examples.forEach(function (ex, j) { text(path + '.examples.' + j, ex, LIMITS.example, true); });
        }
      }
      // 건너뛰기 조건: 앞에 있는 단일 선택 문항의 실제 선택지를 가리켜야 한다
      if (q.showIf !== undefined) {
        var c = q.showIf;
        var src = isObj(c) ? byId[c.question] : null;
        if (!src) err(path + '.showIf', '건너뛰기 조건은 이 문항보다 앞에 있는 문항을 골라야 합니다.');
        else if (src.type !== 'single') err(path + '.showIf', '건너뛰기 조건은 단일 선택 문항만 쓸 수 있습니다.');
        else {
          var v = c.notEquals !== undefined ? c.notEquals : c.equals;
          var hasOne = (c.notEquals !== undefined) !== (c.equals !== undefined);
          if (!hasOne || !isInt(v) || !(src.options || []).some(function (o) { return o.value === v; })) {
            err(path + '.showIf', '건너뛰기 조건의 선택지가 올바르지 않습니다.');
          }
        }
      }
      if (typeof q.id === 'string') byId[q.id] = q;
    });

    function checkOptions(q, path) {
      var opts = q.options;
      if (!Array.isArray(opts) || !opts.length) return err(path + '.options', '선택지가 하나 이상 있어야 합니다.');
      if (opts.length > LIMITS.options) err(path + '.options', '선택지는 ' + LIMITS.options + '개까지입니다.');
      var values = {};
      var etcCount = 0;
      opts.forEach(function (o, j) {
        var p = path + '.options.' + j;
        if (!isObj(o)) return err(p, '선택지 형식이 올바르지 않습니다.');
        if (!isInt(o.value) || o.value < 1) err(p + '.value', '선택지 코드가 올바르지 않습니다.');
        else if (values[o.value]) err(p + '.value', '선택지 코드가 중복됩니다.');
        values[o.value] = true;
        text(p + '.label', o.label, LIMITS.optionLabel, true);
        if (o.etc) etcCount++;
        if (o.exclusive && q.type !== 'multi') err(p, '"단독 선택"은 복수 선택 문항에서만 쓸 수 있습니다.');
        if (o.exclusive && o.etc) err(p, '"기타"와 "단독 선택"을 함께 쓸 수 없습니다.');
        if (o.none && q.type !== 'single') err(p, '"해당 없음 표시"는 단일 선택 문항에서만 쓸 수 있습니다.');
      });
      if (etcCount > 1) err(path + '.options', '"기타(직접 입력)"는 한 문항에 하나만 둘 수 있습니다.');
      if (q.type === 'multi') {
        if (!isInt(q.maxSelect) || q.maxSelect < 1 || q.maxSelect > opts.length) {
          err(path + '.maxSelect', '최대 선택 수는 1부터 선택지 수 사이여야 합니다.');
        }
      }
    }

    function checkScale(q, path) {
      if (!isInt(q.min) || !isInt(q.max) || q.min >= q.max || q.max - q.min > LIMITS.scaleSpan || q.min < 0) {
        return err(path + '.min', '점수 범위가 올바르지 않습니다(예: 1~5).');
      }
      if (!isObj(q.scaleLabels)) return err(path + '.scaleLabels', '점수 라벨 형식이 올바르지 않습니다.');
      Object.keys(q.scaleLabels).forEach(function (k) {
        var n = Number(k);
        if (!isInt(n) || n < q.min || n > q.max) err(path + '.scaleLabels.' + k, '점수 라벨이 범위 밖에 있습니다.');
        text(path + '.scaleLabels.' + k, q.scaleLabels[k], LIMITS.scaleLabel, true);
      });
    }

    function checkGrid(q, path) {
      if (!Array.isArray(q.items) || !q.items.length) return err(path + '.items', '항목이 하나 이상 있어야 합니다.');
      if (q.items.length > LIMITS.gridItems) err(path + '.items', '항목은 ' + LIMITS.gridItems + '개까지입니다.');
      q.items.forEach(function (it, j) { text(path + '.items.' + j, it, LIMITS.gridItem, true); });
      if (q.na !== undefined) {
        if (!isObj(q.na) || !isInt(q.na.value) || (q.na.value >= q.min && q.na.value <= q.max)) {
          err(path + '.na', '"해당 없음" 값은 점수 범위 밖의 숫자여야 합니다.');
        } else {
          text(path + '.na.label', q.na.label, LIMITS.scaleLabel, true);
        }
      }
    }

    // 분석 설정
    if (def.analysis !== undefined) {
      var a = def.analysis;
      if (!isObj(a)) err('analysis', '분석 설정 형식이 올바르지 않습니다.');
      else {
        if (a.groupBy !== undefined && a.groupBy !== null && a.groupBy !== '') {
          var gq = byId[a.groupBy];
          if (!gq || gq.type !== 'single') err('analysis.groupBy', '그룹 필터는 단일 선택 문항이어야 합니다.');
        }
        if (a.crosstabs !== undefined) {
          if (!Array.isArray(a.crosstabs) || a.crosstabs.length > LIMITS.crosstabs) err('analysis.crosstabs', '교차표는 ' + LIMITS.crosstabs + '개까지입니다.');
          else a.crosstabs.forEach(function (pair, k) {
            var r = Array.isArray(pair) ? byId[pair[0]] : null;
            var c = Array.isArray(pair) ? byId[pair[1]] : null;
            if (!r || !c || r.type !== 'single' || (c.type !== 'single' && c.type !== 'multi') || r === c) {
              err('analysis.crosstabs.' + k, '교차표는 [단일 선택 문항, 선택 문항] 조합이어야 합니다.');
            }
          });
        }
        if (a.highThreshold !== undefined && !isInt(a.highThreshold)) err('analysis.highThreshold', '높은 점수 기준이 올바르지 않습니다.');
      }
    }

    return errors.length ? { ok: false, errors: errors } : { ok: true };
  }

  /*
   * 응답 데이터 구조에 영향을 주는 부분만 뽑은 서명.
   * 포함: 문항 순서·번호·형식·필수, 선택지 코드와 기타·단독·해당 없음 표시, 최대 선택 수, 점수 범위,
   *       항목 수, '해당 없음' 값, 건너뛰기 조건, 주관식 글자 수 한도.
   * 제외(바꿔도 됨): 모든 문구, 선택지·항목의 글자, 섹션, 안내문, 분석 설정, 선택지의 보이는 순서.
   */
  function signature(def) {
    var qs = (def && def.questions) || [];
    return JSON.stringify({
      textMaxLength: def && def.textMaxLength,
      questions: qs.map(function (q) {
        return {
          id: q.id, type: q.type, required: !!q.required,
          options: (q.options || []).map(function (o) {
            return [o.value, !!o.etc, !!o.exclusive, !!o.none];
          }).sort(function (a, b) { return a[0] - b[0]; }),
          maxSelect: q.maxSelect || null,
          range: q.type === 'scale' || q.type === 'grid' ? [q.min, q.max] : null,
          items: q.type === 'grid' ? (q.items || []).length : null,
          na: q.na ? q.na.value : null,
          showIf: q.showIf || null
        };
      })
    });
  }

  return { validate: validate, signature: signature, LIMITS: LIMITS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SurveyDefCheck;
