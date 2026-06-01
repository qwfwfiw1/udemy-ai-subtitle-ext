# Udemy 雙語字幕小助手 (Udemy Dual Subtitle Extension)

這是一個專為 Udemy 設計的 Chrome 擴充功能，能夠**自動攔截課程的隱藏字幕 (VTT)**，並使用**完全免費的 Google 翻譯 API**，在影片下方呈現出完美對齊的中英雙語字幕。

## ✨ 核心特色
- **永遠免費**：免去繁瑣的 API Key 設定，內建串接 Google Translate，無額度限制。
- **精準攔截**：透過底層網路請求 (WebRequest) 攔截 VTT 字幕檔，無視 Udemy 播放器介面更新。
- **防止覆蓋**：內建過濾機制，自動排除 Udemy 的縮圖軌 (Sprite/Thumbnail VTT)，避免字幕被錯誤覆蓋。
- **玻璃態 UI**：絕美的全螢幕相容懸浮 UI (Glassmorphism)，不阻擋課程畫面。

---

## 🛠️ 開發與製作流程 (How it works)

本專案經歷了數次重大迭代，以下是我們解決 Udemy 平台限制的核心技術流程：

### 1. 字幕攔截技術 (WebRequest API)
Udemy 經常將字幕檔案 (VTT) 存放在不同的 CDN (例如 `udemycdn.com`)。
- 我們在 `background.js` 中實作了 `chrome.webRequest.onCompleted`，精準監聽所有副檔名為 `.vtt` 或是帶有 `/subtitles/` 的請求。
- 攔截後，利用 Background Service Worker 進行背景下載，完美避開了網頁前端常見的 CORS 跨網域限制。

### 2. 解決模組載入錯誤 (Module Bundle Issue)
由於 Chrome 擴充功能的執行環境限制，早期版本的 `subtitle-parser` 無法正確地被載入到網頁中。
- **解法**：我們將 VTT 解析演算法（如 `vttTimeToSeconds`、正則表達式）直接輕量化並內嵌進入 `content.js` 中。這確保了字幕解析完全零相依性 (Zero Dependencies)。

### 3. DOM 變更與層級隔離 (Shadow DOM vs all: initial)
Udemy 經常使用強大的 CSS 來覆寫網頁上的元素，導致擴充功能的 Toast 提示或選單跑版。
- **解法**：我們在 `content.css` 中廣泛使用了 `all: initial` 搭配 `!important` 進行樣式隔離，確保擴充功能的 UI 永遠處於最高層級 (`z-index: 2147483647`)，且不會被母網頁的樣式干擾。

### 4. 翻譯引擎的迭代
- **第一版 (OpenAI GPT-4o)**：原先採用 GPT-4o 進行高精準度翻譯，但需要使用者自備 API Key 且有付費門檻。
- **最終版 (Google Translate)**：為達到「開箱即用」且「零成本」，我們改寫了 `background.js`，將批次翻譯請求改為發送 `POST` 請求至 `translate.googleapis.com`。
- **對齊技術**：為了避免 Google 翻譯把斷句或多行字幕合併，我們在發送前將字幕加上標籤（例：`1| Hello`），並在翻譯完成後用 Regex 重新切分對齊，確保時間軸 100% 準確。

---

## 📥 如何安裝 (安裝教學)

1. 將本專案下載或 Clone 到你的電腦：
   ```bash
   git clone https://github.com/qwfwfiw1/udemy-ai-subtitle-ext.git
   ```
2. 開啟 Google Chrome 瀏覽器，在網址列輸入 `chrome://extensions/` 並進入。
3. 開啟右上角的 **「開發人員模式 (Developer mode)」**。
4. 點擊左上角的 **「載入未封裝項目 (Load unpacked)」**，並選擇本專案的資料夾。
5. 安裝完成！打開任何一堂 Udemy 課程，影片下方就會自動啟動雙語字幕囉！
