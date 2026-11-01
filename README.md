# Glossleaf · 笺

> A quiet home for reading and research.
> 一个给中文母语研究者的本地文献工作台：把外文文献读得下去，把读过的内容找得回来。

macOS 桌面应用 · Electron + React + TypeScript + PDF.js · 本地优先，不上传任何阅读数据。

---

## 它解决什么

中文研究者读外文期刊时的三个具体困境：**读得慢、读完忘、引不准**。

Glossleaf 的做法是：PDF 原文始终是主角，译文按段落对读；所有批注（高亮、朱批）锚定在 PDF 页面坐标上，缩放、旋转、换设备都不丢；札记把一篇文献的阅读成果收成一份可检索、可导出的清单。

---

## 主要功能

| 模块 | 说明 |
|---|---|
| **书府 Library** | 文献列表、集合（卷帙）、标签（题签）、详情面板、导入 PDF 与 Zotero 迁移 |
| **展笺 Reader** | 原文 / 对读双模式，段落级译文联动，页码胶囊（物理页 / 刊印页 / 相对跳转） |
| **批注** | 高亮（7 套色谱 × 6 色）+ 朱批（句批 / 旁批）+ 札记统一视图，全部可撤销 |
| **考索 Search** | 全文检索，命中词高亮，点结果直达原文位置 |
| **笺注 Translation** | DeepSeek / OpenAI / Claude / Kimi / Gemini / Ollama，可自改端点与模型，带缓存与术语表 |
| **征引 Cite** | CSL 引文（APA / MLA 等）、RIS / BibTeX / CSL-JSON 导出 |
| **小传 Profile** | 有效阅读时长、阅读热力图、研究方向（由文献标签聚合）、Token 用量 |
| **留存 Backup** | 一致性快照 + 内容哈希校验，可恢复到空目录 |

---

## 快速开始

需要 Node ≥ 22 与 pnpm ≥ 10。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test          # 93 项单元与集成测试
pnpm build
pnpm start
```

> **如果启动时报 `sandbox initialization failed` 并崩溃**，说明宿主环境限制了 Chromium 沙箱，用
> `./scripts/run.sh start --no-sandbox` 启动。正常桌面环境不需要这个参数。

---

## 文档

| 文件 | 内容 |
|---|---|
| [`docs/GLOSSLEAF_UI_REDESIGN_v2.1.md`](docs/GLOSSLEAF_UI_REDESIGN_v2.1.md) | 命名体系、阅读页与书府页重构方案（**设计意图的权威原文**） |
| [`docs/GLOSSLEAF_ANNOTATIONS_v1.2.md`](docs/GLOSSLEAF_ANNOTATIONS_v1.2.md) | 高亮 / 朱批 / 札记的完整规格与数据模型 |
| [`docs/READING-PAGE-PLAN-20261031.md`](docs/READING-PAGE-PLAN-20261031.md) | 阅读页工具栏、页码、朱批的改版方案 |
| [`docs/READER-FUSION-DESIGN.md`](docs/READER-FUSION-DESIGN.md) | 原文与译文的融合布局 |
| [`DESIGN.md`](DESIGN.md) | 早期技术设计（领域模型、进程架构、里程碑） |
| [`HANDOFF.md`](HANDOFF.md) | 当前版本的开发交接说明 |
| [`THIRD_PARTY.md`](THIRD_PARTY.md) | 第三方依赖与许可 |

---

## 架构

```
渲染进程（sandbox / contextIsolation）
  └─ 只通过 window.jian.* 具名方法通信
        │
   preload（Result<T> 包装，错误不抛到渲染层）
        │
主进程（窗口、jian:// 文档协议、翻译调度、密钥安全存储）
        │
独立数据服务进程（utilityProcess）
  └─ 全应用唯一 SQLite 写连接
```

三处不可破坏的约束：**数据服务单写连接**、**`origin_map` 四元外部标识**、**`document_version` 的「受管理文件或有效授权」二选一**。

---

## 状态

当前版本 0.11.1，数据库 schema 7。

- 类型检查、生产构建、93 项测试通过
- 已知问题：部分 Electron e2e 回归脚本与当前界面文案不同步（详见 `docs/REVIEW-0.11.1.md` 与交接说明）
- 未做 OCR、并排双 PDF、多窗口；打开的标签不跨重启恢复
- macOS 包为 ad-hoc 签名，未做 Developer ID 公证

---

## 许可

UNLICENSED · 私有项目，未授权分发。第三方组件许可见 [`THIRD_PARTY.md`](THIRD_PARTY.md) 与 `resources/licenses/`。
