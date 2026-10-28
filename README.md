# 跳跃视界 · 画布引用助手

> 浏览器扩展（Edge/Chrome MV3）+ 油猴脚本：在 [www.tiaoyue.com](https://www.tiaoyue.com) 画布提示词框里，把素材名字转成 `@图片N` 引用，并支持已引用清单定位、撤销历史、查找替换。
>
> 仓库：`https://github.com/Lury-Liu/tiaoyue-canvas-helper` · 分支 `main` · 当前版本 **1.8.0**
> 详细修复记录与技术债：`ISSUES.md`

---

## 0. 交接必读（先看这 5 条）

1. **不要手改 `tiaoyue-ref-helper-ext/content.js`**：它由 `tiaoyue-ref-helper.user.js` 经 `tools/build.js` 生成，手改会在下次构建时被覆盖。
2. **发布必须走构建**：`node tools/build.js <x.y.z>` → commit → push。版本号不涨，自动更新不会生效。
3. **仓库改名/转移后必须改 `tiaoyue-ref-helper-ext/config.js`** 里的 `TYQ_REPO`（和 `TYQ_BRANCH`），否则所有客户端检查更新都会 404。
4. **远端状态**：GitHub 最后提交是 `v1.6.0`；本地工作区已到 `v1.8.0`（含插入功能移除、审查修复、文档重写），交接前需 commit + push。
5. **`ty_probe/` 采用白名单入库**：只有模拟页（`fake*.html`、`replica.html`）与验证脚本（`verify*.mjs`、`rtest*.mjs`、`lib.mjs` 等）进仓库；真实提示词文本、抓取的站点源码、真机截图仍在本地，被 `.gitignore` 排除，不要取消排除。

---

## 1. 功能现状

### 保留

| 功能 | 说明 |
|---|---|
| 名字 → 引用 | 整段提示词里所有素材名一键转 `@图片N`；长名优先、不重复插 |
| 仅改写选中 | 只处理提示词里手动选中的那一小段 |
| 勾选跳过 | 检出清单里取消勾选，转换时跳过该素材 |
| 预览 | 写回前查看转换结果 |
| 已引用清单 | 列出正文里的 `@图片N`，点击定位 + 高亮，重复点击跳下一处 |
| 撤销 / 重做 | `Alt+Z` / `Alt+Shift+Z`，按节点归档，最多 20 步 |
| 查找替换 | `Ctrl+F`，支持「替换为引用」 |
| 面板拖动 | 面板与悬浮球均可拖，位置本地记忆，双击标题栏复位 |
| 切节点自动刷新 | 面板打开时切节点，素材列表 ≤0.4s 自动跟随 |
| 自动更新 | 扩展每小时检查 GitHub，热替换；断网回退内置版 |

### 已移除（不要加回来）

| 功能 | 移除原因 |
|---|---|
| 指定位置插入（点素材 → 点正文选位置 → 回车） | 提示词区上盖着应用自绘的点击捕获层，拿不到可靠落点 |
| 插入引用（搜索列表 / ↑↓ / 回车插入） | 同上；连「默认插入末尾」兜底一并删除，避免写错位置 |

> 现在写回只发生在「转换」和「查找替换」，都由按钮显式触发。

---

## 2. 目录结构

```
.
├─ tiaoyue-ref-helper.user.js        # 唯一源码（油猴脚本，也可直接装 Tampermonkey）
├─ tiaoyue-ref-helper-ext/           # MV3 扩展
│  ├─ config.js                      # GitHub 仓库地址（转手必改）
│  ├─ loader.js                      # 隔离世界：每小时查更新，blob 注入主世界
│  ├─ content.js                     # 构建产物（内置兜底版，勿手改）
│  ├─ manifest.json                  # 内置版本
│  ├─ version.json                   # 线上版本（loader 比对用）
│  ├─ popup.html / popup.js          # 扩展弹窗：版本、更新状态、快捷键
│  └─ icons/
├─ tools/build.js                    # 构建脚本（无依赖）
├─ ISSUES.md                         # 修复记录 + 已知问题
└─ ty_probe/                         # 模拟页 / 验证脚本（白名单入库，其余本地）
```

---

## 3. 技术架构（改动前必看）

站点是 **wujie 微前端**，编辑器在 shadow DOM 里，插件通过 React fiber 读写，不依赖输入事件。

| 层 | 关键点 |
|---|---|
| DOM 入口 | `HOST = wujie-app`，`SHADOW = HOST().shadowRoot`；编辑器选择器 `EDITOR_SEL = '[class*="_promptEditor_"]'`。**站点改类名 → 全挂，先改这里** |
| 读写 | `richFiber(ed)` 从 `__reactFiber$` 向上找带 `referenceItems / onChange / value` 的 props；`api()` 返回 `{ el, refs, props, maxLength, set }` |
| 文本模型 | `serialize()`：DOM → 纯文本（mention 芯片 → `@图片N`）；`rangeFromOffset()`：偏移 → Range。两者规则必须同步改 |
| 素材索引 | `buildIndex(refs)` 按类型编号生成 `图片N / 视频N / 音频N` |
| 面板 | `render()` 分发 `renderAsset / renderHistory / renderFind`；`editorKey()`（节点 id + 素材 id/名字）做内容指纹 |
| 切节点刷新 | `syncPanelToEditor()`：400ms 轮询比对指纹 + `focusin/click` 80ms 立即刷新；焦点在面板内时跳过 |
| 定位高亮 | `setPin()` + `followLoop()` 逐帧跟随 Range；`pinClipRects()` 用「编辑器 + 所有 overflow 非 visible 祖先」裁剪，滚出面板即隐藏，滚回重现 |
| 历史 | `HIST` 按节点归档（`histKey`），写回统一走 `writeText()` |
| 路由 | SPA：`CANVAS_ROUTE='/aigc/canvas/'` + `pushState/popstate/hashchange` 钩子启停；`teardown()` 清 UI |
| 热更新 | `loader.js` 比对 `version.json`，拉新 `content.js` 存 `chrome.storage`，`blob:` 注入；置 `__TYQ_FORCE_ONCE` 让新实例接管，旧实例靠 `alive` / `__TYQ_DISPOSE__` 停监听 |

**高风险依赖**：`_promptEditor_` 类名、React fiber props 结构、wujie 挂载方式。任一处变更都可能导致 `api()` 返回 `null`（面板提示「未找到提示词输入框」）。

---

## 4. 安装

### 终端用户（扩展）
1. `edge://extensions`（或 `chrome://extensions`）开启「开发人员模式」
2. 「加载解压缩的扩展」→ 选 `tiaoyue-ref-helper-ext` 文件夹
3. 之后自动更新，无需再操作

### 油猴
安装 `tiaoyue-ref-helper.user.js`（需 Tampermonkey / Violentmonkey）。

### 开发环境
无 npm 依赖，Node 18+ 即可。改完源码执行 `node tools/build.js`。

---

## 5. 发布流程

```bash
node tools/build.js 1.8.0        # 生成 content.js，同步 manifest / version.json / @version
git add -A && git commit -m "v1.8.0" && git push
```

`build.js` 做三件事：
1. 提升 `manifest.json.version`
2. 重写 `version.json`
3. 由 `tiaoyue-ref-helper.user.js` 生成 `content.js`（去掉油猴头，换扩展头）

其他机器：1 小时内自动检查并生效（下次进页面时），或扩展弹窗点「立即检查更新」再刷新画布页。

---

## 6. 版本号规则

| 位置 | 含义 |
|---|---|
| `manifest.json.version` | 内置版（随文件夹分发） |
| `version.json.version` | 线上版（loader 比对） |
| 运行时 | 缓存版 **高于** 内置版 → 用缓存版；否则用内置版 |

- 版本号必须严格递增（`x.y.z`），不涨不会被判定为更新。
- `raw.githubusercontent.com` 有 CDN 缓存（已加时间戳穿透），push 后通常 1 分钟内生效。

---

## 7. 关键函数地图

| 函数 | 作用 |
|---|---|
| `activeEditor()` | 取当前可见编辑器；全部不可见返回 `null`（避免读写隐藏节点） |
| `api()` / `richFiber()` | 从 fiber 拿 props、refs、`set()` |
| `serialize()` / `rangeFromOffset()` | DOM ↔ 纯文本偏移 |
| `buildIndex()` / `scanMatches()` / `convertAll()` | 素材索引、命中扫描、名字转引用 |
| `writeText()` | 唯一写回入口：历史快照 + 长度校验 + 写回 + 延迟重绘 |
| `render()` / `renderAsset()` | 面板渲染主体 |
| `syncPanelToEditor()` / `editorKey()` | 切节点自动刷新 |
| `jumpTo()` / `jumpToken()` / `setPin()` / `followLoop()` | 定位与高亮框 |
| `pinClipRects()` / `isClipper()` | 高亮裁剪（滚出面板即隐藏） |
| `showGuide()` / `buildUI()` / `placePanel()` | 引导、UI、定位 |
| `teardown()` / `onCanvasRoute()` | 路由启停 |
| `loader.js` | 自动更新 |

---

## 8. 已知问题 / 技术债

1. `jumpTo` 与 `jumpToken` 有约 20 行重复逻辑，可抽公共函数。
2. `renderHistory()` 在渲染期间 `pushHistory()`（副作用），反复打开历史页会写档。
3. `histKey()` 无 `nodeId` 时用 refs id 兜底 → **新增素材会重置撤销历史**。
4. 400ms 轮询在超长提示词下重复 `serialize + scanMatches`，可改 MutationObserver 事件驱动。
5. 高亮滚出可视区后 `followLoop` 仍逐帧跑 rAF（可加空闲停止省电）。
6. `previewOn` / `findState.last` 跨节点保留（行为可接受，未清空）。
7. `scrollRangeIntoView()` 内 `const el` 遮蔽全局 `el()` 助手（仅可读性）。
8. 无自动化测试；`ty_probe/` 下有本地验证页与 CDP 脚本，但已被 gitignore。
9. 强依赖站点 DOM / fiber 结构，站点改版需同步改 `EDITOR_SEL` 与 `richFiber()`。

---

## 9. 交接清单

- [ ] GitHub 仓库转移 / 协作者权限（`Lury-Liu/tiaoyue-canvas-helper`）
- [ ] 若仓库改名或转移：改 `tiaoyue-ref-helper-ext/config.js` 的 `TYQ_REPO` / `TYQ_BRANCH`
- [ ] 在新机器执行 `node tools/build.js` 验证可构建
- [ ] commit + push `v1.8.0`（远端仍是 `v1.6.0`）
- [x] `ISSUES.md` 已随仓库；`ty_probe/` 仅入库模拟页与验证脚本（真实提示词/站点源码/截图仍被 gitignore 排除）
- [ ] 把「不要手改 content.js、改源码必须 build」写进交接说明
- [ ] 真机回归（见下）

### 回归清单

1. 打开画布 → 双击节点 → 面板列出素材
2. A/B 节点来回切 → 列表 ≤0.4s 跟随，不串节点
3. 整段转换 / 仅改写选中 → `Alt+Z` 撤销 → 重做
4. 点「已引用」chip → 高亮落在正文；上下滚动框随文字移动，离开面板即消失、滚回重现
5. `Ctrl+F` 查找 → 替换为引用
6. 拖动面板 / 悬浮球 → 刷新后位置保留
7. 扩展弹窗「立即检查更新」→ 在线版本与运行版本一致

---

## 10. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 面板提示「未找到提示词输入框」 | 没双击节点，或站点改了 `_promptEditor_` 类名 / fiber 结构 |
| 检查更新「HTTP 404」 | `config.js` 仓库路径或分支不对；或 `version.json` 没推到 main |
| 检查更新「Failed to fetch」 | 网络问题（GitHub 需可访问）；不影响内置版 |
| 刚 push 完对方还是旧版 | CDN 缓存，通常 1 分钟内；让对方点「立即检查更新」再刷新 |
| 显示已更新但界面没变 | 刷新画布页；看弹窗「运行版本」是否为在线版 |
| 想强制回退内置版 | 删 `chrome.storage.local` 的 `tyq.upd.*`，或把 `version.json` 改成与 manifest 同版本 |
| 素材名变成 `image.png` | 不是经「添加资源 → 上传」导入的；重新上传保留原名 |

---

## 11. 安全说明

- loader 只从 `raw.githubusercontent.com` 拉取，且要求内容长度 ≥5000 且包含 `__TYQ` 标记，防止把 404 HTML 当脚本执行。
- 扩展权限仅 `storage` + `raw.githubusercontent.com`；`content_scripts` 只匹配 `www.tiaoyue.com` 与 `canvas.tiaoyue.com`。
- `content.js` 运行在页面主世界（`world: "MAIN"`），因为要读 React fiber；不向第三方发送数据。
