/*
 * DOM 도우미 — 요소 생성과 아이콘.
 * 사용자 입력은 항상 textContent로 넣는다(innerHTML 사용 금지). 아이콘 SVG는 이 파일의 고정 문자열만 쓴다.
 */
var Dom = (function () {
  /*
   * h('div', { class: 'a', onclick: fn, 'aria-label': '...' }, [자식...])
   * 자식: 문자열(텍스트 노드), 노드, 배열, null/false(무시)
   */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.indexOf('on') === 0 && typeof v === 'function') {
          el.addEventListener(k.slice(2), v);
        } else if (k === 'class') {
          el.className = v;
        } else if (k === 'text') {
          el.textContent = v;
        } else if (k === 'value') {
          el.value = v;
        } else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (s) { el.style[s] = v[s]; });
        } else {
          el.setAttribute(k, v === true ? '' : String(v));
        }
      });
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      children.forEach(function (c) { append(el, c); });
    } else if (typeof children === 'string' || typeof children === 'number') {
      el.appendChild(document.createTextNode(String(children)));
    } else {
      el.appendChild(children);
    }
  }

  // 아이콘 (24×24 선 아이콘). 고정 문자열만 쓰므로 innerHTML로 넣어도 안전하다.
  var PATHS = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 16.5v.01"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>'
  };

  function icon(name, size, strokeWidth) {
    var s = size || 20;
    var span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.style.display = 'inline-flex';
    span.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      (strokeWidth || 2) + '" stroke-linecap="round" stroke-linejoin="round">' + PATHS[name] + '</svg>';
    return span.firstChild;
  }

  return { h: h, icon: icon };
})();
