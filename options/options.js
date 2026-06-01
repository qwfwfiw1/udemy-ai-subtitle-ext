// options.js — 設定頁面邏輯

const $ = id => document.getElementById(id);

// ── 設定鍵對應 ────────────────────────────────────────────────────────────
const SETTINGS_KEYS = [
  'targetLang', 'fontSize', 'showOriginal',
  'showTranslation', 'ttsEnabled', 'enabled', 'batchSize', 'enableCache', 'ttsRate'
];

async function loadSettings() {
  return new Promise(resolve => chrome.storage.sync.get(SETTINGS_KEYS, resolve));
}

function showSaveBanner() {
  const banner = $('save-banner');
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 2500);
}

// ── 初始化 ────────────────────────────────────────────────────────────────
async function init() {
  const s = await loadSettings();

  // Display
  $('font-size').value = s.fontSize || 18;
  $('font-size-val').textContent = `${s.fontSize || 18}px`;
  $('show-original').checked = s.showOriginal !== false;
  $('show-translation').checked = s.showTranslation !== false;

  // Translation
  $('target-lang').value = s.targetLang || 'zh-TW';
  $('batch-size').value = s.batchSize || 60;
  $('batch-size-val').textContent = `${s.batchSize || 60} 行`;
  $('enable-cache').checked = s.enableCache !== false;

  // TTS
  $('tts-enabled').checked = !!s.ttsEnabled;
  $('tts-rate').value = s.ttsRate || 0.9;
  $('tts-rate-val').textContent = `${s.ttsRate || 0.9}x`;

  bindEvents();
  initSidebarNav();
  loadCacheStats();
}

// ── 事件綁定 ──────────────────────────────────────────────────────────────
function bindEvents() {
  // Font size
  $('font-size').addEventListener('input', e => {
    $('font-size-val').textContent = `${e.target.value}px`;
  });

  // Batch size
  $('batch-size').addEventListener('input', e => {
    $('batch-size-val').textContent = `${e.target.value} 行`;
  });

  // TTS rate
  $('tts-rate').addEventListener('input', e => {
    $('tts-rate-val').textContent = `${parseFloat(e.target.value).toFixed(1)}x`;
  });

  // Test TTS
  $('btn-test-tts').addEventListener('click', () => {
    const rate = parseFloat($('tts-rate').value);
    const lang = $('target-lang').value;
    const u = new SpeechSynthesisUtterance('您好，這是語音朗讀測試。Hello, this is a TTS test.');
    u.lang = lang;
    u.rate = rate;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });

  // Cache buttons
  $('btn-refresh-cache').addEventListener('click', loadCacheStats);
  $('btn-clear-cache').addEventListener('click', clearCache);

  // Global save
  $('btn-save-all').addEventListener('click', saveAll);
}

// ── Sidebar 導覽 ──────────────────────────────────────────────────────────
function initSidebarNav() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.settings-section');

  navItems.forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const target = item.dataset.section;

      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      sections.forEach(s => {
        s.classList.toggle('hidden', s.id !== `section-${target}`);
      });

      if (target === 'cache') loadCacheStats();
    });
  });
}

// ── 儲存全部設定 ──────────────────────────────────────────────────────────
function saveAll() {
  const settings = {
    fontSize: parseInt($('font-size').value),
    showOriginal: $('show-original').checked,
    showTranslation: $('show-translation').checked,
    targetLang: $('target-lang').value,
    batchSize: parseInt($('batch-size').value),
    enableCache: $('enable-cache').checked,
    ttsEnabled: $('tts-enabled').checked,
    ttsRate: parseFloat($('tts-rate').value)
  };

  chrome.storage.sync.set(settings, () => {
    showSaveBanner();
    // 通知所有 Udemy tabs
    chrome.tabs.query({ url: '*://*.udemy.com/course/*' }, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_UPDATED',
          settings
        }).catch(() => {});
      });
    });
  });
}

// ── 快取管理 ──────────────────────────────────────────────────────────────
function loadCacheStats() {
  chrome.storage.local.get(null, (items) => {
    const transKeys = Object.keys(items).filter(k => k.startsWith('trans_'));
    $('cache-count').textContent = `${transKeys.length} 筆`;

    const totalBytes = transKeys.reduce((acc, k) => {
      return acc + JSON.stringify(items[k]).length;
    }, 0);

    const kb = (totalBytes / 1024).toFixed(1);
    $('cache-size').textContent = kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
  });
}

function clearCache() {
  if (!confirm('確定要清除所有翻譯快取嗎？下次觀看時將重新翻譯（會消耗 API 額度）。')) return;
  chrome.storage.local.get(null, (items) => {
    const transKeys = Object.keys(items).filter(k => k.startsWith('trans_'));
    chrome.storage.local.remove(transKeys, () => {
      loadCacheStats();
      alert(`✅ 已清除 ${transKeys.length} 筆快取`);
    });
  });
}

// 啟動
document.addEventListener('DOMContentLoaded', init);
