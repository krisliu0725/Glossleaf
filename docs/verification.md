# M0 验证记录

> 对应 DESIGN.md §17.2「M0 必须回答的问题」与 §17.4「每个阶段的交付要求」。
> 记录日期：2026-10-29。所有结论来自运行时实测，未实测的项明确标注。

## 1. 实测环境

| 项 | 值 | 来源 |
|---|---|---|
| 系统 | macOS 27.0 · arm64 | `sw_vers` / `uname -m` |
| 工具链 Node | v22.22.2 | `node -v` |
| 包管理器 | pnpm 10.33.4 | `pnpm -v` |
| Electron | 45.1.0 | `node_modules/electron/package.json` |
| Electron 内 Node | 24.22.1 | `process.versions.node`（运行时） |
| Chromium | 156.0.8078.49 | `process.versions.chrome`（运行时） |
| SQLite | 3.53.4 | `SELECT sqlite_version()`（运行时） |
| pdfjs-dist | 6.4.299 | lockfile |
| 完整 Xcode | 无（仅 Command Line Tools） | `xcodebuild -version` 失败 |

## 2. 探针结果

运行方式：

```bash
pnpm build
env -u ELECTRON_RUN_AS_NODE \
  JIAN_VIEW=probe JIAN_CAPTURE=/tmp/jian-probe.png \
  ./node_modules/.bin/electron .
```

| # | 检查项 | 结果 | 细节 |
|---|---|---|---|
| 1 | `node:sqlite` 可加载 | ✅ | 导出 `DatabaseSync`、`Session`、`StatementSync`、`backup`、`constants` |
| 2 | SQLite 版本 | ✅ | 3.53.4 |
| 3 | FTS5 编译可用 | ✅ | `CREATE VIRTUAL TABLE … USING fts5` 成功 |
| 4 | FTS5 trigram 中文检索 | ✅ 有条件 | 见 §3 |
| 5 | `porter unicode61` | ✅ | 拉丁词干可用 |
| 6 | `backup()` 一致备份 | ✅ | API 存在，实际备份成功且产物非空 |
| 7 | Zotero 源库只读探测 | ✅ | 副本读出 95 items |
| 8 | 源库 mtime 未被改动 | ✅ | `1779621725423.0308 → 1779621725423.0308`（完全相同） |
| 9 | 样本 PDF 登记与渲染 | ✅ | 198 KB 中文 PDF，6 页，首屏渲染成功 |

条目类型分布（副本实测）：`attachment 52 · journalArticle 33 · annotation 4 · thesis 3 · report 1 · note 1 · newspaperArticle 1`。

> **注**：这 95 是混合 `items` 数，不是「95 篇文献」。按 §11.8 的要求，导入报告必须分列文献、附件、笔记、标注。实际文献条目为 38（33 + 3 + 1 + 1）。

## 3. 关键发现：FTS5 trigram 的两字/一字边界

这是本次探针最有价值的产出，直接影响 §14.3 的检索方案。

在同一段中文文本「城市矿产开发利用的前景与影响因素」上，用真实子串逐级测试：

| 查询 | 字数 | 结果 |
|---|---|---|
| 城市矿产开发 | 6 | ✅ 命中 |
| 矿产开发 | 4 | ✅ 命中 |
| 城市矿 | 3 | ✅ 命中 |
| **矿产** | **2** | ❌ **未命中** |
| **矿** | **1** | ❌ **未命中** |

**结论**：trigram 按三字符滑窗建立索引，**查询串少于 3 个字符时 MATCH 无法命中**。这是分词器的固有约束，不是配置问题。

**对设计的影响**：

1. §14.3 明确要求「同时考虑一字查询」。trigram 单表无法满足，必须补一层：
   - 方案 A（推荐）：另建一个 `unigram` 索引表，或在 `search_projection` 里对短查询走**受限页扫描**（限定在已打开的文档或最近 N 篇）；
   - 方案 B：改用字符二元组。但 FTS5 不自带 bigram 分词器，需要自定义扩展——本机无完整 Xcode，编译扩展风险高。
