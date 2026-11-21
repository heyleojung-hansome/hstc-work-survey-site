/*
 * 화면 설정 — 배포 전에 이 파일만 고치면 된다.
 *
 * MOCK: true  → GAS 없이 브라우저 안의 가짜 서버(mock.js)로 동작한다(로컬 테스트용).
 *       false → API_URL의 GAS 웹앱을 호출한다.
 * 로컬(localhost)에서는 주소 끝에 ?mock=1 을 붙이면 MOCK: false여도 MOCK으로 동작한다.
 *   ?mock=off|before|after 는 '응답 받기 꺼짐/시작 전/종료' 화면을 흉내 낸다.
 */
var APP_CONFIG = {
  MOCK: false,
  // GAS 웹앱 배포 URL (…/exec) — 배포 @1의 ID. 재배포해도 같은 ID를 쓰므로 바뀌지 않는다.
  API_URL: 'https://script.google.com/macros/s/AKfycbzRhWqVByRhft9gAdLGcfrQXgEfL0HKI7GjEg2g_F310obmSYXKf05kS4yqFiFABAQv/exec',
  // MOCK 응답 지연(ms) — 실제 네트워크처럼 로딩 상태를 확인하기 위함
  MOCK_DELAY_MS: 450
};

// 개발용 서버(가짜 데이터) 웹앱 — 로컬에서 ?api=dev 로만 쓴다
APP_CONFIG.DEV_API_URL = 'https://script.google.com/macros/s/AKfycbwRW2dMHVFaVSCN36TdT7iTxU-9hQ47QhMzhlmWzUvhjR3D86Zygbu21I_q79RbkCzJtA/exec';

// 로컬 개발용 전환 (배포된 주소에서는 동작하지 않는다)
//   ?mock=1  → MOCK(서버 없이)
//   ?api=dev → 개발용 서버
(function () {
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var q = new URLSearchParams(location.search);
  if (local && q.get('mock')) APP_CONFIG.MOCK = true;
  if (local && q.get('api') === 'dev') APP_CONFIG.API_URL = APP_CONFIG.DEV_API_URL;
})();
