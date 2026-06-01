// popup.js — Popup 控制邏輯

const $ = id => document.getElementById(id);

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['openaiApiKey', 'targetLang', 'fontSize', 'showOriginal', 'showTranslation', 'ttsEnabled', 'enabled'],
      resolve
    );
  });
}

function saveSettings(patch) {
  chrome.storage.sync.set(patch);
  // 通知 content script
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings: patch }).catch(() => {});
    }
  });
}

async function init() {
  const s = await loadSettings();

  // Apply saved values
  $('toggle-enabled').checked = s.enabled !== false;
  $('toggle-original').checked = s.showOriginal !== false;
  $('toggle-translation').checked = s.showTranslation !== false;
  $('toggle-tts').checked = !!s.ttsEnabled;
  $('lang-select').value = s.targetLang || 'zh-TW';
  $('font-size').value = s.fontSize || 18;
  $('font-size-value').textContent = `${s.fontSize || 18}px`;
  updateApiStatus(s.openaiApiKey);

  // Check if we're on Udemy
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const isUdemy = tab?.url?.includes('udemy.com/course');
    $('status-badge').textContent = isUdemy ? '課程頁面' : '非課程頁';
    $('status-badge').className = `status-badge${isUdemy ? '' : ' inactive'}`;
  });

  // Event listeners
  $('toggle-enabled').addEventListener('change', e => {
    saveSettings({ enabled: e.target.checked });
    updateMasterToggleStyle(e.target.checked);
  });

  $('toggle-original').addEventListener('change', e => saveSettings({ showOriginal: e.target.checked }));
  $('toggle-translation').addEventListener('change', e => saveSettings({ showTranslation: e.target.checked }));
  $('toggle-tts').addEventListener('change', e => saveSettings({ ttsEnabled: e.target.checked }));

  $('lang-select').addEventListener('change', e => saveSettings({ targetLang: e.target.value }));

  $('font-size').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    $('font-size-value').textContent = `${v}px`;
    saveSettings({ fontSize: v });
  });

  $('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  $('btn-retranslate').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings: { _retranslate: true } }).catch(() => {});
      }
    });
    window.close();
  });

  updateMasterToggleStyle(s.enabled !== false);
}

function updateApiStatus(apiKey) {
  const hasKey = !!(apiKey && apiKey.startsWith('sk-'));
  const el = $('api-status');
  el.className = `api-status${hasKey ? ' ok' : ''}`;
  $('api-icon').textContent = hasKey ? '✅' : '❌';
  $('api-label').textContent = hasKey ? 'API Key 已設定' : '未設定 API Key';
  $('api-hint').textContent = hasKey
    ? `sk-...${apiKey.slice(-4)}`
    : '請點擊「設定」輸入 Key';
}

function updateMasterToggleStyle(enabled) {
  const row = document.querySelector('.master-toggle');
  if (row) {
    row.style.opacity = enabled ? '1' : '0.6';
  }
}

document.addEventListener('DOMContentLoaded', init);
