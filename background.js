/**
 * background.js — Service Worker
 * 負責：VTT URL 偵測、Google 翻譯API呼叫
 */

// ── VTT 網路請求偵測 ────────────────────────────────────────────────────────
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const url = details.url.toLowerCase();
    const isVTT =
      url.endsWith('.vtt') ||
      url.includes('.vtt?') ||
      url.includes('/subtitles/') ||
      url.includes('/captions/') ||
      (url.includes('caption') && details.statusCode === 200) ||
      (url.includes('subtitle') && details.statusCode === 200);

    if (isVTT && details.statusCode === 200) {
      chrome.tabs.sendMessage(details.tabId, {
        type: 'VTT_URL_DETECTED',
        url: details.url,
        timestamp: Date.now()
      }).catch(() => {});
    }
  },
  {
    urls: [
      '*://*.udemy.com/*',
      '*://*.udemycdn.com/*',
      '*://*.cloudfront.net/*',
      '*://*.amazonaws.com/*'
    ]
  }
);

// ── 訊息處理 ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // 代理下載 VTT（避免 CORS）
  if (msg.type === 'FETCH_VTT') {
    fetch(msg.url)
      .then(r => r.text())
      .then(content => sendResponse({ success: true, content }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Google 翻譯批次
  if (msg.type === 'TRANSLATE_BATCH') {
    translateBatch(msg.texts, msg.targetLang)
      .then(translations => sendResponse({ success: true, translations }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 摘要功能停用
  if (msg.type === 'AI_SUMMARY') {
    sendResponse({ success: true, summary: "（目前的 Google 翻譯免設定模式，不支援 AI 摘要功能哦）" });
    return true;
  }

  // 開啟設定頁
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
  }
});

// ── 首次安裝引導至設定頁 ────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

// ── Google 翻譯核心函式 ────────────────────────────────────────────────────

async function translateBatch(texts, targetLang) {
  console.log(`[Udemy字幕 background] 收到翻譯批次請求，總行數: ${texts.length}, 目標語言: ${targetLang}`);
  const CHUNK = 30; // Google Translate 批次可以稍微小一點確保精準度
  const results = [];
  for (let i = 0; i < texts.length; i += CHUNK) {
    const chunk = texts.slice(i, i + CHUNK);
    console.log(`[Udemy字幕 background] 正在翻譯第 ${i + 1} 到 ${Math.min(i + CHUNK, texts.length)} 行...`);
    const translated = await translateChunkGoogle(chunk, targetLang);
    results.push(...translated);
  }
  console.log('[Udemy字幕 background] 批次翻譯全部完成！');
  return results;
}

async function translateChunkGoogle(texts, targetLang) {
  // 將每一行加上編號以防 Google 合併句子
  const input = texts.map((t, i) => `${i + 1}| ${t}`).join('\n');
  
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `q=${encodeURIComponent(input)}`
    });
    if (!res.ok) throw new Error(`Google API 錯誤 ${res.status}`);

    const data = await res.json();
    
    // Google Translate 回傳的第一個陣列包含所有翻譯片段
    const translatedText = data[0].map(item => item[0]).join('');
    
    // 解析還原行數
    const lines = translatedText.split('\n');
    const map = {};
    for (const line of lines) {
      // 匹配 "1| 翻譯文字" 或 "1 | 翻譯文字"
      const m = line.match(/^(\d+)\s*[|｜]\s*(.*)$/);
      if (m) {
        map[m[1]] = m[2].trim();
      }
    }

    // 依序填回陣列，若解析失敗則回傳原文
    const finalChunk = texts.map((orig, i) => map[String(i + 1)] || orig);
    console.log(`[Udemy字幕 background] 區塊翻譯成功，收到 ${Object.keys(map).length} 條翻譯`);
    return finalChunk;
  } catch (e) {
    console.error('[Udemy字幕 background] 請求發生異常:', e);
    throw e;
  }
}
