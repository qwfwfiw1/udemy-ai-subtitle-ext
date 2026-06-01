/**
 * injected.js — 注入頁面層腳本
 * 攔截 fetch / XMLHttpRequest 以捕獲 Udemy VTT 字幕檔案內容
 * 透過 window.postMessage 回傳給 content script
 */
(function () {
  'use strict';

  const SENTINEL = '__UDEMY_SUBTITLE_EXT__';

  function isSubtitleUrl(url) {
    if (!url) return false;
    return (
      url.includes('.vtt') ||
      url.includes('subtitle') ||
      url.includes('caption') ||
      url.includes('transcript')
    );
  }

  function dispatchVTT(content, url) {
    if (!content || !content.trim().startsWith('WEBVTT')) return;
    window.postMessage({ type: `${SENTINEL}_VTT`, content, url }, '*');
  }

  // ── Intercept fetch ──────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const response = await _fetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (isSubtitleUrl(url)) {
        response.clone().text().then(text => dispatchVTT(text, url));
      }
    } catch (_) {}
    return response;
  };

  // ── Intercept XMLHttpRequest ─────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__url = url;
    return _open.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (isSubtitleUrl(this.__url)) {
          dispatchVTT(this.responseText, this.__url);
        }
      } catch (_) {}
    });
    return _send.apply(this, args);
  };

  console.log('[Udemy字幕] 頁面攔截器已啟動');
})();
