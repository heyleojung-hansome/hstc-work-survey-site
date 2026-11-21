/*
 * 설문 문항 정의 — 문항 ID, 유형, 선택지, 최대 선택 수, 분기를 이 한 곳에서 정의한다.
 *
 * - 모든 문구는 spec/survey-spec.md와 글자 그대로 같아야 한다(scripts/check-spec.mjs로 검사).
 * - 선택지 value는 화면에 보이는 순서대로 1부터 매긴 고정 코드다. 응답 시트·엑셀 코드표가 이 값을 쓴다.
 *   한 번 응답을 받기 시작하면 value를 바꾸거나 순서를 끼워 넣지 않는다.
 * - 이 파일은 브라우저, Node(검사 스크립트), GAS(2단계)에서 같이 읽을 수 있게
 *   DOM·모듈 문법 없이 전역 변수 하나(SURVEY_DEF)만 만든다.
 */
var SURVEY_DEF = (function () {
  // 정의가 바뀌면 올린다. 저장된 임시 응답(sessionStorage)과 서버 정의 일치 확인에 쓴다.
  var VERSION = '2026-11-21.1';

  // Q4 항목 — Q5 선택지 1~13과 같은 순서·같은 코드다(교차 분석용).
  var BURDEN_ITEMS = [
    '업무량·시간 압박',
    '반복·중복 업무',
    '복잡한 절차·규정',
    '업무 기준의 불명확함·잦은 변경',
    '전산 시스템 사용·정보 조회',
    '승인·결재 대기',
    '부서·직원 간 협업과 소통',
    '역할·책임 구분',
    '업무 지시·피드백의 명확성',
    '업무 교육·지원',
    '고객 응대·외부 업무',
    '근무 환경·시설·장비',
    '평가·보상'
  ];

  // ['라벨', ...] → [{ value: 1, label }, ...]
  function opts(labels) {
    return labels.map(function (label, i) { return { value: i + 1, label: label }; });
  }

  var q5Options = opts(BURDEN_ITEMS).concat([
    { value: 14, label: '기타(직접 입력)', etc: true },
    { value: 15, label: '특별한 어려움 없음', none: true }
  ]);

  var questions = [
    // A. 기본 정보
    {
      id: 'Q1', section: 'A', type: 'single', required: true,
      title: '현재 담당 직무는 무엇입니까?',
      options: opts(['영업직', '관리·지원직 (지점 관리직, 운영팀)'])
    },

    // B. 전반적인 업무 상황
    {
      id: 'Q2', section: 'B', type: 'scale', required: true,
      title: '업무 방식, 절차, 시스템, 협업 등을 모두 고려할 때, 현재 업무 환경에 전반적으로 얼마나 만족하십니까?',
      min: 1, max: 5,
      scaleLabels: { 1: '매우 불만족', 5: '매우 만족' }
    },
    {
      id: 'Q3', section: 'B', type: 'single', required: true,
      title: '최근 1개월 동안 업무 중 어려움이나 불편함을 얼마나 자주 느끼셨습니까?',
      options: opts(['거의 매일', '주 2~3회', '주 1회 정도', '월 1~2회', '거의 없음'])
    },

    // C. 업무 부담
    {
      id: 'Q4', section: 'C', type: 'grid', required: true,
      title: '다음 항목이 현재 업무 수행에 얼마나 부담이 됩니까?',
      items: BURDEN_ITEMS,
      min: 1, max: 5,
      scaleLabels: { 1: '전혀 부담 없음', 3: '보통', 5: '매우 부담됨' },
      na: { value: 0, label: '해당 없음' }
    },
    {
      id: 'Q5', section: 'C', type: 'single', required: true,
      title: '위 항목 중 현재 가장 큰 어려움 1가지를 고르세요.',
      options: q5Options
    },

    // D. 어려움의 원인 — Q5에서 '특별한 어려움 없음'(15)을 고르면 건너뛴다.
    {
      id: 'Q6', section: 'D', type: 'multi', required: true, maxSelect: 2,
      title: '앞에서 고른 어려움이 생기는 주된 이유는 무엇이라고 생각하십니까?',
      showIf: { question: 'Q5', notEquals: 15 },
      options: opts([
        '처리할 업무량에 비해 인력·시간이 부족하다',
        '불필요하거나 중복되는 단계가 있다',
        '기준·규정이 복잡하거나 자주 바뀐다',
        '같은 업무도 사람이나 지점마다 기준이 다르게 적용된다',
        '시스템 기능이 부족하거나 사용이 불편하다',
        '필요한 정보가 여러 곳에 흩어져 있다',
        '누가 담당하고 결정하는지 불분명하다',
        '판단·승인을 기다리는 시간이 길다',
        '다른 담당자·부서의 협조가 원활하지 않다',
        '업무 방법에 대한 안내·교육이 부족하다',
        '고객 요구 등 외부 요인 때문이다'
      ]).concat([{ value: 12, label: '기타(직접 입력)', etc: true }])
    },

    // E. 업무에 미치는 영향
    {
      id: 'Q7', section: 'E', type: 'multi', required: true, maxSelect: 3,
      title: '업무상 어려움이 실제 업무에 어떤 영향을 주고 있습니까?',
      options: opts([
        '업무 처리 시간 증가',
        '오류·재작업 발생',
        '고객 응대·영업 활동 시간 감소',
        '업무 지연·누락',
        '야근·추가 근무',
        '직원 간 갈등·협업 저하',
        '스트레스·업무 의욕 저하'
      ]).concat([
        // '특별한 영향 없음'을 고르면 다른 선택지는 해제한다.
        { value: 8, label: '특별한 영향 없음', exclusive: true },
        { value: 9, label: '기타(직접 입력)', etc: true }
      ])
    },
    {
      id: 'Q8', section: 'E', type: 'single', required: true,
      title: '불필요하거나 비효율적인 업무 때문에 하루 평균 추가로 쓰는 시간은 어느 정도입니까?',
      options: opts(['거의 없음', '10분 이내', '11~30분', '31~60분', '1~2시간', '2시간 초과', '판단하기 어려움'])
    },

    // F. 개선 방향
    {
      id: 'Q9', section: 'F', type: 'multi', required: true, maxSelect: 2,
      title: '회사가 가장 먼저 개선해야 할 것은 무엇이라고 생각하십니까?',
      options: opts([
        '불필요·중복 업무 축소',
        '업무 절차·결재 단계 간소화',
        '명확하고 일관된 업무 기준·매뉴얼 마련',
        '전산 시스템 개선·반복 작업 자동화',
        '필요한 정보를 한 곳에서 조회',
        '담당자·책임 구분 명확화',
        '부서 간 협업·소통 방식 개선',
        '직무별 실무 교육·업무 문의 지원',
        '업무량·인력 운영 조정',
        '근무 환경·장비 개선',
        '평가·보상 체계 개선'
      ]).concat([{ value: 12, label: '기타(직접 입력)', etc: true }])
    },
    {
      id: 'Q10', section: 'F', type: 'scale', required: true,
      title: '업무 개선 의견을 내거나 문제를 제기하기 쉬운 분위기라고 생각하십니까?',
      min: 1, max: 5,
      scaleLabels: { 1: '전혀 그렇지 않다', 5: '매우 그렇다' }
    },
    {
      id: 'Q11', section: 'F', type: 'single', required: true,
      title: '그동안 제기된 업무 불편이나 개선 의견에 대해 회사가 적절히 대응해 왔다고 느끼십니까?',
      options: opts(['매우 그렇다', '대체로 그렇다', '보통이다', '별로 그렇지 않다', '전혀 그렇지 않다', '의견을 제기한 적이 없다'])
    },

    // G. 구체적인 의견 (모두 선택 응답)
    {
      id: 'Q12', section: 'G', type: 'text', required: false,
      title: '최근 1개월 동안 가장 불편하거나 힘들었던 업무 사례 1가지를 적어 주세요.',
      guide: '어떤 업무·상황이었는지, 무엇이 어려웠는지, 어떤 영향이 있었는지, 어떻게 바뀌면 좋을지 적어 주세요. 이름, 고객명, 차량번호처럼 특정할 수 있는 정보는 빼고 적어 주세요.',
      examples: [
        '같은 건인데 담당자마다 처리 기준이 달라서 다시 확인하느라 시간이 걸립니다.',
        '승인이 필요한 건이 몰리면 결재가 늦어져 고객에게 제때 답을 못 드립니다.',
        '필요한 자료가 여러 파일에 나뉘어 있어 찾는 데 오래 걸립니다.'
      ]
    },
    {
      id: 'Q13', section: 'G', type: 'text', required: false,
      title: '지금 잘 운영되고 있어서 바뀌지 않았으면 하는 것이 있다면 적어 주세요.'
    },
    {
      id: 'Q14', section: 'G', type: 'text', required: false,
      title: '그 밖에 회사가 꼭 알아야 할 내용이 있다면 자유롭게 적어 주세요.'
    }
  ];

  return {
    title: '업무환경·프로세스 개선 설문',
    version: VERSION,
    textMaxLength: 2000, // 주관식·기타 입력 최대 글자 수
    branches: ['죽전', '하남', '천안', '운영팀'],
    sections: {
      A: '기본 정보',
      B: '전반적인 업무 상황',
      C: '업무 부담',
      D: '어려움의 원인',
      E: '업무에 미치는 영향',
      F: '개선 방향',
      G: '구체적인 의견'
    },
    texts: {
      intro: {
        greeting: [
          '안녕하세요. 중고차사업부 본부입니다.',
          '여러분이 업무 중에 겪는 어려움과 그 원인을 정확히 파악하고, 무엇부터 개선할지 정하기 위해 설문을 진행합니다.'
        ],
        items: [
          { key: 'time', label: '응답 시간', text: '약 7~10분' },
          { key: 'period', label: '응답 기간', text: '○월 ○일(○) ~ ○월 ○일(○)' },
          { key: 'anonymity', label: '익명 보장', text: '이름과 소속은 중복 참여를 막는 데만 사용하며, 응답 내용과 연결해 저장하지 않습니다.' },
          { key: 'scope', label: '열람 범위', text: '응답 원문은 중고차사업부 본부와 인사팀만 확인합니다. 결과는 집계 형태로 공유하며, 주관식 응답은 개인을 알아볼 수 있는 내용을 삭제한 뒤 인용합니다.' },
          { key: 'share', label: '결과 공유', text: '설문 결과 요약과 개선 계획을 ○월 중 공유하겠습니다.' }
        ],
        closing: '정해진 답은 없습니다. "특별한 어려움 없음"도 중요한 응답입니다. 평소 느낀 그대로 답해 주세요.'
      },
      done: '응답해 주셔서 감사합니다. 결과와 개선 계획은 ○월 중 공유하겠습니다.'
    },
    questions: questions,
    // 결과 분석 설정: 그룹 필터 문항(직군), 교차표(가장 큰 어려움 × 원인), 높은 점수 기준(4~5점)
    analysis: { groupBy: 'Q1', crosstabs: [['Q5', 'Q6']], highThreshold: 4 }
  };
})();

// Node(검사 스크립트)에서 require할 때만 내보낸다. 브라우저·GAS에서는 무시된다.
if (typeof module !== 'undefined' && module.exports) module.exports = SURVEY_DEF;