2. 短查询（1–2 字）必须在 UI 上明确「正在扩大扫描范围」，并按 §14.3 做结果数与耗时上限。
3. 两字词在中文里是绝对主流（外交、能源、矿产、治理），这不是边缘情况——**必须在 M4 之前解决，不能留到打磨期**。

## 4. M0 七问的完成度

| 问题 | 状态 | 结论 |
|---|---|---|
| ① Electron 提供哪些 SQLite API？FTS 与 tokenizer 是否可用？ | ✅ 完成 | `node:sqlite` 完整可用，FTS5 + trigram + porter 全部可用，`backup()` 可用；短查询有边界限制 |
| ② 打包后 PDF.js 的 worker / 字体 / CMap 能否离线加载？ | ⚠️ 部分 | worker 已作为独立资源打包（1.26 MB）并成功渲染真实 PDF；**CMap 与标准字体未单独验证**，中文 PDF 未出现缺字，但样本不足以证明覆盖 |
| ③ 文本选择、链接、旋转与标注层是否对齐？ | ⬜ 未做 | M0 只做了 canvas 渲染，未接入 PDF.js 文本层与链接层 |
| ④ 自定义文件访问、Range 与取消是否在打包版本中正确工作？ | ⚠️ 部分 | `jian://` 协议已实现，200 与 206 分支、三种 Range 形式、416 处理均已写；**端到端 Range 请求未验证**，取消未验证 |
| ⑤ 一致数据库备份 + 附件清单能否完整恢复？ | ⚠️ 部分 | `backup()` 实测成功；**附件清单与恢复流程未实现** |
| ⑥ 1440px 与约 1000px 窗口下是否可读且稳定？ | ⚠️ 部分 | 1280×820 下文库与双语两页样稿已出且可读；**1000px 与 200% UI 放大未验证** |
| ⑦ 云端与本地翻译服务是否具备所需能力？ | ⬜ 未做 | 尚无密钥与端点配置，未测 |

**总体判断**：M0 的**技术底座三问（SQLite / PDF.js / 协议）已得到肯定答案**，可以进入 M1。其余四项属于实现验证，应在 M1–M3 中随功能落地补做，不阻塞开工。

## 5. 已交付产物

| 产物 | 路径 |
|---|---|
| 可运行打包壳（三入口 CJS/ESM 正确） | `out/main` · `out/preload` · `out/renderer` |
| SQLite 能力探针 | `src/main/probe/sqlite.ts` |
| 样本 PDF 发现与登记 | `src/main/probe/sample.ts` |
| 文档访问协议（token + Range） | `src/main/protocol.ts` |
| 设计 token 与基础组件样式 | `src/renderer/src/design/tokens.css` · `global.css` |
| 文库界面样稿 | `src/renderer/src/views/LibraryView.tsx` |
| 双语阅读界面样稿 | `src/renderer/src/views/ReaderView.tsx` |
| 探针结果面板 | `src/renderer/src/views/ProbeView.tsx` |

截图：`/tmp/jian-probe3.png`、`/tmp/jian-library.png`、`/tmp/jian-reader2.png`。

## 6. 环境坑（必读）

**`ELECTRON_RUN_AS_NODE=1` 会导致 Electron 退化成纯 Node 运行。**

本机该变量由宿主进程（WorkBuddy 自身是 Electron 应用）继承而来，表现为：

```
TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')
    at registerDocumentScheme (...)
Node.js v24.22.1        ← 注意这里，说明跑的是 Node 而不是 Electron
```

