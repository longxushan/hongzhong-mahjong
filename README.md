# 巢湖-金华红中

一款**单文件、零外部依赖**的教学型红中麻将 H5。4 人对局（玩家 1 人 + AI 3 人），核心特色是「超级麻将高手师傅」在真实牌局中持续教学，用向听数精算讲牌理，而不是背口诀。

> 牌面 SVG、头像素材、CSS、JavaScript 全部内联在 `index.html` 中，不请求任何网络资源，双击即可运行，放到任何路径/子目录都无需改 base 路径。

## 在线游玩

**https://longxushan.github.io/hongzhong-mahjong/**

由 GitHub Pages 托管。每次 `push` 到 `main` 分支会由 Actions 自动重新部署，约 1 分钟内生效。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `index.html` | **唯一主文件**，即原来的 `红中麻将.html`。所有优化与调试只改这一个文件，避免多副本版本漂移 |
| `docs/跨智能体复刻与调试手册.md` | 规则基线、算法规格、状态机、调试与验证方法（改动前必读） |
| `docs/游戏策略与代码说明.md` | 当前版本的策略与规则备份说明（含逐版要点日志） |
| `docs/最优打法建议.md` | 攻略三件套之一：面向玩家的打法攻略 |
| `voice/` | 语音包 mp3（`scripts/gen-voice.py` 用 Edge TTS 生成；台词从 index.html 解析，防双份文本漂移） |
| `cloud-sdk.js` | 云端经验累加 SDK 本地副本（线上 jsdelivr 失败时回落加载，必须随仓库部署） |
| `scripts/serve.mjs` | 零依赖本地静态服务器 |
| `scripts/verify.mjs` | Playwright 冒烟验证：牌数守恒 112、规则弹窗同步、零 JS 报错 |
| `scripts/test-*.mjs` | 30+ 个专项回归（布局/拖动/教学/规则/听牌/方向自适应等），改哪块跑哪块 |
| `scripts/publish.mjs` | 免凭证发布脚本（在 WorkBuddy 环境内使用） |
| `.github/workflows/pages.yml` | Pages 自动部署（`configure-pages` 会自动启用 Pages） |

原始头像素材（`*头像.png`）不入库：游戏内头像已 base64 内联，素材原图留存在本地工作区，需要换头像时再取用。

## 日常改动与上线

### 方式 A：标准 Git（推荐）

```bash
git add -A
git commit -m "fix: 调整教学推荐逻辑"
git push origin main
```

GitHub 凭证已保存在本机凭据管理器（Git Credential Manager + gh CLI），`git push` 免登录；若凭证失效，用 `gh auth login` 设备授权流恢复。

### 方式 B：WorkBuddy 内让我代发

直接在 WorkBuddy 对话里说「把红中麻将推上去」，我会执行 `git push`。GitHub 凭证已保存在本机凭据管理器（Git Credential Manager），推送免登录。

> 注意：`scripts/publish.mjs`（GitHub 连接器通道）对新建仓库不可用——集成令牌对个人新仓库无写入权限（403 Resource not accessible by integration），仅对账号下已授权的旧仓库可能有效，保留作备用。

### 本地预览与验证

```bash
npm run dev        # http://127.0.0.1:8765/
npm install        # 首次验证前安装 playwright-core（仅验证用，游戏本身零依赖）
npm run verify     # 用本机 Edge 跑冒烟验证
```

验证脚本会自动探测本机 Edge / Chrome；也可通过 `BROWSER_PATH` 环境变量指定浏览器可执行文件。

## 迭代铁律

1. **规则基线锁定**：112 张牌、红中硬规则、五步计分、留底 6 张、8 局一轮等口径见 `docs/跨智能体复刻与调试手册.md` 第二部分，改动不得漂移。
2. **守恒优先**：任意时刻 `所有 hand + melds + discard + 牌墙区间 == 112`。
3. **真实闭环**：改真实文件 → 真实浏览器验证（零 pageerror、守恒、口径、教学推荐向听最优）→ 再提交上线。
4. **听牌剩余数双口径**：玩家教学侧（听牌一览/浮层/对手分析）用可见口径 `visibleLeft`（4 − 自己手牌 − 四家弃牌 − 明面副露）；AI 精算仍用牌墙真实口径 `tileRemaining`。玩家界面不偷看别家暗牌。

## 版本记录

- `v1.0.0` · 2026-11-08 21:21 — 初始入库。来源：`红中麻将-源码包/`（单文件 1,150,752 字节 + 两份说明文档）；建立 Git 仓库、GitHub Pages 自动部署与本地验证脚本。
