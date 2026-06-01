/**
 * subtitle-parser.js — VTT 字幕解析工具
 * 將 WebVTT 格式解析為結構化字幕陣列
 */

/**
 * 將 VTT 時間戳記轉換為秒數
 * @param {string} timestamp "00:01:23.456" or "01:23.456"
 * @returns {number}
 */
function vttTimeToSeconds(timestamp) {
  const parts = timestamp.trim().split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return seconds;
}

/**
 * 清理字幕文字（移除 VTT 標籤、位置資訊等）
 * @param {string} text
 * @returns {string}
 */
function cleanSubtitleText(text) {
  return text
    .replace(/<[^>]+>/g, '')        // 移除 HTML/VTT 標籤
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\{[^}]+\}/g, '')      // 移除 {} 格式標記
    .trim();
}

/**
 * 解析 WebVTT 字幕內容
 * @param {string} vttContent
 * @returns {Array<{id: number, start: number, end: number, text: string}>}
 */
function parseVTT(vttContent) {
  const cues = [];
  if (!vttContent || !vttContent.trim().startsWith('WEBVTT')) return cues;

  // 以空行分割各 cue 區塊
  const blocks = vttContent.split(/\n\s*\n/);
  let id = 0;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // 找時間戳記行 (包含 --> )
    const timeLineIndex = lines.findIndex(l => l.includes('-->'));
    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const timeMatch = timeLine.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{2}:\d{2}[.,]\d{1,3})/
    );

    if (!timeMatch) continue;

    const startStr = timeMatch[1].replace(',', '.');
    const endStr = timeMatch[2].replace(',', '.');
    const start = vttTimeToSeconds(startStr);
    const end = vttTimeToSeconds(endStr);

    // 時間戳記後面的行都是字幕文字
    const textLines = lines.slice(timeLineIndex + 1);
    const text = cleanSubtitleText(textLines.join('\n'));

    if (text) {
      cues.push({ id: id++, start, end, text });
    }
  }

  return cues;
}

/**
 * 找出指定時間點對應的字幕 cue
 * @param {Array} cues
 * @param {number} currentTime
 * @returns {Object|null}
 */
function findCurrentCue(cues, currentTime) {
  // 二元搜尋加速
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid];
    if (currentTime < cue.start) {
      hi = mid - 1;
    } else if (currentTime > cue.end) {
      lo = mid + 1;
    } else {
      return cue;
    }
  }
  return null;
}

/**
 * 將字幕陣列匯出為 SRT 格式
 */
function exportAsSRT(cues) {
  function pad(n, len = 2) { return String(n).padStart(len, '0'); }
  function toSRTTime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`;
  }
  return cues.map((c, i) =>
    `${i + 1}\n${toSRTTime(c.start)} --> ${toSRTTime(c.end)}\n${c.text}\n`
  ).join('\n');
}

// Content script 環境：函式已在頂層作用域，直接可用
// 同時也掛到 window 以備其他用途
if (typeof window !== 'undefined') {
  window.SubtitleParser = { parseVTT, findCurrentCue, exportAsSRT };
}
