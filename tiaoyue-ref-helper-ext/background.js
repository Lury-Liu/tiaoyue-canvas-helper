/* 后台 service worker：唯一拥有 chrome.downloads 的地方。
 * content script（含隔离世界）拿不到 downloads API，必须由这里代下。
 *
 * 去重：按「相对路径 → 下载 id」记在 storage 里。下载前用 id 查该文件是否仍存在，
 * 存在就跳过。比 filenameRegex 可靠（后者匹配不到中文/反斜杠路径）。
 */
const DL_MAP_KEY = 'tyq.dl.ids';

function readMap() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DL_MAP_KEY, (o) => resolve((o && o[DL_MAP_KEY]) || {}));
  });
}

function writeMap(map) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [DL_MAP_KEY]: map }, () => resolve());
  });
}

function fileExists(id) {
  return new Promise((resolve) => {
    try {
      chrome.downloads.search({ id }, (items) => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(!!(items && items[0] && items[0].exists));
      });
    } catch (e) { resolve(false); }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tyq:download' || typeof msg.url !== 'string') return;

  const filename = msg.filename || '';
  const finish = (payload) => sendResponse(payload);

  const start = async () => {
    if (!filename) {
      try {
        chrome.downloads.download(
          { url: msg.url, conflictAction: 'overwrite', saveAs: false },
          (id) => {
            const err = chrome.runtime.lastError;
            finish({ ok: !err, id: id || 0, err: err ? err.message : '' });
          }
        );
      } catch (e) { finish({ ok: false, id: 0, err: String(e && e.message ? e.message : e) }); }
      return;
    }

    const map = await readMap();
    const prev = map[filename];
    if (prev) {
      const there = await fileExists(prev);
      if (there) { finish({ ok: true, skipped: true }); return; }
      delete map[filename];
    }

    try {
      chrome.downloads.download(
        { url: msg.url, filename, conflictAction: 'overwrite', saveAs: false },
        (id) => {
          const err = chrome.runtime.lastError;
          if (!err && id) {
            map[filename] = id;
            writeMap(map);
          }
          finish({ ok: !err, id: id || 0, err: err ? err.message : '' });
        }
      );
    } catch (e) {
      finish({ ok: false, id: 0, err: String(e && e.message ? e.message : e) });
    }
  };

  start();
  return true;   // 异步 sendResponse
});
