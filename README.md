# 跳跃视界 · 画布引用助手

> 浏览器扩展（Edge/Chrome MV3）+ 油猴脚本：在 [www.tiaoyue.com](https://www.tiaoyue.com) 画布提示词框里，把素材名字转成 `@图片N` 引用，并支持已引用清单定位、撤销历史、查找替换。
>
> 仓库：`https://github.com/Lury-Liu/tiaoyue-canvas-helper` · 分支 `main` · 当前版本 **1.10.1**
> 历史修复记录与技术债：[ISSUES.md](./ISSUES.md)

---

## 0. 交接必读

1. **不要手改 `tiaoyue-ref-helper-ext/content.js`**：它由 `tiaoyue-ref-helper.user.js` 经 `tools/build.js` 生成，手改会在下次构建时被覆盖。
2. **发布必须走构建**：`node tools/build.js <x.y.z>` → commit → push。版本号不涨，自动更新不会生效。
3. **仓库改名/转移要改两处**：`tiaoyue-ref-helper-ext/config.js` 的 `TYQ_REPO`/`TYQ_BRANCH`，以及 `tiaoyue-ref-helper.user.js` 的 `UPD_REPO`/`UPD_BRANCH`。漏改任何一处都会让一部分客户端更新 404。
4. **`ty_probe/` 白名单入库**：只有模拟页（`fake*.html`、`replica.html`）和验证脚本（`verify*.mjs`、`rtest*.mjs`、`lib.mjs` 等）进仓库；真实提示词、抓取的站点源码、真机截图被 `.gitignore` 排除，**不要取消**（远程是公开仓库）。

---

## 1. 功能现状

| 功能 | 说明 |
|---|---|
| 名字 → 引用 | 整段提示词里所有素材名一键转 `@图片N`；长名优先、不重复插 |
| 仅改写选中 | 只处理提示词里手动选中的那一小段 |
| 勾选跳过 / 预览 | 检出清单取消勾选即跳过；写回前可预览结果 |
| 已引用清单 | 列出正文里的 `@图片N`，点击定位 + 高亮，重复点击跳下一处 |
| 撤销 / 重做 | `Alt+Z` / `Alt+Shift+Z`，按节点归档，最多 20 步 |
| 查找替换 | `Ctrl+F`：全部命中高亮、回车/Shift+回车逐个跳转（首尾循环并提示）、默认忽略大小写、素材名也能搜、通用文件名（image.png 等）标注 |
| 面板拖动 | 面板与悬浮球均可拖，位置本地记忆，双击标题栏复位 |
| 切节点自动刷新 | 面板打开时切节点，素材列表 ≤0.4s 自动跟随 |
| 自动更新 | 每次进入画布检查 GitHub 并热替换（无需刷新）；断网回退内置版 |

### 已移除（不要加回来）

| 功能 | 原因 |
|---|---|
| 指定位置插入 / 插入引用（点素材 → 选位置 → 回车） | 提示词区上盖着应用自绘的点击捕获层，拿不到可靠落点 |

> 现在写回只发生在「转换」和「查找替换」，都由按钮显式触发。

---

## 2. 目录与版本

```
.
├─ tiaoyue-ref-helper.user.js        # 唯一源码（油猴脚本，也可直装 Tampermonkey）
├─ tiaoyue-ref-helper-ext/           # MV3 扩展
│  ├─ config.js                      # 仓库地址（转手必改）
│  ├─ loader.js                      # 隔离世界：每小时查更新，blob 注入主世界
│  ├─ content.js                     # 构建产物，勿手改
│  ├─ manifest.json / version.json   # 内置版 / 线上版
│  ├─ popup.html / popup.js          # 弹窗：版本、更新状态、快捷键
│  └─ icons/
├─ tools/build.js                    # 构建脚本（无依赖，Node 18+）
├─ ISSUES.md                         # 修复记录 + 技术债
└─ ty_probe/                         # 模拟页 / 验证脚本（白名单入库）
```

**版本号四处必须同步**（build.js 自动完成，手改会很危险）：

| 位置 | 含义 |
|---|---|
| `manifest.json.version` | 内置版（随文件夹分发） |
| `version.json.version` | 线上版（更新比对） |
| user.js `@version` | 油猴版号 |
| user.js `TYQ_VERSION` | 运行时自检比对用 |

- 必须严格递增（`x.y.z`，按点分数字比较，`1.10 > 1.9`）。
- 运行时：缓存版 **高于** 内置版 → 用缓存版，否则用内置版。
- `raw.githubusercontent.com` 有 CDN 缓存，拉取都带时间戳穿透，push 后通常 1 分钟内生效。

---

## 3. 技术架构（改动前必看）

站点是 **wujie 微前端**，编辑器在 shadow DOM 里，插件通过 React fiber 读写，不依赖输入事件。

| 层 | 关键点 |
|---|---|
| DOM 入口 | `HOST = wujie-app`，`SHADOW = HOST().shadowRoot`；`EDITOR_SEL = '[class*="_promptEditor_"]'`。**站点改类名 → 全挂，先改这里** |
| 读写 | `richFiber(ed)` 从 `__reactFiber$` 向上找带 `referenceItems / onChange / value` 的 props；`api()` 返回 `{ el, refs, props, maxLength, set }` |
| 文本模型 | `serialize()` DOM → 纯文本（mention 芯片 → `@图片N`）；`rangeFromOffset()` 偏移 → Range。两者规则必须同步改 |
| 素材索引 | `buildIndex(refs)` 按类型编号生成 `图片N / 视频N / 音频N` |
| 面板 | `render()` 分发 `renderAsset / renderHistory / renderFind`；`editorKey()`（节点 id + 素材 id/名字）做内容指纹 |
| 切节点刷新 | `syncPanelToEditor()`：观察编辑器挂载变化 + `focusin`，80ms 合并刷新所有页签；正文变动由 MutationObserver 在 250ms 后刷新 |
| 定位高亮 | `setPin()` + `followLoop()` 跟随 Range；`pinClipRects()` 按编辑器及裁剪祖先判断可见性，隐藏超过 5s 清除 |
| 查找高亮 | `drawFindHL()` 在滚动、尺寸或查找内容变化时按需重画（≤300），当前命中始终保留；偏移映射每次刷新只构建一次 |
| 历史 | 按节点保存最多 20 个快照；写回及历史跳转校验所属节点，手动改稿在覆盖前留档 |
| 路由 | SPA：`CANVAS_ROUTE='/aigc/canvas/'` + `pushState/popstate/hashchange` 钩子启停；`teardown()` 清 UI |
| 热更新 | 双通道：`loader.js`（隔离世界，1h 一次，chrome.storage 离线兜底）+ `selfUpdate()`（主世界自带，**每次进画布**）。新版 blob 注入 + `__TYQ_FORCE_ONCE` 接管，旧实例靠 `alive` / `__TYQ_DISPOSE__` 停监听 |

**高风险依赖**：`_promptEditor_` 类名、React fiber props 结构、wujie 挂载方式。任一处变更都可能让 `api()` 返回 `null`（面板提示「未找到提示词输入框」）。

---

## 4. 安装与发布

**终端用户（扩展）**：`edge://extensions` → 开「开发人员模式」→「加载解压缩的扩展」→ 选 `tiaoyue-ref-helper-ext`；之后自动更新。
**油猴**：安装 `tiaoyue-ref-helper.user.js`。
**开发**：无 npm 依赖，改完源码执行 `node tools/build.js`。

```bash
node tools/build.js 1.10.1        # 提升 manifest / version.json / @version / TYQ_VERSION，再生成 content.js
git add -A && git commit -m "v1.10.1" && git push
```

- 其他机器：进入画布即自动检查（loader 最多 1h 一次，content 自检查每次进画布都跑）；或弹窗点「立即检查更新」。
- 不带参数运行 build.js 只按当前 manifest 版本重新生成 content.js。

---

## 5. 关键函数地图

| 函数 | 作用 |
|---|---|
| `activeEditor()` | 取当前可见编辑器；全部不可见返回 `null`（避免读写隐藏节点） |
| `api()` / `richFiber()` | 从 fiber 拿 props、refs、`set()` |
| `serialize()` / `rangeFromOffset()` | DOM ↔ 纯文本偏移 |
| `buildIndex()` / `scanMatches()` / `convertAll()` | 素材索引、命中扫描、名字转引用 |
| `writeText()` | 唯一写回入口：历史快照 + 长度校验 + 写回 + 延迟重绘 |
| `render()` / `renderAsset()` / `renderFind()` | 面板渲染主体 |
| `syncPanelToEditor()` / `editorKey()` | 切节点自动刷新 |
| `jumpTo()` / `jumpToken()` / `setPin()` / `followLoop()` | 定位与高亮框 |
| `drawFindHL()` / `allPositions()` | 查找多命中高亮、忽略大小写扫描、首尾循环 |
| `isGenericName()` | 通用上传文件名（image.png 等）识别，仅标注 |
| `selfUpdate()` | 每次进画布检查线上版本并热替换 |
| `pinClipRects()` / `isClipper()` | 高亮裁剪 |
| `showGuide()` / `buildUI()` / `placePanel()` | 引导、UI、定位 |
| `teardown()` / `onRoute()` | 路由启停 |

---

## 6. 已知问题 / 技术债

1. 缺少稳定节点 id 时，历史按编辑器 DOM 实例区分；编辑器重建后不能自动关联旧历史。
2. 引用定位的 `followLoop()` 可见时仍逐帧跟随；查找高亮已改为按需更新。
3. `ty_probe/verify_find.mjs` 的 **76 项本地浏览器回归通过**；本次真实画布回归仍被滑块验证码阻挡，尚未完成。
4. 强依赖站点 DOM / fiber 结构，站点改版需同步改 `EDITOR_SEL` 与 `richFiber()`。

---

## 7. 交接清单 / 回归

- [ ] GitHub 仓库转移 / 协作者权限（`Lury-Liu/tiaoyue-canvas-helper`）
- [ ] 若转移：改 `config.js` 的 `TYQ_REPO`/`TYQ_BRANCH` + user.js 的 `UPD_REPO`/`UPD_BRANCH`
- [ ] 新机器执行 `node tools/build.js` 验证可构建
- [x] `ISSUES.md` 随仓库；`ty_probe/` 白名单（敏感文件仍被 gitignore）
- [x] v1.10.0 已推送（`d2f4993`）
- [ ] 真机回归（见下）

**回归清单**

1. 打开画布 → 双击节点 → 面板列出素材
2. A/B 节点来回切 → 列表 ≤0.4s 跟随，不串节点
3. 整段转换 / 仅改写选中 → `Alt+Z` 撤销 → 重做
4. 点「已引用」chip → 高亮随文字移动，离开面板即消失、滚回重现
5. `Ctrl+F` 输入 → 全部命中高亮 → 回车逐个跳、首尾循环有提示 → 替换为引用
6. 查找页搜素材名（含 `image.png` 类）→ 角标出现、点结果定位
7. 拖动面板 / 悬浮球 → 刷新后位置保留
8. 换台机器（或清 `chrome.storage`）进画布 → 自动升到线上版，无需刷新
9. 扩展弹窗「立即检查更新」→ 在线版本与运行版本一致

---

## 8. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 面板提示「未找到提示词输入框」 | 没双击节点，或站点改了 `_promptEditor_` 类名 / fiber 结构 |
| 检查更新「HTTP 404」 | 仓库路径或分支不对；或 `version.json` 没推到 main |
| 检查更新「Failed to fetch」 | 网络问题（GitHub 需可访问）；不影响内置版 |
| 刚 push 完对方还是旧版 | CDN 缓存，通常 1 分钟内；进一次画布或点「立即检查更新」 |
| 显示已更新但界面没变 | 刷新画布页；看弹窗「运行版本」是否为在线版 |
| 想强制回退内置版 | 删 `chrome.storage.local` 的 `tyq.upd.*`，或把 `version.json` 改成与 manifest 同版本 |
| 素材名变成 `image.png` | 不是经「添加资源 → 上传」导入的；会被标「通用文件名」，转换前核对 |

---

## 9. 安全说明

- 更新只从 `raw.githubusercontent.com` 拉取，要求内容长度 ≥5000 且含 `__TYQ` 标记，防止把 404 HTML 当脚本执行。
- 扩展权限仅 `storage` + `raw.githubusercontent.com`；`content_scripts` 只匹配 `www.tiaoyue.com` 与 `canvas.tiaoyue.com`。
- `content.js` 运行在页面主世界（`world: "MAIN"`）以读取 React fiber；不向第三方发送数据。
