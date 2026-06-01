/**
 * content.js — Udemy AI 字幕助手
 * VTT 解析函式直接內嵌，不依賴外部檔案載入順序
 */

(function () {
  'use strict';

  if (window.__UDS_LOADED__) return;
  window.__UDS_LOADED__ = true;
  console.log('[Udemy字幕] ✅ Content script 已啟動');

  // ════════════════════════════════════════════════════════════
  // VTT 解析工具（內嵌，不依賴 subtitle-parser.js）
  // ════════════════════════════════════════════════════════════

  function vttTimeToSeconds(ts) {
    const p = ts.trim().split(':');
    if (p.length === 3) return +p[0] * 3600 + +p[1] * 60 + parseFloat(p[2]);
    if (p.length === 2) return +p[0] * 60 + parseFloat(p[1]);
    return 0;
  }

  function cleanText(t) {
    return t
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .trim();
  }

  function parseVTT(content) {
    const cues = [];
    if (!content || !content.includes('WEBVTT')) return cues;
    const blocks = content.split(/\n\s*\n/);
    let id = 0;
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const ti = lines.findIndex(l => l.includes('-->'));
      if (ti === -1) continue;
      const m = lines[ti].match(
        /(\d{1,2}:\d{2}:\d{2}[.,]\d+|\d{2}:\d{2}[.,]\d+)\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d+|\d{2}:\d{2}[.,]\d+)/
      );
      if (!m) continue;
      const text = cleanText(lines.slice(ti + 1).join('\n'));
      if (text) {
        cues.push({
          id: id++,
          start: vttTimeToSeconds(m[1].replace(',', '.')),
          end: vttTimeToSeconds(m[2].replace(',', '.')),
          text
        });
      }
    }
    return cues;
  }

  function exportAsSRT(cues) {
    const pad = (n, l = 2) => String(Math.floor(n)).padStart(l, '0');
    const toTime = s => `${pad(s/3600)}:${pad((s%3600)/60)}:${pad(s%60)},${pad((s%1)*1000,3)}`;
    return cues.map((c, i) => `${i+1}\n${toTime(c.start)} --> ${toTime(c.end)}\n${c.text}`).join('\n\n');
  }

  // ════════════════════════════════════════════════════════════
  // 狀態
  // ════════════════════════════════════════════════════════════

  const state = {
    enabled: true, showOriginal: true, showTranslation: true, ttsEnabled: false,
    cues: [], translations: [], currentCueId: -1,
    video: null, targetLang: 'zh-TW', fontSize: 18,
    translating: false, vttUrl: null, domObserver: null
  };

  // ════════════════════════════════════════════════════════════
  // 初始化
  // ════════════════════════════════════════════════════════════

  async function init() {
    const r = await getSettings();
    Object.assign(state, {
      targetLang: r.targetLang || 'zh-TW',
      fontSize: r.fontSize || 18,
      showOriginal: r.showOriginal !== false,
      showTranslation: r.showTranslation !== false,
      ttsEnabled: !!r.ttsEnabled,
      enabled: r.enabled !== false
    });

    injectInterceptor();
    createUI();
    bindMessages();
    waitForVideo();
  }

  function getSettings() {
    return new Promise(res =>
      chrome.storage.sync.get(
        ['targetLang','fontSize','showOriginal','showTranslation','ttsEnabled','enabled'],
        res
      )
    );
  }

  // ════════════════════════════════════════════════════════════
  // 頁面攔截器注入
  // ════════════════════════════════════════════════════════════

  function injectInterceptor() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
    console.log('[Udemy字幕] 攔截器已注入');
  }

  // ════════════════════════════════════════════════════════════
  // 訊息監聽
  // ════════════════════════════════════════════════════════════

  function bindMessages() {
    // 攔截器 postMessage → content script
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      if (e.data?.type === '__UDEMY_SUBTITLE_EXT___VTT') {
        console.log('[Udemy字幕] postMessage 收到 VTT，長度:', e.data.content?.length);
        onVTTReceived(e.data.content, e.data.url);
      }
    });

    // background service worker → content script
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'VTT_URL_DETECTED') {
        console.log('[Udemy字幕] background 偵測到 URL:', msg.url);
        fetchVTTViaBackground(msg.url);
      }
      if (msg.type === 'SETTINGS_UPDATED') applySettingsUpdate(msg.settings);
    });
  }

  function fetchVTTViaBackground(url) {
    if (url === state.vttUrl && state.cues.length > 0) return;
    chrome.runtime.sendMessage({ type: 'FETCH_VTT', url }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.success) onVTTReceived(res.content, url);
    });
  }

  function applySettingsUpdate(s) {
    if (!s) return;
    if (s.targetLang !== undefined) state.targetLang = s.targetLang;
    if (s.fontSize !== undefined) { state.fontSize = s.fontSize; applyFontSize(); }
    if (s.showOriginal !== undefined) state.showOriginal = s.showOriginal;
    if (s.showTranslation !== undefined) state.showTranslation = s.showTranslation;
    if (s.ttsEnabled !== undefined) state.ttsEnabled = s.ttsEnabled;
    if (s._retranslate) { state.translations = []; triggerTranslation(); }
  }

  // ════════════════════════════════════════════════════════════
  // VTT 處理
  // ════════════════════════════════════════════════════════════

  function isRealSubtitleVTT(content, url) {
    const u = (url || '').toLowerCase();
    // 排除縮略圖 Sprite VTT
    if (u.includes('thumb') || u.includes('sprite') || u.includes('storyboard')) return false;
    // 排除 API survey 請求
    if (u.includes('caption_survey') || u.includes('system-messages')) return false;
    // 檢查內容是否包含圖片座標（Sprite 專用格式）
    if (/#xywh=/i.test(content)) return false;
    // 至少要有一個真實文字 cue（不是空白且不是單純數字）
    const textBlocks = content.split(/\n\s*\n/).filter(b => b.includes('-->')).slice(0, 5);
    const hasRealText = textBlocks.some(b => {
      const lines = b.trim().split('\n');
      const textLine = lines.find(l => !l.includes('-->') && !/^\d+$/.test(l.trim()));
      return textLine && textLine.trim().length > 3;
    });
    return hasRealText;
  }

  function onVTTReceived(content, url) {
    if (!content || !content.includes('WEBVTT')) {
      console.log('[Udemy字幕] 內容不是 VTT，跳過');
      return;
    }
    if (!isRealSubtitleVTT(content, url)) {
      console.log('[Udemy字幕] 過濾非字幕 VTT:', url?.slice(-60));
      return;
    }
    if (state.vttUrl === url && state.cues.length > 0) {
      console.log('[Udemy字幕] 已處理過此 VTT，跳過');
      return;
    }

    // 如果新 VTT 比現有的少，不覆蓋（避免 sprite 覆蓋真字幕）
    const cues = parseVTT(content);
    if (state.cues.length > 0 && cues.length < state.cues.length) {
      console.log(`[Udemy字幕] 新 VTT (${cues.length}條) < 現有 (${state.cues.length}條)，保留現有字幕`);
      return;
    }

    state.vttUrl = url;
    console.log(`[Udemy字幕] 解析完成：${cues.length} 條字幕`);

    if (!cues.length) { showToast('⚠️ 解析到 0 條字幕', 'warning'); return; }

    state.cues = cues;
    state.translations = [];
    state.currentCueId = -1;
    showToast(`✅ 已載入 ${cues.length} 條字幕`);
    setStatus(`${cues.length} 條`);

    const cacheKey = makeCacheKey(url);
    chrome.storage.local.get([cacheKey], (r) => {
      if (r[cacheKey]) {
        state.translations = r[cacheKey];
        showToast('📦 已從快取載入翻譯');
      } else {
        triggerTranslation();
      }
    });
  }

  function makeCacheKey(url) {
    // 取 URL 後 60 字元避免 key 過長
    const part = (url || '').slice(-60).replace(/[^a-z0-9]/gi, '_');
    return `trans_${part}_${state.targetLang}`;
  }

  // ════════════════════════════════════════════════════════════
  // 呼叫背景進行 Google 翻譯
  // ════════════════════════════════════════════════════════════

  async function triggerTranslation() {
    if (state.translating || !state.cues.length) return;

    state.translating = true;
    setStatus('🔄 翻譯中…');

    chrome.runtime.sendMessage(
      {
        type: 'TRANSLATE_BATCH',
        texts: state.cues.map(c => c.text),
        targetLang: state.targetLang
      },
      (res) => {
        state.translating = false;
        if (chrome.runtime.lastError) {
          showToast('❌ 翻譯請求失敗', 'error'); setStatus(''); return;
        }
        if (res?.success) {
          state.translations = res.translations;
          chrome.storage.local.set({ [makeCacheKey(state.vttUrl)]: res.translations });
          showToast('🌐 翻譯完成！');
          setStatus(`${state.cues.length} 條 ✓`);
        } else {
          showToast(`❌ ${res?.error || '翻譯失敗'}`, 'error');
          setStatus('翻譯失敗');
        }
      }
    );
  }

  // ════════════════════════════════════════════════════════════
  // 影片監控
  // ════════════════════════════════════════════════════════════

  function waitForVideo() {
    const tryFind = () => {
      const v = document.querySelector('video');
      if (v && v !== state.video) {
        state.video = v;
        v.addEventListener('timeupdate', onTimeUpdate);
        console.log('[Udemy字幕] ✅ 找到 video 元素');
        tryAttachUI();
        setupDomFallback();
      }
    };
    tryFind();
    new MutationObserver(tryFind).observe(document.body, { childList: true, subtree: true });
  }

  function setupDomFallback() {
    // DOM 備援：監看 Udemy 原生字幕容器
    const selectors = [
      '[data-purpose="captions-container"]',
      '[class*="captions-display"] span',
      '.vjs-text-track-display',
      '[class*="caption-window"]'
    ];

    const tryObserve = () => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          if (state.domObserver) state.domObserver.disconnect();
          state.domObserver = new MutationObserver(() => {
            if (state.cues.length > 0) return; // 已有 VTT，不用備援
            const t = el.textContent?.trim();
            if (t) showSubtitles(t, '');
          });
          state.domObserver.observe(el, { childList: true, subtree: true, characterData: true });
          console.log('[Udemy字幕] DOM 備援已啟動:', sel);
          return true;
        }
      }
      return false;
    };

    if (!tryObserve()) {
      [2000, 5000, 10000].forEach(d => setTimeout(tryObserve, d));
    }
  }

  function onTimeUpdate() {
    if (!state.enabled || !state.cues.length) return;
    const t = state.video.currentTime;

    let found = null;
    for (const cue of state.cues) {
      if (t >= cue.start && t <= cue.end) { found = cue; break; }
    }

    if (!found) {
      if (state.currentCueId !== -1) { state.currentCueId = -1; showSubtitles('', ''); }
      return;
    }
    if (found.id === state.currentCueId) return;
    state.currentCueId = found.id;

    const orig  = state.showOriginal    ? found.text                         : '';
    const trans = state.showTranslation ? (state.translations[found.id] || '') : '';
    showSubtitles(orig, trans);
    if (state.ttsEnabled && trans) ttsSpeak(trans);
  }

  function ttsSpeak(text) {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.targetLang; u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  // ════════════════════════════════════════════════════════════
  // UI
  // ════════════════════════════════════════════════════════════

  let $orig, $trans, $bar, $status, $toast, $summary;

  function createUI() {
    document.getElementById('uds-root')?.remove();

    const root = document.createElement('div');
    root.id = 'uds-root';
    root.innerHTML = `
      <div id="uds-bar">
        <div id="uds-orig"></div>
        <div id="uds-trans"></div>
      </div>
      <div id="uds-ctrl">
        <span id="uds-logo">🎓</span>
        <button id="uds-b-toggle" class="ub active">字幕ON</button>
        <button id="uds-b-orig"   class="ub active">原文</button>
        <button id="uds-b-trans"  class="ub active">譯文</button>
        <button id="uds-b-tts"    class="ub">🔊</button>
        <button id="uds-b-re"     class="ub">🔄再翻</button>
        <button id="uds-b-sum"    class="ub">📝摘要</button>
        <button id="uds-b-exp"    class="ub">⬇️SRT</button>
        <button id="uds-b-set"    class="ub">⚙️</button>
        <span   id="uds-st"></span>
      </div>
      <div id="uds-toast"></div>
      <div id="uds-summary" class="uds-hide">
        <div id="uds-sum-hd">
          <span>📝 AI 課程摘要</span>
          <button id="uds-sum-x">✕</button>
        </div>
        <div id="uds-sum-body"></div>
      </div>`;

    document.body.appendChild(root);

    $orig    = g('uds-orig');
    $trans   = g('uds-trans');
    $bar     = g('uds-bar');
    $status  = g('uds-st');
    $toast   = g('uds-toast');
    $summary = g('uds-summary');

    applyFontSize();
    syncBtns();
    bindBtns();
    console.log('[Udemy字幕] UI 已建立');
  }

  function g(id) { return document.getElementById(id); }

  function bindBtns() {
    g('uds-b-toggle').onclick = () => {
      state.enabled = !state.enabled;
      chrome.storage.sync.set({ enabled: state.enabled });
      g('uds-b-toggle').textContent = state.enabled ? '字幕ON' : '字幕OFF';
      g('uds-b-toggle').classList.toggle('active', state.enabled);
      if (!state.enabled) showSubtitles('', '');
    };
    g('uds-b-orig').onclick  = () => toggleFlag('showOriginal',    'uds-b-orig');
    g('uds-b-trans').onclick = () => toggleFlag('showTranslation', 'uds-b-trans');
    g('uds-b-tts').onclick   = () => {
      state.ttsEnabled = !state.ttsEnabled;
      g('uds-b-tts').classList.toggle('active', state.ttsEnabled);
      if (!state.ttsEnabled) speechSynthesis?.cancel();
    };
    g('uds-b-re').onclick  = () => { state.translations = []; state.vttUrl = null; triggerTranslation(); };
    g('uds-b-sum').onclick = openSummary;
    g('uds-b-exp').onclick = doExport;
    g('uds-b-set').onclick = () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    g('uds-sum-x').onclick = () => $summary.classList.add('uds-hide');
  }

  function toggleFlag(key, btnId) {
    state[key] = !state[key];
    g(btnId)?.classList.toggle('active', state[key]);
    chrome.storage.sync.set({ [key]: state[key] });
  }

  function syncBtns() {
    g('uds-b-toggle')?.classList.toggle('active', state.enabled);
    g('uds-b-orig')?.classList.toggle('active', state.showOriginal);
    g('uds-b-trans')?.classList.toggle('active', state.showTranslation);
    g('uds-b-tts')?.classList.toggle('active', state.ttsEnabled);
    if (g('uds-b-toggle')) g('uds-b-toggle').textContent = state.enabled ? '字幕ON' : '字幕OFF';
  }

  function tryAttachUI() {
    if (!state.video) return;
    let el = state.video.parentElement;
    for (let i = 0; i < 7 && el && el !== document.body; i++) {
      if (el.offsetWidth > 300 && el.offsetHeight > 180) {
        el.style.position = 'relative';
        const root = g('uds-root');
        if (root) { root.style.position = 'absolute'; el.appendChild(root); }
        console.log('[Udemy字幕] UI 已附加到播放器');
        return;
      }
      el = el.parentElement;
    }
    console.log('[Udemy字幕] UI 使用 fixed 定位');
  }

  // ════════════════════════════════════════════════════════════
  // 字幕顯示
  // ════════════════════════════════════════════════════════════

  function showSubtitles(orig, trans) {
    if (!state.enabled) { $bar.classList.remove('uds-show'); return; }
    $orig.textContent  = orig;
    $trans.textContent = trans;
    $bar.classList.toggle('uds-show', !!(orig || trans));
  }

  function setStatus(t) { if ($status) $status.textContent = t; }
  function applyFontSize() { if ($bar) $bar.style.setProperty('--uds-fs', `${state.fontSize}px`); }

  // ════════════════════════════════════════════════════════════
  // 功能
  // ════════════════════════════════════════════════════════════

  function doExport() {
    if (!state.cues.length) { showToast('⚠️ 尚無字幕', 'warning'); return; }
    const merged = state.cues.map((c, i) => ({
      ...c,
      text: state.translations[i] ? `${c.text}\n${state.translations[i]}` : c.text
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportAsSRT(merged)], { type: 'text/plain;charset=utf-8' }));
    a.download = `udemy-${Date.now()}.srt`;
    a.click();
    showToast('✅ SRT 已下載');
  }

  function openSummary() {
    if (!state.cues.length) { showToast('⚠️ 尚無字幕', 'warning'); return; }
    if (!state.apiKey) { showToast('⚠️ 請先設定 API Key', 'warning'); return; }
    $summary.classList.remove('uds-hide');
    g('uds-sum-body').innerHTML = '<p class="uds-spin">⏳ AI 分析中…</p>';
    chrome.runtime.sendMessage(
      { type: 'AI_SUMMARY', text: state.cues.map(c => c.text).join('\n'), targetLang: state.targetLang, apiKey: state.apiKey },
      (res) => {
        if (!res?.success) {
          g('uds-sum-body').innerHTML = `<p style="color:#fca5a5">❌ ${res?.error || '失敗'}</p>`;
        } else {
          g('uds-sum-body').innerHTML = mdToHtml(res.summary);
        }
      }
    );
  }

  function mdToHtml(t) {
    return t
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^[•\-] (.+)$/gm, '<li>$1</li>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '<br>');
  }

  // ════════════════════════════════════════════════════════════
  // Toast
  // ════════════════════════════════════════════════════════════

  let _tt;
  function showToast(msg, type = 'info') {
    if (!$toast) return;
    $toast.textContent = msg;
    $toast.className = `uds-toast-show uds-t-${type}`;
    clearTimeout(_tt);
    _tt = setTimeout(() => { $toast.className = ''; }, 3200);
  }

  // ════════════════════════════════════════════════════════════
  // 啟動
  // ════════════════════════════════════════════════════════════

  init();
})();
