/*
 * API 클라이언트 — 모든 함수는 Promise<{ ok, data } | { ok: false, error }>를 돌려준다.
 * MOCK 모드면 MockServer를, 아니면 GAS 웹앱을 호출한다.
 * GAS로 보내는 POST는 CORS preflight를 피하려고 Content-Type: text/plain(본문은 JSON 문자열)으로 보낸다.
 */
var Api = (function () {
  var NETWORK_ERROR = '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  var TIMEOUT_MS = 20000;

  function mockCall(fn, payload) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        try { resolve(fn(payload)); } catch (e) { resolve({ ok: false, error: '처리 중 문제가 생겼습니다.' }); }
      }, APP_CONFIG.MOCK_DELAY_MS);
    });
  }

  function request(method, params) {
    if (!APP_CONFIG.API_URL) return Promise.resolve({ ok: false, error: '서버 주소가 설정되지 않았습니다. 관리자에게 문의해 주세요.' });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var url = APP_CONFIG.API_URL;
    var init = { method: method, redirect: 'follow', signal: ctrl ? ctrl.signal : undefined };
    if (method === 'GET') {
      url += (url.indexOf('?') === -1 ? '?' : '&') + new URLSearchParams(params).toString();
    } else {
      init.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      init.body = JSON.stringify(params);
    }
    return fetch(url, init)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (json && typeof json.ok === 'boolean') return json;
        return { ok: false, error: '서버 응답을 이해할 수 없습니다.' };
      })
      .catch(function () { return { ok: false, error: NETWORK_ERROR }; })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  return {
    status: function () {
      return APP_CONFIG.MOCK ? mockCall(MockServer.status) : request('GET', { action: 'status' });
    },
    start: function (branch, name) {
      var p = { action: 'start', branch: branch, name: name };
      return APP_CONFIG.MOCK ? mockCall(MockServer.start, p) : request('POST', p);
    },
    // roundId·version: 응답자가 본 회차와 정의 버전(서버가 다르면 '문항 갱신' 안내)
    submit: function (token, answers, roundId, version) {
      var p = { action: 'submit', token: token, answers: answers, roundId: roundId, version: version };
      return APP_CONFIG.MOCK ? mockCall(MockServer.submit, p) : request('POST', p);
    },

    // 관리자 API — payload에 action과 token 등을 담아 보낸다(gas/Admin.js)
    admin: function (action, payload) {
      var p = Object.assign({ action: action }, payload || {});
      return APP_CONFIG.MOCK ? mockCall(MockServer.admin, p) : request('POST', p);
    }
  };
})();
