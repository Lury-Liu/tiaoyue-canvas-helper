/* 后台 service worker：唯一拥有 chrome.downloads 的地方。
 * content script（含隔离世界）拿不到 downloads API，必须由这里代下。
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tyq:download' || typeof msg.url !== 'string') return;

  try {
    chrome.downloads.download(
      {
        url: msg.url,
        filename: msg.filename || undefined,
        conflictAction: 'uniquify',
        saveAs: false,
      },
      (id) => {
        const err = chrome.runtime.lastError;
        sendResponse({ ok: !err, id: id || 0, err: err ? err.message : '' });
      }
    );
  } catch (e) {
    sendResponse({ ok: false, id: 0, err: String(e && e.message ? e.message : e) });
  }
  return true;   // 异步 sendResponse
});