所有启动命令都要清掉它：

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
env -u ELECTRON_RUN_AS_NODE pnpm dev
```

建议后续在 `package.json` 的 scripts 里直接内联，避免每次手写。

## 7. 与 DESIGN.md 的偏离

| 位置 | 偏离 | 原因 |
|---|---|---|
| §9.2 preload 构建 | 已按 CJS 输出，符合 | — |
| §6.4 token | 完整照搬，未改色值 | — |
| §7.2 阅读器工具栏 | M0 用 56px 单栏，未做 52px 双栏 | 窗口按钮需要 56px 承载；52px 的阅读器工具栏在 M3 与真实工具栏一起定 |
| §15.2 CSP | **未实现** | 开发期 Vite HMR 与 CSP 冲突，留到 M5 用响应头按环境分发 |
| §11.1 导入前提 | 探针只读副本，未强制退出 Zotero | 探针不改任何状态；正式导入器（M2）必须强制退出 |
| 应用名 / bundle ID | 仍为占位 `jian` / 未定 | 按 §15.7，首次正式分发前确定 |

---

# M1 验证记录（文库与恢复底座）

> 记录日期：2026-10-29。对应 DESIGN.md §17.1 M1 与 §16.4 数据验收表。

## 1. 交付物

| 模块 | 路径 | 说明 |
|---|---|---|
| 领域模型 DDL | `src/data-service/schema.ts` | 30 张表 + FTS5 影子表，对应 §10.2 全部对象 |
| 连接与迁移 | `src/data-service/db.ts` | 单写连接、WAL、外键、busy_timeout、版本迁移 |
| 仓储层 | `src/data-service/repo.ts` | 列表/详情/集合/标签/导入/阅读位置 |
| 备份与恢复 | `src/data-service/backup.ts` | 一致快照、清单校验、暂存换入 |
| 数据服务进程 | `src/data-service/index.ts` | `utilityProcess` 消息循环，唯一写连接 |
| 主进程客户端 | `src/main/data-client.ts` | 进程生命周期、请求 ID、超时、崩溃清理 |
| IPC 层 | `src/main/ipc.ts` | 具名方法 + 调用方校验 + Result 包装 |
| 文库界面 | `src/renderer/src/views/LibraryView.tsx` | 三栏、搜索、拖入、导入、备份、详情 |
| 阅读器 | `src/renderer/src/views/ReaderView.tsx` + `reader/*` | 连续滚动、可见性渲染、缩放、阅读位置 |

## 2. 验收结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| PDF 可读 | ✅ | 导入真实中文 PDF（《北约东扩以来的俄罗斯外交》），连续渲染 6 页，缩放 50%–300% |
| 数据重启保留 | ✅ | 多次重启后文献、附件、阅读位置均保留；`reading_state.pageIndex = 3` 被正确恢复到第 4 页 |
| 备份能在空目录恢复 | ✅ | 备份 `20261029-100134` 复制到 `/tmp/jian-restore-target` 后恢复成功：`items 1 / documents 1 / totalBytes 326777`，blob 一并还原，恢复后阅读器正常打开 |

附加验证：

- 备份 `verified: true`（数据库 `integrity_check` + 9 类实体计数 + blob 逐个 sha256 比对全部通过）
- 恢复后原库保留为 `jian.sqlite.pre-restore-<时间戳>`，未被直接覆盖
- 退出时数据服务显式 `close()`，WAL 已 checkpoint，下次打开不依赖恢复

## 3. 实现要点

**内容寻址的附件**：文件按 `blobs/<sha 前2位>/<sha 次2位>/<sha256>.<ext>` 存放，同一内容只存一份。重复导入同一 PDF 时返回 `duplicate: true`，不产生新实体。APFS 上用 `COPYFILE_FICLONE`，复制不占额外空间。

**备份包结构**：

```
backups/<YYYYMMDD-HHmmss>/
├── jian.sqlite        # SQLite backup() 产出的一致快照
├── manifest.json      # 格式版本、schema 版本、实体计数、blob 哈希与大小
└── blobs/...          # 完整包内含，因此可恢复到空目录
```

**恢复流程**：校验 → 解包到 `.restore-staging` → 关闭连接 → 原库改名保留 → 清 WAL/SHM → 原子 rename 换入 → 重新打开 → 复算计数。任何一步校验不通过都拒绝恢复。

## 4. 开发中发现并修复的问题

| 问题 | 现象 | 修复 |
|---|---|---|
| 全新库读 `meta` 表 | `no such table: meta`，数据服务初始化失败 | 先查 `sqlite_master` 再决定读版本号 |
| `note` 表无 `createdAt` | 详情查询报 `no such column: createdAt` | 改为 join `entity` 取创建时间 |
| 备份计数拼表名 | `verified: false`，因为 `blobs` 被拼成不存在的表 | 改为显式 `COUNT_TABLES` 映射，不再用键名猜表名 |
| `init` 错误被吞 | 主进程只看到「数据服务尚未初始化」 | `init` 改走 `call()`，错误必须抛出 |
| `File.path` 已移除 | 拖入文件拿不到路径 | 改用 `webUtils.getPathForFile`（Electron 32+ 要求） |
| 阅读器空白 | 自动打开期间无内容渲染 | 补等待态，并在无可用附件时退回文库 |

## 5. 与 DESIGN.md 的偏离

| 位置 | 偏离 | 原因 |
|---|---|---|
| §9.2 进程职责 | 已实现独立数据服务进程与唯一写连接；但**未实现独立的全文抽取进程** | 全文抽取属 M4，届时单列 worker |
| §10.2 表名 | `layout_cache` / `layout_override` / `translation_cache` / `translation_record` / `glossary_entry` / `job` / `job_unit` / `search_projection` 已建表但未使用 | 表先建好，避免后续加表迁移 |
| §11 导入 | 未实现 Zotero 适配器 | 属 M2 |
| §14.2 检索 | 当前为元数据 LIKE，非 FTS | 全文索引属 M4；`search_fts` 表已建好待接入 |
| §15.2 CSP | **未实现**，仍有 Electron 不安全 CSP 警告 | 开发期 Vite HMR 与严格 CSP 冲突，M5 用响应头按环境分发 |
| §7.2 阅读器 | 未做 PDF.js 标准文本层与链接层 | M1 只保证「可读」；文本层在 M3 与选区翻译一起接 |

## 6. M1 未覆盖、需在 M2/M3 补做

- Zotero 版本化适配器、快照、三方差异、导入报告（M2）
- PDF 标准文本层、链接层、旋转与裁切页（M3）
- 选区与锚点、摘录、术语表、翻译任务（M3）
- 全文抽取与 FTS 检索（M4）
- CSP、诊断包、1000px 窄窗与 200% UI 放大（M5）

---

# M2 验证记录（Zotero 迁移）

> 记录日期：2026-10-29。对应 DESIGN.md §11 与 §16.4 数据验收表。

## 1. 交付物

| 模块 | 路径 | 说明 |
|---|---|---|
| 结构探针 | `src/adapters/zotero/probe.ts` | 表/列/字段字典检测，**结构是契约、版本号只记录** |
| 快照 | `src/adapters/zotero/snapshot.ts` | 退出检测、复制前后状态比对、副本恢复与完整性检查 |
| 读取 | `src/adapters/zotero/read.ts` | 按名称映射字段与作者角色，不依赖源数字 ID |
| 规范化 | `src/adapters/zotero/normalize.ts` | 未知类型落 `other` 并保留原类型名，未知字段原样保留 |
| 三方合并 | `src/adapters/zotero/diff.ts` | B/L/S 字段级合并，默认不覆盖本地 |
| 导入编排 | `src/adapters/zotero/importer.ts` | 暂存文件 → 单事务提交 → 发布；runId 与失败回滚 |
| 迁移 UI | `src/renderer/src/views/ZoteroImportDialog.tsx` | 检测 / 导入 / 报告三段式 |
| 库迁移 | `schema.ts` v2 | `import_run`、`relation_override`、`import_conflict`、关系贡献来源列 |

## 2. 验收结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| **不改原库** | ✅ | 导入前后 `~/Zotero/zotero.sqlite` mtime 均为 `1779621725`，一毫秒未变；全程未用 SQLite 打开原库 |
| **无重复** | ✅ | 同一快照连续导入三次：`created 51 → 0 → 0`，实体数稳定在 `items 51 / documents 51 / versions 50 / collections 6 / tags 115` |
| **冲突可解释** | ✅（部分） | 本地改标题后重导入：标题保留，报告 `keptLocal: 2` 并明确列出原因；冲突写入 `import_conflict` 表 |
| **故障可恢复** | ⚠️ 部分 | 快照失败即整组丢弃并报错；导入失败时事务回滚、`import_run.status='failed'` 并记错误；**崩溃后孤立 blob 的清理尚未实现** |

### 导入计数（真实库）

```
文献 37 · 附件 52 · 笔记 1 · 标注 4 · 集合 6 · 标签 115
跳过回收站 11 · 待定位 1 · 不支持 3（CAJ）· 冲突 0
```

> 源库 95 是混合 `items` 数：52 附件 + 1 笔记 + 4 标注 + 38 文献 = 95。
> 其中 11 条在回收站（含 1 篇文献），故实际导入 37 篇文献。

### 结构核对

- **集合层级**：6 个集合全部 `parentId = null`，与源库一致
- **作者顺序**：逐条按 `orderIndex` 保留；西方姓名拆为 family/given，中文单字段姓名保持整体
- **机构/中文作者**：源库 `fieldMode=1` 共 52 条，导入后 `nameMode='literal'` 恰好 52 条
- **标注位置**：`anchorsJson` 保留 `pageIndex` 与原始 `rects`，并补上 `documentVersionId` 与 `exact`
- **附件哈希**：`file_blob` 50 条，内容寻址；1 个外链附件标为待定位、无版本

## 3. 关键设计点

**结构是契约，不是版本号。** 适配器声明所需表与列；`userdata=125` 只做记录。结构完全匹配就继续，缺表缺列就阻断并提示改用导出路径——不用「版本 ≥ N 都接受」代替兼容性判断。

**单事务发布。** 文件先以内容寻址落盘（不可变、无引用），数据库写入集中在一个事务里。因此「预备数据在提交前不出现在正常文库」是由事务保证的，不靠状态字段过滤。

**本地优先。** 三方比较默认保留本地：`S=B, L≠B` 时保留本地并计入 `keptLocal`；两端都改且不同则记 `import_conflict` 并保留本地。标签与集合成员记录 `originSourceId`，来源移除只撤自己的贡献。

**未知不猜测。** 未知文献类型落 `other` 并保留 `__sourceType`；找不到的附件标「待定位」而不是按文件大小猜；`attachments:` 相对外链需要基础目录授权，M2 直接标待定位。

## 4. 开发中发现并修复的问题

| 问题 | 现象 | 修复 |
|---|---|---|
| 外键顺序 | `FOREIGN KEY constraint failed`：`document_version` 先于 `document` 插入 | 先落 document 行，再建版本，最后回填 `activeVersionId` |
| 报告字段缺失 | 「保留本地修改」被算进「未变」，看不出发生过保留 | 增加 `keptLocal` 独立计数并在报告中说明 |
| 构建静默失败 | 连续三次截图是同一张旧图，实际在跑旧包 | 改为每次显式检查 `pnpm build` 输出，不再整体重定向到 /dev/null |
| 模态被误关 | 对话框在 4 秒后被一个合成 mousedown 关闭 | 取消「点背景关闭」，只保留明确的关闭按钮；导入进行中误点背景本来也不该关窗 |
| 时间显示 UTC | 上次导入时间比本地时间早 8 小时 | 改为 `toLocaleString('zh-CN')` |

## 5. 与 DESIGN.md 的偏离

| 位置 | 偏离 | 原因 |
|---|---|---|
| §11.6 可恢复导入 | 实现了 runId、单事务发布、失败回滚；**未实现崩溃后孤立 blob 的清理** | 需要启动时的引用扫描，留到 M5 与清理策略一起做 |
| §11.7 冲突 | 字段级合并与冲突记录已实现；**未做冲突比较 UI** | 报告里已列出冲突条目与字段，逐字段比较界面属 M5 |
| §11.7 本地移除覆盖 | `relation_override` 表已建，导入时已读取；**尚无写入入口** | 需要「移除来源关系」的交互，属 M3/M5 |
| §11.5 富文本笔记 | 原始 HTML 存 `importedOriginalHtml`，正文存纯文本；**未做只读白名单渲染** | 渲染属 M3 的笔记面板 |
| §11.4 外链附件 | `attachments:` 相对路径一律标待定位 | 需要用户授权基础目录的交互，属 M5 |

## 6. M2 未覆盖

- 崩溃后孤立 blob 清理（M5）
- 冲突逐字段比较界面（M5）
- 富文本笔记只读渲染与白名单（M3）
- 「包含回收站」的可选导入（未排期）
- 相对外链附件的基础目录授权（M5）

---

# M3 验证补充 · 2026-10-29

本轮从 M2 交接包独立副本继续实现，版本为 0.3.0。原有 M0/M1/M2 记录保留作为历史，不代表本轮重新测试用户真实库。

- 已完成：标准 PDF 文本层与链接、页级原文坐标、高亮/摘录、逐段联动译文、带语境选区流式翻译、兼容云端与 Ollama 协议、术语表、语义缓存、引用计数取消、任务暂停/继续/重启检查点、设置及笔记只读白名单。
- 验证：严格类型检查、生产构建、10 项自动测试通过；普通 PDF 与 90° 旋转/非零 CropBox 两类真实 Electron 端到端流程通过。
- 样本：全部是自动生成的合成两页 PDF 与本机模拟翻译服务，未读取真实文献或真实服务密钥。
- 额外修复：备份 schema 版本检查、从一致副本读取备份清单、CSP 与主 frame 校验、旧请求晚到隔离、端点变更密钥保护。
- 设计取舍：窄窗用上下双语面板；段落锚点承担联动。行间重排、OCR、全文检索、DOI、引用导出等未混入 M3。
- 仍需实测：人工标注真实论文的段落 F1，多语/RTL/罕见字体，长文资源预算，真实云端与本地模型质量/延迟/费用，完整 VoiceOver 流程。

详细步骤、结果和已知边界见 `docs/M3-验收与使用说明.md`。最新交接以 `HANDOFF.md` 为准，旧交接见 `docs/archive/handoff-m2-20261029.md`。


# API 自定义配置补充 · 0.3.1 · 2026-10-29

新增 DeepSeek / Google Gemma 4 / Gemini / Ollama 预设，基础地址、模型、密钥、协议、温度和超时可调整。Google 使用原生流式接口和头部密钥。提供草稿测试、模型列表分页与端点隔离密钥。旧全局密钥在切换前按旧配置迁移。

严格类型检查、生产构建、15 项自动测试通过。兼容接口与 Google 原生接口均通过真实 Electron 界面流程；普通和旋转 PDF 用合成样本，本机模拟 API 不代表真实云端质量与权限验证。详情见 `API-配置说明.md`。


# M4 验证补充 · 0.4.0 · 2026-10-29

新增本地 PDF 后台抽取与页级全文索引、文献信息/摘录搜索、PDF 定位、DOI 预览与确认入库、元数据编辑、正式 CSL 引用以及 CSL-JSON / BibTeX / Markdown / JSON 导出。

严格类型检查、生产构建、26 项自动回归通过。M4 普通/旋转 PDF 的真实 Electron 流程与 M3 Google 原生协议回归通过。BibTeX 和 CSL-JSON 使用独立 Citation.js 解析器读回；公开 DOI 的真实 Crossref 查询通过。合成夹具与模拟服务不代表真实论文全覆盖，也未调用用户模型 API。

数据库 v2→v3 在升级前创建一致快照；备份恢复后可继续搜索和导出。具体行为、受密码保护 PDF 等边界与后续范围详见 `M4-验收与使用说明.md`。
