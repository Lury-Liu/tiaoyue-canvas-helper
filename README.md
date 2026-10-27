# 画布引用助手 · 自动更新说明

> **仓库**：https://github.com/Lury-Liu/tiaoyue-canvas-helper
> **当前线上版本**：见 `tiaoyue-ref-helper-ext/version.json`

## 一、工作原理

```
tiaoyue-ref-helper-ext/
├─ config.js        ← 唯一要改的文件：填你的 GitHub 仓库
├─ loader.js        ← 隔离世界：每次进页面检查更新，有新版就热替换
├─ content.js       ← 内置兜底版（断网/没更新时用）
├─ manifest.json
├─ popup.html/js    ← 点扩展图标可看版本、手动检查更新
└─ icons/
```

- 站点（www.tiaoyue.com）没有 CSP，因此 loader 用 `blob:` + `<script>` 把新代码注入页面主世界，**页面里原有的旧实例会被自动清掉再接管**。
- 检查节流：每 1 小时最多联网一次；`popup` 里点「立即检查更新」可手动触发。
- 断网、仓库未配置、GitHub 挂了 → 一律回退到内置 `content.js`，功能不受影响。

## 二、当前状态（已完成）

| 项 | 值 |
|---|---|
| GitHub 仓库 | `Lury-Liu/tiaoyue-canvas-helper`（public） |
| 默认分支 | `main` |
| `config.js` | 已填好仓库地址，无需再改 |
| 线上版本文件 | `tiaoyue-ref-helper-ext/version.json` |

### 其他机器装一次
1. `edge://extensions` 开「开发人员模式」
2. 「加载解压缩的扩展」→ 选 `tiaoyue-ref-helper-ext` 文件夹
3. 之后自动更新，无需再操作

## 三、日常发布（只在这台主机）

```bash
node tools/build.js 1.5.3     # 重新生成 content.js，并同步 manifest / version.json / @version
git add -A && git commit -m "v1.5.3" && git push
```

其他机器：
- 1 小时内自动检查并生效（下次进页面时）
- 或让对方点扩展图标 →「立即检查更新」→ 刷新画布页

## 四、版本号规则

- `manifest.json` 的 `version` = 内置版（随文件夹分发）
- `version.json` 的 `version` = 线上版
- 运行时若缓存版 **高于** 内置版 → 用缓存版；否则用内置版
- 也就是说：**发新版一定要 `node tools/build.js <新版本号>`**，版本号不涨不会被认为更新

## 五、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 状态显示「检查失败：HTTP 404」 | 仓库路径或分支不对；或 `version.json` 没推到 main |
| 状态显示「检查失败：Failed to fetch」 | 网络问题（GitHub 需要能访问）；不影响兜底版 |
| 刚 push 完对方还是旧版 | `raw.githubusercontent.com` 有 CDN 缓存（已加时间戳穿透，通常 1 分钟内生效）；让对方点「立即检查更新」再刷新页面 |
| 显示已更新但界面没变 | 刷新画布页；或面板里看「运行版本」是否为在线版 |
| 想强制回退内置版 | `chrome.storage.local` 删 `tyq.upd.*`，或把 `version.json` 改成与 manifest 同版本 |

## 六、安全说明

- loader 只从 `raw.githubusercontent.com` 拉取，且要求内容长度 ≥5000 且包含 `__TYQ` 标记，防止拉到错误页面（如 404 HTML）被当脚本执行。
- 扩展权限只有 `storage` + 访问 `raw.githubusercontent.com`，不读取浏览记录、不注入其他站点。
