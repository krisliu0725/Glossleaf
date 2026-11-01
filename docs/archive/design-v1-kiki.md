# 笺（Jian）设计文档 v1.0

> **状态**：待审查 · 未开始编码
> **作者**：Kiki
> **日期**：2026-10-29
> **一句话定位**：一个 macOS 原生的极简文献管理器，把「中文母语者读外文文献」做成第一等功能，而不是靠插件补丁。
>
> 本文档是完整设计稿，包含：产品边界、技术选型论证、完整数据模型 DDL、两大技术命门的算法细节、UI 规范全表、IPC 契约、分期验收标准、风险清单。
> 文末有「待你确认的 5 个点」，请重点看。

---

## 目录

1. [产品定位与边界](#1-产品定位与边界)
2. [已核实的事实](#2-已核实的事实)
3. [技术选型与论证](#3-技术选型与论证)
4. [数据模型](#4-数据模型)
5. [Zotero 库迁移](#5-zotero-库迁移)
6. [命门一：段落级双语对照的渲染架构](#6-命门一段落级双语对照的渲染架构)
7. [命门二：段落还原算法](#7-命门二段落还原算法)
8. [翻译管线](#8-翻译管线)
9. [划词翻译与结果沉淀](#9-划词翻译与结果沉淀)
10. [入库能力](#10-入库能力)
11. [UI 设计规范](#11-ui-设计规范)
12. [IPC 契约](#12-ipc-契约)
13. [分期与验收](#13-分期与验收)
14. [风险清单](#14-风险清单)
15. [文件清单](#15-文件清单)
16. [待确认的点](#16-待确认的点)
17. [附录](#17-附录)

---

## 1. 产品定位与边界

### 1.1 为什么不是「又一个 Zotero」

Zotero 的问题不在于功能不够，而在于**功能太多、都靠插件**。一个中国学生要用 Zotero 读外文文献，标准配置是：Zotero + Zotero Connector + Translate for Zotero + Jasminum + Better BibTeX + Zotero Style + zotero-pdf2zh。七个东西，三套配置界面，每次 Zotero 大版本升级坏一半。

笺的赌注是：**把这七件事里最核心的三件（管文献、读 PDF、翻译）做成一个东西，本体保持极简**。

### 1.2 功能边界表

| Zotero 的能力 | 笺 | 说明 |
|---|---|---|
| 条目元数据管理（多类型增删改） | ✅ | 复用 Zotero schema，覆盖 journalArticle / book / bookSection / thesis / report / webpage / preprint / newspaperArticle |
| 从 DOI / arXiv / PMID 抓元数据 | ✅ | CrossRef + arXiv + PubMed |
| 拖 PDF 进来自动建条目 | ✅ | 抽首页文本 → 猜 DOI → 抓取 → 失败则猜标题作者 → 一律进可编辑预览 |
| 分类集合 + 标签 | ✅ | 扁平与嵌套都支持 |
| 全文搜索 | ✅ | FTS5 `trigram`（中文必需）+ 后台抽取 PDF 文本层 |
| PDF 阅读 + 高亮/下划线/文本注释 | ✅ | `position` 结构与 Zotero 完全一致 |
| 笔记 | ✅ 简版 | 纯文本 + 原文锚点回跳；**不做** ProseMirror 富文本 |
| 引用格式化（CSL） | ✅ 简版 | citeproc-js + GB/T 7714 + APA + Chicago，复制到剪贴板；**不做** Word/LibreOffice 插件 |
| 导入导出 | ✅ | CSL-JSON / BibTeX / RIS |
| 迁移现有 Zotero 库 | ✅ | 只读导入 |
| **段落级双语对照** | ✅ **差异点** | Zotero 生态里没有任何插件做到过 |
| **划词翻译 + 结果沉淀** | ✅ **差异点** | 比 zotero-pdf-translate 多一步「可持久化」 |
| 浏览器一键收藏（Connector） | ⏸ 砍掉 | 要实现 23119 协议 + translator 同步 + 端口冲突，只为覆盖一个动作；改由「拖 PDF / 粘 DOI」替代 |
| 加载现有 Zotero 插件 | ❌ 不可行 | 见 1.3 |
| 云同步 / 群组库 / 网页快照 / EPUB / Word 插件 | ❌ | 本地优先，本轮不做 |

### 1.3 为什么「兼容 Zotero 插件」必须放弃

这一条值得单独写清楚，因为它是最初的诉求之一。

**技术判断：直接加载现有 Zotero 插件不可行，不是难，是类别错误。**

Zotero 插件不是「跑在容器里的 JS」，而是 Zotero 这个 Gecko 应用的一部分。它要求宿主提供：

| 要求 | 说明 |
|---|---|
| XPCOM | 插件代码里直接出现 `Services`、`Cc`、`Ci`、`Cc["@mozilla.org/..."]`，背后是 C++ 组件注册表，JS 层无法伪造 |
| `chrome://` 协议 + ESM 加载器 | `ChromeUtils.importESModule("chrome://zotero/content/osfile.mjs")` |
| 与 Zotero 完全一致的 DOM 结构 | `document.getElementById('zotero-items-tree')`、`ZoteroPane.itemsView`、`reader._iframeWindow` |
| 条目树虚拟化渲染器 | `ItemTree` 类，自绘表格 |
| PDF 阅读器 iframe 桥 | 跨进程 iframe 里跑 pdf.js |
| ProseMirror 笔记编辑器 | `Zotero.EditorInstance` |
| `Zotero` 全局对象下 ~40 个子命名空间 | `Zotero.Utilities.Internal` 一个文件就有 60+ 函数，注释写明「不向 translator 公开」 |

这些不是「运行环境」，是 Zotero 的本体。要让它们跑，等于重写 Zotero。

**四条独立证据：**

1. **无先例**：检索未发现任何公开的 Zotero 插件 API shim / polyfill。社区做的是 Web API 客户端（pyzotero、zotero-api-client、libZotero、zotero-mcp），只覆盖 HTTP 层。
2. **官方不提供契约**：Zotero 每个大版本都写一份「如何迁移你的插件」文档（7→8→10 都有），自己承认「JavaScript API 文档不完整」「under-documented」。
3. **生态写法是 monkey-patch**：Better BibTeX 仓库里有 `patches/`、`hooks/` 目录；zotero-style 直接改单元格渲染。要兼容的不是接口签名，是**函数体行为**。
4. **AGPLv3**：复用 Zotero 源码做兼容层，传染性覆盖整个应用。

**前车之鉴**：ZotFile（百万级用户）因为依赖 XUL overlay，Zotero 7 移除 overlay 后直接死亡，作者 2024 年停止维护。连官方升级都能一次性杀死一个插件，说明这个依赖关系有多脆。

**所以兼容性落在三层：**

| 层 | 做法 | 可行性 |
|---|---|---|
| 数据层 | 只读 `zotero.sqlite` + 按 key 拷贝 `storage/` | 高 |
| 格式层 | CSL-JSON / BibTeX / RIS 导入导出 | 高 |
| 协议层 | Zotero Connector 的 5 个 HTTP 端点 | 高，但已砍（见 1.2） |

> **注释**：协议层之所以技术上可行，是因为 Zotero Connector 是**浏览器 WebExtension**，不是 Zotero 插件。它只通过 `127.0.0.1:23119/connector/*` 通信，且**网页抓取（translator 执行）全部发生在浏览器扩展里**，服务端收到的已是完整 item JSON。这是唯一一处「协议级可兼容」的地方。砍掉它是产品取舍，不是技术限制——如果你以后想要，加回来大约是一周的活。

---

## 2. 已核实的事实

> **注释**：这一节全部是实测或一手文档，不是推断。凡是「社区说法」我都标注了可信度。设计方案建立在这些事实上，所以先摆出来。

### 2.1 开发环境

| 项 | 值 | 影响 |
|---|---|---|
| 系统 | macOS 27.0，arm64 | — |
| Node | v22.22.2 | 仅用于工具链，应用内跑的是 Electron 的 Node |
| pnpm | 10.33.4 | 包管理器 |
| **rustc / cargo** | **未安装** | 排除 Tauri |
| **完整 Xcode** | **没有**（仅 Command Line Tools，`xcodebuild` 不可用） | **排除任何需要 node-gyp 编译的原生模块** |
| swiftc | Swift 6.4，可命令行构建 | 但无 Xcode 无法打包 .app，排除原生方案 |
| 磁盘 | 可用 318 GiB | 充裕 |

### 2.2 关键依赖的真实状态

| 包 | 版本 | 核实结果 |
|---|---|---|
| electron | **45.1.0**（2026-10-28 发布） | Chromium 156 + **Node 24.22.1** → `node:sqlite` 可用 |
| pdfjs-dist | **6.4.299** | 纯 ESM（`main: build/pdf.mjs`），Vite 下 worker 打包需注意 |
| better-sqlite3 | 13.0.3 | **GitHub Release 只有源码包，零预编译产物** → 必须 node-gyp 编译 → 本机高风险，**降为备选** |
| node-sqlite3-wasm | 0.8.61 | 纯 WASM，无编译，兜底方案 |

> **注释**：better-sqlite3 这一条是本次调研最有价值的发现之一。网上大量教程默认它「有预编译二进制」，但 13.0.3 的 release 页面实际只有 `Source code (zip)` 和 `Source code (tar.gz)` 两个资产。在只有 Command Line Tools 的机器上，`node-gyp` 虽然通常能用（clang + make 由 CLT 提供），但 Electron 的原生模块 ABI 重编译是另一回事，失败率高。既然 Electron 45 自带 Node 24 的 `node:sqlite`，没有理由冒这个险。

### 2.3 真实 Zotero 库

`~/Zotero/zotero.sqlite`，3.8 MB，`userdata` schema 版本 **125**（Zotero 9.0.3）。

| 项 | 数量 |
|---|---|
| items 总数 | 95 |
| journalArticle | 33 |
| thesis | 3 |
| report | 1 |
| newspaperArticle | 1 |
| attachment | 52（其中 **49 个 PDF**，3 个 `.caj`） |
| note | 1 |
| annotation | 4 |
| collections | 6（**全部 `parentCollectionID` 为 NULL，即扁平**） |
| tags | 115 |
| deletedItems | 11 |

分类名：`SDG13`、`马继亮`、`中日外交`、`国家安全`、`俄罗斯`、`IPE`

附件 linkMode 分布：`0`（imported_file）51 个、`2`（linked_file）1 个。`storage/` 共 52 个子目录、70 MB。

**真实表结构（与网上文档有出入，以此为准）：**

```sql
CREATE TABLE itemAnnotations (
    itemID INTEGER PRIMARY KEY,
    parentItemID INT NOT NULL,
    type INTEGER NOT NULL,          -- 注意：是 type，不是 annotationType
    authorName TEXT, text TEXT, comment TEXT,
    color TEXT, pageLabel TEXT,
    sortIndex TEXT NOT NULL,
    position TEXT NOT NULL,
    isExternal INT NOT NULL,
    FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE,
    FOREIGN KEY (parentItemID) REFERENCES itemAttachments(itemID)
);

CREATE TABLE itemAttachments (
    itemID INTEGER PRIMARY KEY,
    parentItemID INT,
    linkMode INT,                   -- 0 imported_file / 1 imported_url / 2 linked_file / 3 linked_url
    contentType TEXT, charsetID INT,
    path TEXT,                      -- 'storage:裸文件名' 或 'attachments:相对路径'
    syncState INT DEFAULT 0,
    storageModTime INT, storageHash TEXT,
    lastProcessedModificationTime INT, lastRead INT,
    ...
);
```

**标注 `position` 的真实值（PDF 坐标，原点左下，未缩放 pt）：**

```json
{"pageIndex":0,"rects":[[397.696,610.841,528.639,634.212]]}
{"pageIndex":5,"rects":[[343.699,504.981,461.454,517.462],[35.321,480.723,400.516,493.204]]}
```

> **注释**：第二条是跨行高亮，`rects` 数组有两个矩形。渲染时必须支持一个注释对应多个矩形，且这些矩形可能分布在不同的 band 里——这是「注释层放在页面级单一坐标系」而不是「每个 band 各自一个注释层」的直接理由。

### 2.4 Zotero 数据模型的两个反直觉点

**① 没有 `attachments` 表，也没有 `notes` 表。**
附件、笔记、标注都是 `items` 里的一行，只是 `itemTypeID` 不同，再用 `itemAttachments` / `itemNotes` / `itemAnnotations` 做**一对一扩展表**。

所以「一个条目有 3 个 PDF」= items 里 4 行（1 父 + 3 个 `attachment` 子），父子关系靠 `itemAttachments.parentItemID`。

**② 字段值是两级间接，且值全局去重。**

```
itemData(itemID, fieldID, valueID)   -- 纯关联表
   fieldID → fieldsCombined.fieldName
   valueID → itemDataValues.value    -- value 列 UNIQUE
```

后果：同一个标题在 1000 个条目里只存一份字符串。写入时要判断引用计数再决定复用还是新建 value 行。

**关键坑**：`itemData.fieldID` 的外键指向 **`fieldsCombined`**，不是 `fields`。`fieldsCombined` 是启动时 `fields` + `customFields` 合并生成的——**自定义字段（从 Extra 解析出来的）在库里是一等公民**，只读 `fields` 表会漏数据。

**③ 回收站不在 `items` 表。**
`items` 没有 `deleted` 列，删除状态由 `deletedItems` 表表示。

---

## 3. 技术选型与论证

### 3.1 最终技术栈

```
Electron 45.1.0
electron-vite 6
React 19 + TypeScript 5.7 (strict)
pdfjs-dist 6.4.299      PDF 渲染 / 文本层 / 文本抽取
pdf-lib 1.17            后续写回注释（P6 之后）
citeproc-js 3           引用格式化
node:sqlite             主驱动（Electron 45 内置 Node 24）
node-sqlite3-wasm 0.8   兜底驱动
zustand 5               状态
@tanstack/react-virtual 3   列表与页面虚拟化
@floating-ui/dom        划词浮层定位
zod 3                   IPC / 网络响应边界校验
papaparse 5             术语表 CSV
lucide-react            图标
electron-builder 25     打包
```

**没有 Tailwind。** 理由：macOS 原生感的实现主要靠精确的 13pt 字号、1px 分隔线、圆角同心、vibrancy 材质——这些在手写 CSS 里表达更直接，且避免 Tailwind 4 在 electron-vite 下的额外构建风险。设计 token 全部走 CSS 变量，改一处生效全局。

### 3.2 硬性禁止清单

| 禁止 | 理由 |
|---|---|
| `better-sqlite3` 作主方案 | Release 无预编译产物，本机需 node-gyp，风险高 |
| `keytar` | 原生模块。改用 Electron `safeStorage`，不可用时回退 macOS 内置 `security` 命令行 |
| `sharp` / `canvas` | 原生模块。本轮不需要图像处理 |
| `sqlite3` | 同上，且 API 是回调式，不如 `node:sqlite` 顺手 |
| Tailwind | 见上 |

> **注释**：这条清单是整个方案能在这台机器上一次跑通的前提。任何引入 node-gyp 的包，都可能因为「没有完整 Xcode」而卡住半天。

### 3.3 为什么是 Electron 而不是 Tauri / 原生

| 维度 | Electron | Tauri 2 | 原生 Swift |
|---|---|---|---|
| 本机可立即开发 | ✅ Node 22 + pnpm 齐备 | ❌ 需先装 Rust | ⚠️ 仅 SwiftPM，无法打包 .app |
| PDF.js 渲染稳定性 | ✅ Chromium 版本随 app 锁定 | ⚠️ WKWebView 跟系统走，锁不住 | ❌ 用不了 PDF.js |
| 自定义渲染管线（段落级双语） | ✅ DOM/Canvas 完全可控 | ✅ 同 | ❌ PDFKit 不能改渲染管线 |
| 包体 | ~100 MB | 2–20 MB | ~5 MB |
| 常驻内存 | 200 MB 起 | 25–80 MB | ~50 MB |

**决定性因素是第三行。** 段落级双语对照要求「在 PDF 页面中间插入可交互的 DOM 块」——这需要完全接管渲染管线。PDFKit 只能整页渲染，做不到；WKWebView 的 canvas 内存上限比 Chromium 敏感，大 PDF 容易崩。

包体和内存的代价我认，换来的是这个产品的核心能力成立。

---

## 4. 数据模型

### 4.1 核心决策：复用 Zotero schema 子集

**决策**：表名、字段名与 Zotero 一字不改。自有数据全部放 `app_` 前缀表。

**理由三条：**

1. **导入退化成 SQL**：`ATTACH` 源库 + `INSERT...SELECT`，95 条 <1s，无需逐条对象映射。
2. **`itemAnnotations.position` 直接就是内部坐标系**：写注释、渲染注释、导回 Zotero 全部零转换。
3. **将来要导回 Zotero 也零转换**：这是给未来的自己留退路。

**代价**：被 Zotero 的间接层绑架（`itemData` 两级间接、值全局去重）。但这层间接换来的是库体积和一致性，值得。

**唯一强约束**：所有 `app_*` 表用 `itemKey`（8 字符）关联，**绝不存 `itemID`**——重新导入后 `itemID` 会变，`itemKey` 不会。

### 4.2 核心表 DDL

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ========== 字典表（从 Zotero schema JSON 固化，不随 Zotero 升级而变）==========

CREATE TABLE itemTypes (
    itemTypeID INTEGER PRIMARY KEY,
    typeName   TEXT NOT NULL UNIQUE,
    display    TEXT
);

CREATE TABLE fieldsCombined (
    fieldID   INTEGER PRIMARY KEY,
    fieldName TEXT NOT NULL UNIQUE,
    label     TEXT
);

CREATE TABLE itemTypeFields (
    itemTypeID INTEGER NOT NULL,
    fieldID    INTEGER NOT NULL,
    orderIndex INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (itemTypeID, fieldID)
);

CREATE TABLE creatorTypes (
    creatorTypeID INTEGER PRIMARY KEY,
    creatorType   TEXT NOT NULL UNIQUE
);

CREATE TABLE itemTypeCreatorTypes (
    itemTypeID    INTEGER NOT NULL,
    creatorTypeID INTEGER NOT NULL,
    primaryField  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (itemTypeID, creatorTypeID)
);

-- ========== 核心数据表（与 Zotero 同名同构）==========

CREATE TABLE libraries (
    libraryID INTEGER PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'user',
    editable INT NOT NULL DEFAULT 1,
    filesEditable INT NOT NULL DEFAULT 1,
    version INT NOT NULL DEFAULT 0,
    storageVersion INT NOT NULL DEFAULT 0,
    lastSync INT NOT NULL DEFAULT 0,
    archived INT NOT NULL DEFAULT 0,
    isAdmin INT NOT NULL DEFAULT 0
);

CREATE TABLE items (
    itemID INTEGER PRIMARY KEY,
    itemTypeID INT NOT NULL,
    dateAdded TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clientDateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    libraryID INT NOT NULL DEFAULT 1,
    key TEXT NOT NULL,
    version INT NOT NULL DEFAULT 0,
    synced INT NOT NULL DEFAULT 0,
    UNIQUE (libraryID, key),
    FOREIGN KEY (libraryID) REFERENCES libraries(libraryID) ON DELETE CASCADE
);
CREATE INDEX items_itemTypeID ON items(itemTypeID);

CREATE TABLE itemDataValues (
    valueID INTEGER PRIMARY KEY,
    value   UNIQUE,
    valueNormalized TEXT
);

CREATE TABLE itemData (
    itemID  INT NOT NULL,
    fieldID INT NOT NULL,
    valueID INT,
    PRIMARY KEY (itemID, fieldID),
    FOREIGN KEY (itemID)  REFERENCES items(itemID) ON DELETE CASCADE,
    FOREIGN KEY (fieldID) REFERENCES fieldsCombined(fieldID)
);
CREATE INDEX itemData_fieldID ON itemData(fieldID);

CREATE TABLE creators (
    creatorID INTEGER PRIMARY KEY,
    firstName TEXT, lastName TEXT,
    fieldMode INT,                       -- 1 = 机构作者（全名在 lastName）
    firstNameNormalized TEXT,
    lastNameNormalized TEXT,
    UNIQUE (lastName, firstName, fieldMode)
);

CREATE TABLE itemCreators (
    itemID INT NOT NULL,
    creatorID INT NOT NULL,
    creatorTypeID INT NOT NULL DEFAULT 1,
    orderIndex INT NOT NULL DEFAULT 0,
    PRIMARY KEY (itemID, creatorID, creatorTypeID, orderIndex),
    UNIQUE (itemID, orderIndex),
    FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE
);

CREATE TABLE collections (
    collectionID INTEGER PRIMARY KEY,
    collectionName TEXT NOT NULL,
    parentCollectionID INT DEFAULT NULL,
    libraryID INT NOT NULL DEFAULT 1,
    key TEXT NOT NULL,
    version INT NOT NULL DEFAULT 0,
    UNIQUE (libraryID, key)
);

CREATE TABLE collectionItems (
    collectionID INT NOT NULL,
    itemID INT NOT NULL,
    orderIndex INT NOT NULL DEFAULT 0,
    PRIMARY KEY (collectionID, itemID),
    FOREIGN KEY (collectionID) REFERENCES collections(collectionID) ON DELETE CASCADE,
    FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE
);

CREATE TABLE tags (
    tagID INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    nameNormalized TEXT
);

CREATE TABLE itemTags (
    itemID INT NOT NULL,
    tagID  INT NOT NULL,
    type   INT NOT NULL DEFAULT 0,        -- 0 手动 / 1 自动
    PRIMARY KEY (itemID, tagID),
    FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE
);

CREATE TABLE itemAttachments (
    itemID INTEGER PRIMARY KEY,
    parentItemID INT,
    linkMode INT,                         -- 0 imported_file / 1 imported_url / 2 linked_file / 3 linked_url
    contentType TEXT,
    path TEXT,                            -- 'storage:裸文件名' 或绝对路径
    syncState INT DEFAULT 0,
    storageModTime INT,
    storageHash TEXT,
    lastRead INT,
    FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE,
    FOREIGN KEY (parentItemID) REFERENCES items(itemID) ON DELETE CASCADE
);
CREATE INDEX itemAttachments_parentItemID ON itemAttachments(parentItemID);

CREATE TABLE itemNotes (
    itemID INTEGER PRIMARY KEY,
    parentItemID INT,
    note TEXT,
    title TEXT,
    FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE
);

CREATE TABLE itemAnnotations (
    itemID INTEGER PRIMARY KEY,
    parentItemID INT NOT NULL,
    type INTEGER NOT NULL,                -- 1 highlight / 2 note / 3 image / 4 ink / 5 underline / 6 text
    authorName TEXT,
    text TEXT,
    comment TEXT,
    color TEXT,
    pageLabel TEXT,
    sortIndex TEXT NOT NULL,
    position TEXT NOT NULL,               -- {"pageIndex":N,"rects":[[x0,y0,x1,y1],...]}
    isExternal INT NOT NULL DEFAULT 0,
    FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE,
    FOREIGN KEY (parentItemID) REFERENCES itemAttachments(itemID) ON DELETE CASCADE
);
CREATE INDEX itemAnnotations_parentItemID ON itemAnnotations(parentItemID);

CREATE TABLE deletedItems (
    itemID INTEGER PRIMARY KEY,
    dateDeleted DEFAULT CURRENT_TIMESTAMP
);
```

### 4.3 自有扩展表 DDL

```sql
-- ========== 元信息 ==========
CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
-- 关键键值：schema_version / library_path / zotero_source_path / zotero_last_import_at

-- ========== 导入记录 ==========
CREATE TABLE app_import_run (
    runID INTEGER PRIMARY KEY,
    startedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finishedAt TIMESTAMP,
    sourcePath TEXT NOT NULL,
    sourceSchemaVersion INT,
    sourceMtime INT,
    countsJson TEXT,        -- {items:95, attachments:52, missing:[...], unsupported:[...]}
    warningsJson TEXT,
    status TEXT NOT NULL    -- running / ok / failed / cancelled
);

-- ========== 附件实体文件（与 itemAttachments 一对一，但记录我们自己的拷贝位置）==========
CREATE TABLE app_attachment_file (
    attachmentKey TEXT PRIMARY KEY,
    itemKey       TEXT NOT NULL,
    relPath       TEXT NOT NULL,      -- 相对 library/files/ 的路径
    ext           TEXT,
    size          INTEGER,
    mtimeMs       INTEGER,
    sha256        TEXT,
    readable      INTEGER NOT NULL DEFAULT 1,
    reason        TEXT,               -- unsupported-caj / missing / decode-error
    addedAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========== 版面分析缓存（单位：PDF pt，与缩放无关）==========
CREATE TABLE app_page_layout (
    attachmentKey TEXT NOT NULL,
    pageIndex     INTEGER NOT NULL,
    layoutVersion INTEGER NOT NULL,
    contentHash   TEXT,               -- 该页 textContent 的哈希，变了才重算
    layoutJson    TEXT NOT NULL,      -- PageLayout
    overridesJson TEXT,               -- 用户手动合并/拆分的覆盖
    computedAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attachmentKey, pageIndex)
);

-- ========== 翻译缓存（内容哈希寻址）==========
CREATE TABLE app_translation (
    hash        TEXT PRIMARY KEY,     -- sha256(原文+语种+provider+model+glossaryHash)
    srcText     TEXT NOT NULL,
    dstText     TEXT NOT NULL,
    srcLang     TEXT, dstLang TEXT,
    providerID  TEXT, model TEXT,
    createdAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hitCount    INTEGER NOT NULL DEFAULT 0
);

-- ========== 术语表 ==========
CREATE TABLE app_glossary (
    glossaryID INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_glossary_entry (
    entryID INTEGER PRIMARY KEY,
    glossaryID INTEGER NOT NULL,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    note TEXT,
    UNIQUE (glossaryID, source),
    FOREIGN KEY (glossaryID) REFERENCES app_glossary(glossaryID) ON DELETE CASCADE
);

-- ========== 翻译引擎配置（API Key 不在这里，在系统钥匙串）==========
CREATE TABLE app_provider (
    providerID TEXT PRIMARY KEY,       -- deepseek / openai / deepl / google / ollama / ...
    kind       TEXT NOT NULL,          -- openai-compatible / deepl / google / ollama
    label      TEXT NOT NULL,
    baseUrl    TEXT,
    model      TEXT,
    enabled    INTEGER NOT NULL DEFAULT 0,
    extraJson  TEXT,
    updatedAt  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========== 阅读状态 ==========
CREATE TABLE app_reading_state (
    attachmentKey TEXT PRIMARY KEY,
    pageIndex  INTEGER NOT NULL DEFAULT 0,
    pageRatio  REAL NOT NULL DEFAULT 0,   -- 页内比例，用于精确恢复
    zoom       REAL NOT NULL DEFAULT 1.0,
    displayMode TEXT NOT NULL DEFAULT 'interlinear',
    updatedAt  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========== 后台任务 ==========
CREATE TABLE app_job (
    jobID INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,               -- fulltext / import / doc-translate
    targetKey TEXT,
    status TEXT NOT NULL,             -- queued / running / done / failed / cancelled
    total INTEGER DEFAULT 0,
    done INTEGER DEFAULT 0,
    error TEXT,
    startedAt TIMESTAMP, finishedAt TIMESTAMP
);

-- ========== 入库日志 ==========
CREATE TABLE app_ingest_log (
    logID INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,               -- doi / arxiv / pubmed / pdf-guess / manual
    input TEXT,
    resolvedJson TEXT,
    status TEXT NOT NULL,
    error TEXT,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ========== 注释反向索引（支持「点注释跳回原文块」）==========
CREATE TABLE app_annotation_anchor (
    annotationKey TEXT PRIMARY KEY,
    attachmentKey TEXT NOT NULL,
    blockId       TEXT,
    sourceHash    TEXT,
    providerID    TEXT,
    model         TEXT,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 4.4 全文索引

```sql
-- 中文必须用 trigram 分词器，否则 FTS5 对中文等于失效
CREATE VIRTUAL TABLE item_fts USING fts5(
    itemKey UNINDEXED,
    title,
    creators,
    abstract,
    fulltext,
    tokenize = 'trigram'
);
```

> **注释**：FTS5 默认的 `unicode61` 分词器按空格切词，中文整段会被当成一个 token，检索完全失效。`trigram` 按三字符滑窗索引，中文可检索，代价是索引体积约 3 倍。49 个 PDF 的文本量下完全可接受。
>
> 另一个选择是 `simple` + 自定义分词，但 FTS5 不支持纯 SQL 注册自定义分词器，需要编译扩展——本机没有完整 Xcode，直接排除。

### 4.5 列表视图

列表页不 join 四张表，走 VIEW：

```sql
CREATE VIEW v_item_list AS
SELECT
    i.itemID,
    i.key AS itemKey,
    it.typeName AS itemType,
    (SELECT v.value FROM itemData d
       JOIN fieldsCombined f ON f.fieldID = d.fieldID
       JOIN itemDataValues v ON v.valueID = d.valueID
      WHERE d.itemID = i.itemID AND f.fieldName = 'title') AS title,
    (SELECT v.value FROM itemData d
       JOIN fieldsCombined f ON f.fieldID = d.fieldID
       JOIN itemDataValues v ON v.valueID = d.valueID
      WHERE d.itemID = i.itemID AND f.fieldName = 'date') AS date,
    (SELECT v.value FROM itemData d
       JOIN fieldsCombined f ON f.fieldID = d.fieldID
       JOIN itemDataValues v ON v.valueID = d.valueID
      WHERE d.itemID = i.itemID AND f.fieldName = 'publicationTitle') AS publicationTitle,
    (SELECT v.value FROM itemData d
       JOIN fieldsCombined f ON f.fieldID = d.fieldID
       JOIN itemDataValues v ON v.valueID = d.valueID
      WHERE d.itemID = i.itemID AND f.fieldName = 'DOI') AS doi,
    (SELECT group_concat(
              CASE WHEN c.fieldMode = 1 THEN c.lastName
                   ELSE trim(coalesce(c.lastName,'') || ' ' || coalesce(c.firstName,''))
              END, '; ')
       FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID
      WHERE ic.itemID = i.itemID AND ic.creatorTypeID = 1) AS creators,
    (SELECT COUNT(*) FROM itemAttachments a
      WHERE a.parentItemID = i.itemID) AS attachmentCount,
    (SELECT COUNT(*) FROM itemAnnotations an
       JOIN itemAttachments a ON a.itemID = an.parentItemID
      WHERE a.parentItemID = i.itemID) AS annotationCount,
    i.dateAdded, i.dateModified
FROM items i
JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
WHERE i.itemTypeID NOT IN (
    SELECT itemTypeID FROM itemTypes
     WHERE typeName IN ('attachment', 'note', 'annotation')
)
AND i.itemID NOT IN (SELECT itemID FROM deletedItems);
```

> **注释**：95 条数据下这个 VIEW 查询在 0.3ms 量级，不需要预计算。等到几千条再考虑物化。

---

## 5. Zotero 库迁移

### 5.1 安全原则：物理上不可能写入源库

这是整个导入模块的第一原则。用户 3.8 MB 的库里有 33 篇期刊论文和 4 条标注，任何写入都是灾难。

**四重保护：**

1. 源库以 `{ readOnly: true }` 打开，随后立刻 `PRAGMA query_only = 1`（双保险）。
2. **优先用 SQLite Backup API** 把源库拷到临时目录，后续所有读取都在副本上。这样连「读到 Zotero 正在写的中间状态」都不可能。
3. Backup API 失败时降级为三文件拷贝：`zotero.sqlite` + `zotero.sqlite-wal` + `zotero.sqlite-shm`。**必须三个一起**，漏 `-shm` 会打不开。
4. 导入结束后 `PRAGMA integrity_check` 校验副本，通过才删临时目录。

**验收标准**：导入前后 `stat -f %m ~/Zotero/zotero.sqlite*` 完全不变。这是 P1 的硬验收项。

> **注释**：Zotero 10 起 `zotero.sqlite` 开了 WAL 模式。只拷主库文件会拿到陈旧快照——WAL 里未 checkpoint 的改动会丢。当前你的库是 Zotero 9.0.3，WAL 状态需要实测确认，但按最坏情况设计。

### 5.2 导入流程

```
preflight
├─ 定位 ~/Zotero/zotero.sqlite
├─ 读 version 表 → userdata 版本
│   ├─ < 110  → 硬阻断：「库太旧，请先用 Zotero 打开一次让它自动升级」
│   └─ >= 110 → 继续
├─ 检测 Zotero 进程是否在跑（提示但不禁阻，因为用 Backup API 是安全的）
└─ 统计：items / attachments / 预计文件大小 → 展示给用户确认

snapshot（Backup API 优先，三文件拷贝兜底）

read（全部在副本上）
├─ 字典表：itemTypes / fieldsCombined / itemTypeFields / creatorTypes
├─ items：排除 deletedItems，黑名单排除 attachment/note/annotation
├─ itemData + itemDataValues（INSERT OR IGNORE 处理全局 UNIQUE）
├─ creators + itemCreators（fieldMode=1 是机构作者，全名在 lastName）
├─ collections + collectionItems
├─ tags + itemTags
├─ itemAttachments（含 linkMode / path）
├─ itemNotes
└─ itemAnnotations

copyFiles
├─ linkMode 0/1 → storage/<附件自己的 key>/<裸文件名>
├─ linkMode 2   → 绝对路径，只记路径不拷贝
└─ linkMode 3   → 只存 URL

commit
├─ 单个事务提交
├─ 建 FTS 索引（元数据部分）
├─ 排队全文抽取任务（PDF 文本层）
└─ 写 app_import_run 报告
```

### 5.3 条目类型处理：黑名单而非白名单

```ts
// ❌ 错误做法：白名单只导已知类型
const SUPPORTED = ['journalArticle','book','bookSection','thesis','report','webpage','preprint'];
if (!SUPPORTED.includes(type)) continue;   // 未来 Zotero 新增类型会被静默丢弃

// ✅ 正确做法：黑名单排除「不是书目条目」的类型
const NON_BIBLIO = new Set(['attachment','note','annotation']);
if (NON_BIBLIO.has(type)) continue;
```

> **注释**：这个细节来自一个真实教训——白名单会在 Zotero 新增条目类型时静默丢数据，而用户不会发现。黑名单的失效模式是「多导入了几条不认识的类型」，可以接受；白名单的失效模式是「少导入了数据」，不可接受。

### 5.4 附件路径解析（真实数据里有坑）

`itemAttachments.path` 形如 `storage:filename.pdf`。实际位置是 `~/Zotero/storage/<附件自己的 8 字符 key>/<filename>`。

**注意**：子目录名是**该附件条目自己的 key**，不是父条目的 key。一个父条目有 3 个 PDF，就是 3 个不同目录。

真实数据里存在：文件名带尾部空格、带引号、URL 编码的中文、超长文件名。所以走四级候选：

```ts
function resolveStorageFile(zoteroDir: string, attKey: string, rawName: string) {
  const dir = path.join(zoteroDir, 'storage', attKey);
  const bare = rawName.replace(/^storage:/, '');
  const candidates = [
    bare,                          // 原样
    decodeURIComponent(bare),      // URL 解码
    bare.replace(/\s+$/, ''),      // 去尾部空格
    bare.replace(/^["']|["']$/g, ''), // 去引号
  ];
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  // 最后手段：同扩展名里 size 最大的（记 warning）
  return fuzzyPickByExt(dir, path.extname(bare));
}
```

**拷贝用 APFS 克隆**：`fs.copyFile(src, dst, fs.constants.COPYFILE_FICLONE)`。70 MB 秒级完成，且不占额外磁盘空间（写时复制）。

**`.caj` 处理**：复制文件但标 `readable = 0, reason = 'unsupported-caj'`。列表页显示灰色徽章，点击提示「CAJ 格式暂不支持，可用 Zotero 打开」。

### 5.5 幂等性

| 对象 | 策略 |
|---|---|
| 条目 / 字段 / 作者 / 分类 / 标签 | 全部 upsert，按 `(libraryID, key)` 定位 |
| 附件文件 | 按 `(size, mtimeMs)` 判断是否重拷，一致则跳过 |
| 翻译 / 术语表 / 阅读进度 | 挂 `itemKey`，**重新导入不丢** |

> **注释**：最后一条是刻意设计。用户可能因为换电脑、修库、或者只是想重新同步而重跑导入。如果重跑会丢翻译缓存和术语表，这个功能就没人敢用。

---

## 6. 命门一：段落级双语对照的渲染架构

### 6.1 为什么这是命门

「在 PDF 原文段落下方插入译文块」听起来简单，实际上要做一件浏览器排版引擎本来不支持的事：**在一个已经渲染好的、坐标固定的位图中间，动态插入可变高度的内容，并让下面的内容整体下移**。

PDF 是绝对定位的（每个字形有精确坐标），HTML 是流式布局的。要在两者之间架桥，必须选对架构，否则后面全是补丁。

### 6.2 被否决的方案

**方案 A：整页切成横向 band，每 band 一个小 canvas。**

```
┌─────────────────────────┐
│ canvas 1  (页 y 0–120)  │
├─────────────────────────┤
│ 译文块 1                │
├─────────────────────────┤
│ canvas 2  (页 y 120–300)│
└─────────────────────────┘
```

否决理由两条：

1. **双栏论文直接崩**：同一 y 上有左右两段文字，横条会把两栏混进一条。切分线穿过右栏段落时，右栏文字会被腰斩。
2. **合成层爆炸**：一页 20–30 个 band，可视 4 页 = 80–120 个 canvas，再乘缩放系数。Chromium 的合成层数量有限，超出后滚动掉帧严重。

**方案 B：译文浮层覆盖在原文上方。**

否决理由：会遮挡下一段原文。学术 PDF 行距通常 1.2–1.4 倍，译文块高度是原文的 1.5–2 倍，浮层必然压住内容。这是「划词翻译弹窗」的老问题，不能作为主阅读模式。

### 6.3 采用的方案：单页 canvas + DOM 流 + 偏移回填

**核心思想：让 DOM 流决定排版，让 canvas 只负责像素。**

```
PageView (position: relative; height = 页面总高)
│
├─ <canvas>              单张，尺寸 = 页宽 × 总高，绝对定位铺底
│
└─ .flow (position: absolute; top: 0; left: 0; width: 页宽)
   │                      ← 正常 DOM 流，它的高度决定 PageView 的高度
   │
   ├─ Region 0 (filler)   ← 页面顶部留白，单条 gap band
   │
   ├─ Region 1 (text)
   │  └─ display: flex; flex-direction: row; align-items: flex-start
   │     ├─ Column 0 (width = 左栏宽)
   │     │  ├─ Band (text, height = 段落 bbox 高)
   │     │  │  └─ .textlayer (absolute, top: 0, overflow: hidden)
   │     │  │     └─ span[data-block-id][data-item-index]
   │     │  ├─ TranslationBlock     ← 参与流，把下面全部下推
   │     │  ├─ Band (gap, 高度 = 段落间距)
   │     │  └─ Band (text) ...
   │     │
   │     ├─ Column 1 (width = gutter 宽)   ← filler 栏，保留分栏线
   │     │
   │     └─ Column 2 (width = 右栏宽)
   │        └─ ... 同上
   │
   ├─ Region 2 (filler)   ← 页面中部的图，整块保留
   │
   └─ Region 3 (text) ...
```

**渲染流程：**

```ts
// 1. 渲染整页到离屏 canvas（只做一次，缓存在 LRU 里）
const offscreen = await renderPageToOffscreen(page, scale);

// 2. DOM 已经完成布局（React 渲染完，浏览器算完 flex）
// 3. 在 rAF 里读每个 band 的 offsetTop，回填像素
requestAnimationFrame(() => {
  const ctx = pageCanvas.getContext('2d');
  ctx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
  for (const band of allBands) {
    const destY = band.el.offsetTop;         // ← DOM 流给的真实位置
    ctx.drawImage(
      offscreen,
      band.srcX, band.srcY, band.srcW, band.srcH,   // 源：PDF 页面上的矩形
      0, destY, band.srcW, band.srcH                // 目标：画布上的同一矩形
    );
  }
});
```

**为什么这个架构是对的：**

| 问题 | 这个架构怎么解决 |
|---|---|
| 译文高度不定 | DOM 流自动算，不用手工测量后调整 |
| 双栏 | 每栏是独立的 flex 子项，各有自己的流 |
| 图片/公式消失 | 用 **gap band** 把每个像素都覆盖到（见 6.4） |
| canvas 数量 | = 页数，不是 band 数 |
| 注释跨 band | 注释层在页面级单一坐标系，只需切矩形，不用切 DOM |
| 重绘成本 | 30 次 `drawImage` 亚毫秒级，感觉不到 |

### 6.4 无缝平铺：每个像素都必须被某个 band 覆盖

这是整个方案最关键的一条不变式：

> **页面上任意一个像素，必须且只能属于一个 band。**

违反它，就会出现「图没了」「分栏线没了」「页脚线没了」这类诡异 bug。

**保证方法：页面 = 垂直方向上无缝拼接的 Region 序列。**

```
Region 的 y 范围并集 = [0, pageHeight]，两两不重叠
```

Region 分两种：

| 类型 | 产生条件 | 内容 |
|---|---|---|
| `text` | 有文本块聚集的 y 带 | 若干 Column，每栏是 Band 序列 |
| `filler` | 无文本块覆盖的 y 带（页边距、整宽图、页眉页脚） | 单条全宽 gap band |

Region 边界来自所有文本块的 bbox 边界聚类。算出文本块后，剩余的 y 空隙自动成为 filler。

**Column 内部同样无缝：**

```
Column = [顶部 gap][text band][gap][text band]...[底部 gap]
          ↑ 高度 = regionTop - firstBlockTop   ↑ 高度 = lastBlockBottom - regionBottom
```

中间的 gap band 高度 = 上一块 bbox 底边 到 下一块 bbox 顶边。段落间距、行内图、公式都在这个 gap 里，原样保留。

**分栏线的处理**：gutter 也生成一个 filler Column，宽度 = gutter 宽，内容是一条贯穿 region 的 gap band。这样分栏线不会丢。

### 6.5 切到字形怎么办

band 边界取自**行聚类后的段落 bbox**，不是字形 bbox。所以正常情况不会切到字形。

兜底两条：

1. 切分线取 block bbox 上下沿 ± 0.25 × 行高（留一点呼吸空间，避免译文块紧贴文字）
2. 高度 < 4pt 的碎片 band 合并到相邻 band（避免出现 1px 的碎条）

### 6.6 文本层：自建，不用 pdf.js 的 TextLayer

**为什么自建**：pdf.js 的 `TextLayer` 假设「整个页面是一张连续的文本层」，它把所有 span 绝对定位在一个 `top: 0` 的容器里。但我们的布局里，band 之间有译文块，页面是分段的。如果用一个连续的文本层，span 的位置就和实际渲染位置错位了。

**做法**：每个 band 里放一个 `.textlayer`，`position: absolute; top: 0; overflow: hidden`。里面的 span **保留页面绝对坐标**（`top = 页绝对 top − bandTop`），超出 band 的部分被 `overflow: hidden` 裁掉。

**这个设计的好处**：选区几何天然正确，**不需要任何坐标换算**。

```ts
// 每个 span 的定位
span.style.left      = `${item.x0 * scale}px`;
span.style.top       = `${(pageH - item.y1) * scale - bandTopCss}px`;
span.style.fontSize  = `${item.fontSize * scale}px`;
span.style.lineHeight = '1';
span.dataset.blockId  = block.id;
span.dataset.itemIndex = String(i);
```

**宽度对齐**：pdf.js 的做法是测量后 `transform: scaleX(target / measured)`。我们照做：

```ts
// mount 后测量，一次性修正
const measured = span.getBoundingClientRect().width;
if (measured > 0) {
  span.style.transform = `scaleX(${(item.width * scale) / measured})`;
  span.style.transformOrigin = '0 0';
}
```

**选区归属**：span 带 `data-block-id`，用户选中后直接从 `selection.anchorNode.closest('[data-block-id]')` 反查，**不需要几何命中测试**。这是自建文本层的第二个好处。

### 6.7 双栏的诚实说明

interlinear 在双栏 PDF 上有一个无法消除的副作用：

```
原文（左栏）           原文（右栏）
段 1                   段 1
段 2                   段 2
────────────────      段 3
译文 1
译文 2
段 3                   
```

左栏的译文会把左栏的后续内容往下推，右栏不受影响。结果两栏逐渐错位，region 底部出现空白。

**我判断这是可接受的**，理由：真实的双栏论文里，左右两栏本来就是**独立文本流**，行与行从不对齐。所以「两栏独立流动」是符合原始语义的，不是妥协。视觉代价只是 region 底部的不等长空白。

**但产品上必须给用户选择**：

| 模式 | 快捷键 | 适用 | 说明 |
|---|---|---|---|
| `interlinear` | ⌘D 循环 | 单栏论文、学位论文、中文期刊 | 默认。段落级行间对照 |
| `overlay` | | 双栏、扫描件、版面混乱 | 译文浮层，可拖动、可折叠，不改变页面高度 |
| `sideBySide` | | 大屏、精读 | 左原文右译文，各自独立滚动 |
| `originalOnly` | | 只想读原文 | 关闭翻译 |

**自动降级**：某页 `confidence < 0.5` 或 `textContent.items.length < 5`（扫描件）→ 该页自动用 overlay，页角显示可点击的「已降级」提示，点击可手动切回。

### 6.8 可变页高带来的滚动问题

插入译文后页面高度会变，滚动时容易跳。四个手段：

1. **`content-visibility: auto` + `contain-intrinsic-size`**：屏幕外的页面不渲染，但保留占位高度。
2. **译文块 skeleton 锁高**：加载中的译文块固定 `3.4em`，避免从 0 长到实际高度。
3. **手动 scroll anchoring**：滚动事件里记录锚点 = `(pageIndex, 页内比例)`；布局变化后按锚点恢复。
4. **`overflow-anchor: none`**：关掉浏览器的原生滚动锚定，避免和手动锚定打架。

### 6.9 缩放

- 缩放只重算几何 + 重绘，**版面分析绝不重跑**（版面分析结果是 PDF pt 单位，与缩放无关）。
- 译文块字号独立于 PDF 缩放：`clamp(12px, 13px × zoomRatio, 17px)`，`zoomRatio` 限在 `[0.85, 1.3]`。否则放大到 200% 时译文会变成巨字，破坏阅读节奏。

---

## 7. 命门二：段落还原算法

### 7.1 问题本质

PDF 里**没有段落**。只有散落的字形（glyph）和它们的坐标。`pdf.js` 的 `getTextContent()` 给出的 `items` 大致是「一次绘制操作」的粒度——可能是一个字符、一个单词、或一整行，取决于 PDF 生成器。

要把它们还原成段落，必须自己写一套版面分析。

**输入**：`textContent.items[]`，每项：

```ts
interface TextItem {
  str: string;
  transform: [number, number, number, number, number, number]; // [a,b,c,d,e,f]
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
  dir: string;
}
```

**输出**：

```ts
interface PageLayout {
  pageIndex: number;
  width: number;      // PDF pt
  height: number;     // PDF pt
  regions: Region[];
  confidence: number; // 0–1，低于 0.5 自动降级 overlay
}

interface Region {
  index: number;
  kind: 'text' | 'filler';
  y0: number; y1: number;     // PDF 坐标，原点左下
  columns: Column[];
}

interface Column {
  index: number;
  x0: number; x1: number;
  kind: 'content' | 'gutter';
  blocks: Block[];
}

interface Block {
  id: string;                 // `${pageIndex}-${colIdx}-${seq}`
  kind: 'body' | 'heading' | 'caption' | 'reference' | 'formula' | 'header' | 'footer';
  text: string;               // 归一化后的文本
  logicalId?: string;         // 跨栏/跨页续接的同一逻辑段落
  bbox: [number, number, number, number];  // [x0, y0, x1, y1]
  lines: Line[];
  fontSize: number;
  confidence: number;
}
```

### 7.2 完整管线

```
items[]
  │
  ├─[1] 字形归一化        ligature / 全角半角 / 空白字符统一
  │
  ├─[2] 行聚类            按 baseline 容差归并成 Line
  │
  ├─[3] 页眉页脚剔除     顶部/底部 6% + 页码正则 + running head 检测
  │
  ├─[4] 栏位检测         垂直留白直方图 → gutter
  │
  ├─[5] 阅读顺序         跨栏行切分 → 段内先左栏后右栏
  │
  ├─[6] 段落合并         打分制
  │
  ├─[7] 块分类           heading / caption / formula / reference
  │
  ├─[8] 参考文献识别     标题锚点 + 样式锚点
  │
  ├─[9] 公式占位符化     ⟦M⟧ ⟦C⟧ ⟦U⟧ ⟦L⟧ ⟦R⟧
  │
  └─[10] Region 拼装     文本区 + filler 区，无缝覆盖 [0, height]
```

### 7.3 各步骤的算法与阈值

#### [2] 行聚类

```ts
// 按 baseline y 降序排序，容差内归并
const TOL = 0.30 * bodyFontSize;

for (const item of sortedByYDesc) {
  const line = lines.find(l => Math.abs(l.baseline - item.y) <= TOL);
  if (line) line.items.push(item);
  else lines.push({ baseline: item.y, items: [item] });
}

// 行内按 x 排序，按间隙补空格
for (const line of lines) {
  line.items.sort((a, b) => a.x0 - b.x0);
  let text = '';
  for (let i = 0; i < line.items.length; i++) {
    if (i > 0) {
      const gap = line.items[i].x0 - line.items[i - 1].x1;
      if (gap > 2.5 * fontSize) text += '\n';        // 强断行
      else if (gap > 0.25 * fontSize && !isCjkAdjacent(prev, cur)) text += ' ';
    }
    text += line.items[i].str;
  }
}
```

**阈值理由：**

| 参数 | 值 | 为什么 |
|---|---|---|
| baseline 容差 | `0.30 × fontSize` | 同一行的字形 baseline 通常完全一致；0.3 倍字号能容忍上下标和轻微抖动，又不会把相邻两行合并 |
| 空格判定 | `0.25 × fontSize` | 西文词间距约 0.25–0.33 em。低于 0.25 em 是字距调整（kerning），不是词间距 |
| CJK 不补空格 | — | 中日韩文字之间没有词间距，补空格会产生「城 市 矿 产」这种垃圾 |
| 强断行 | `2.5 × fontSize` | 大于 2.5 em 的间隙几乎必然是分栏、表格单元格、或图注分离 |

#### [3] 页眉页脚

```ts
const headerBand = { y0: pageH * 0.94, y1: pageH };
const footerBand = { y0: 0, y1: pageH * 0.06 };

// 条件一：在带内 + 字号小于正文 85%
// 条件二：纯页码（/^[\divxlcIVXLC\-\u2013\u2014\s]+$/）
// 条件三：running head —— 前 5 页同位置出现相似文本（编辑距离 < 0.3）
```

#### [4] 栏位检测（最关键的一步）

**算法：垂直留白直方图**

```ts
// 1. 把页面 x 轴切成 1pt 的 bin
// 2. 统计每个 bin 被多少条 Line 覆盖（line 的 x 范围与 bin 相交即算覆盖）
// 3. 找出连续的空 bin（覆盖率为 0）

const bins = new Float32Array(Math.ceil(contentWidth));
for (const line of lines) {
  for (let x = Math.floor(line.x0); x < Math.ceil(line.x1); x++) bins[x]++;
}

// 4. 空槽候选
const gaps = findRuns(bins, v => v === 0);

// 5. 过滤条件（三条同时满足）
const gutters = gaps.filter(g => {
  const width = g.end - g.start;
  const spanRatio = verticalSpanRatio(lines, g);   // 该 x 范围内有文本的 y 跨度占比
  const relPos = (g.start - contentX0) / contentWidth;
  return width >= Math.max(18, 1.6 * bodyFontSize)   // 够宽
      && spanRatio >= 0.40                           // 纵贯足够长
      && relPos >= 0.20 && relPos <= 0.80;           // 在内容区中部
});
```

**为什么是「垂直留白直方图」而不是「文本块 x 坐标聚类」**：直方图对噪声更鲁棒。图表、公式、脚注会在某些 y 上侵入 gutter，但直方图统计的是**整个页面的覆盖情况**，局部侵入不会造成空槽消失。反过来，聚类法会被单个异常块带偏。

**阈值理由：**

| 参数 | 值 | 为什么 |
|---|---|---|
| gutter 最小宽度 | `max(18pt, 1.6 × 正文字号)` | 双栏论文 gutter 通常 14–24pt。18pt 是下限；用 1.6 倍字号做动态下限，避免大字号排版（学位论文）被误判 |
| 纵向跨度 | ≥ 40% | gutter 必须纵贯页面才能算真分栏。如果只有 30% 高度有空隙，那是图表留白，不是分栏 |
| 相对位置 | 20%–80% | 真正的 gutter 在页面中部。靠边的空槽是页边距 |

**结果映射**：1 个 gutter → 双栏；2 个 gutter → 三栏；0 个 → 单栏。

#### [5] 阅读顺序

```ts
// 跨栏行：x 范围覆盖 gutter 超过 30%
const isSpanning = (line, gutter) =>
  (Math.min(line.x1, gutter.end) - Math.max(line.x0, gutter.start))
  / (gutter.end - gutter.start) > 0.30;

// 跨栏行把页面切成 y 段
// 段内：先左栏全部，再右栏全部
```

> **注释**：双栏论文里，标题、作者、摘要、跨栏图注都是「跨栏行」。它们把页面切成若干段，每段内部才是真正的双栏区域。不处理这一层，标题会被塞进左栏，摘要会被拆成两半。

#### [6] 段落合并（打分制）

**这是最需要工程判断的一步。** 硬规则一定会失败，因为不同期刊的排版风格差异巨大。

```ts
function breakScore(prev: Line, cur: Line, ctx: Context): number {
  let s = 0;
  const bodyFs = ctx.bodyFontSize;

  // 强信号
  if (cur.top - prev.bottom > 0.45 * bodyFs) s += 0.9;   // 段间距
  if (cur.x0 - ctx.colX0 > 0.8 * bodyFs)      s += 0.8;   // 首行缩进
  if (prev.x0 - ctx.colX0 > 0.8 * bodyFs)     s += 0.7;   // 悬挂缩进
  if (cur.width < 0.6 * ctx.colWidth)         s += 0.6;   // 短行（段末）
  if (Math.abs(cur.fontSize - prev.fontSize) > 0.15 * bodyFs) s += 0.9;
  if (cur.fontWeight !== prev.fontWeight)     s += 0.5;
  if (/^\s*(\d+\.|\d+、|[（(]\d+[)）]|[一二三四五六七八九十]+、|第[一二三四五六七八九十]+[章节])/.test(cur.text)) s += 0.6;
  if (/^(Fig\.|Figure|Table|图|表)\s*\d/i.test(cur.text)) s += 0.8;  // 图注

  // 弱信号
  if (/[.。!！?？:：;；"'"）)]$/.test(prev.text)) s += 0.35;  // 句末标点
  if (/^[a-z]/.test(cur.text)) s -= 0.2;                      // 小写开头（更像续句）

  return s;
}

const BREAK_THRESHOLD = 0.5;
const NORMALIZER = 1.6;   // 单条最强信号 0.9，两条中等信号应能触发
const shouldBreak = (score) => score / NORMALIZER >= BREAK_THRESHOLD;
```

**为什么用打分制**：单条规则都有反例。比如「短行 → 段末」在居中标题上成立，但在表格单元格里不成立；「句末标点 → 段末」在「参见 Fig. 3.」这种地方会误判。打分制让多个弱信号叠加成强判断，单条误判不会导致错误断段。

**阈值为什么是 0.5**：归一化后，两条中等信号（如「段间距 0.9」+「句末标点 0.35」= 1.25 / 1.6 = 0.78）必然触发；单条弱信号（0.35 / 1.6 = 0.22）必然不触发。0.5 是分界线。

**全部阈值放 `src/shared/constants.ts`**，可调，可写进设置页做「高级排版微调」。

#### [6b] 跨栏续接

```
上一行是满行（width > 0.9 × colWidth）
  && 无句末标点
  && 下一行无缩进
  → 同一 logicalParagraphId
```

> **注释**：跨栏续接影响两件事——翻译按「逻辑段落」整段送（否则一句被拆成两半翻译，质量崩），渲染仍按 band 拆（否则跨栏段落没法在左栏结束处插入译文）。
>
> 所以 `Block.logicalId` 和 `Block.id` 是两个概念：`logicalId` 用于翻译分组，`id` 用于渲染定位。

#### [7] 块分类

| 类型 | 判定 |
|---|---|
| `heading` | `fontSize > 1.15 × bodyFontSize`，或 `fontWeight >= 600` 且文本长度 < 120 |
| `caption` | 以 `Fig.` / `Figure` / `Table` / `图` / `表` + 数字开头，且 `fontSize < 0.95 × bodyFontSize` |
| `formula` | 数学字形占比 > 30%（`∑∫√±×÷≤≥≠≈∞∂∇` + 希腊字母） |
| `reference` | 见 [8] |
| `header` / `footer` | 见 [3] |
| `body` | 其余 |

#### [8] 参考文献识别

两个锚点，命中任一即判定，且**从此块起整页后续块都是 reference**：

```
锚点 A（标题锚点）：
  单独成块，文本匹配 /^(References|Bibliography|REFERENCES|参考文献|參考文獻|引用文献)$/i
  或 /^(References|Bibliography)\s*(and|&)\s*Notes/i

锚点 B（样式锚点）：
  连续 3 个块同时满足：
    - 含 4 位年份（19xx / 20xx）
    - 或含 "et al." / "doi" / "https://doi.org"
    - 或含悬挂缩进（首行 x0 比后续行小）
```

> **注释**：参考文献不该翻译，这是学术阅读的共识。BabelDOC 至今没做好——官方 README 承认会把参考文献区解析错、合并成一段。原因就是它没有做区块级黑名单。笺在版面分析阶段就标记 `kind='reference'`，翻译阶段直接跳过，比事后补救可靠。

#### [9] 公式与引用占位符化

**在生成块文本时就替换**，不是翻译后再补：

| 占位符 | 目标 | 例 |
|---|---|---|
| `⟦M⟧` | 数学字形 | `∑`、`∫₀^∞`、`x_{i}^{2}` |
| `⟦C⟧` | 引用标记 | `[12]`、`(Smith, 2019)`、`（张三，2020）` |
| `⟦U⟧` | URL / DOI | `https://doi.org/10.1016/...` |
| `⟦L⟧` | LaTeX 片段 | `$\alpha$`、`\cite{...}` |
| `⟦R⟧` | 图表引用 | `Fig. 3`、`Table 2`、`图 3` |

**回填时校验槽数一致**：

```ts
const srcSlots = countPlaceholders(srcText);
const dstSlots = countPlaceholders(dstText);
if (srcSlots !== dstSlots) {
  // 模型把占位符吃掉了或复制了 → 该段标记失败，降级为「原文 + 提示」
  markFailed(blockId);
}
```

> **注释**：这个校验是必须的。LLM 经常会「翻译」占位符（把 `⟦M⟧` 变成 `[M]` 或直接删掉），一旦不校验，公式就会在译文里消失，用户还以为原文没有公式。

### 7.4 风险隔离：最重要的设计

**tile 平铺只依赖行聚类**（几乎不会错），**段落合并只影响「译文块怎么切」**。

这意味着：段落算法完全失效时，降级为「逐行对照」，产品仍然可用。这是整个架构最重要的风险隔离——不会因为算法调不准而产品不可用。

**手动纠错**：工具栏提供 `Shift + 点击` 手动合并/拆分段落，覆盖写进 `app_page_layout.overridesJson`，优先级高于自动结果。

### 7.5 回归测试

`test/fixtures/` 放 6 篇真实论文的 `textContent` JSON + 人工标注的期望段落数组：

| fixture | 覆盖场景 |
|---|---|
| `two-column-en.json` | 双栏英文期刊，跨栏标题 + 摘要 |
| `single-col-thesis.json` | 单栏中文学位论文，大字号、宽行距 |
| `cnki-cn.json` | 中文 CNKI 排版，双栏 + 参考文献 |
| `formula-heavy.json` | 公式密集，行内公式与独立公式混排 |
| `scanned.json` | 扫描件（无文本层，`items.length < 5`） |
| `long-refs.json` | 超长参考文献（3 页以上） |

**断言**：段落数差 ≤ 10%，且每段与期望段的编辑相似度 ≥ 0.85。

---

## 8. 翻译管线

### 8.1 Provider 抽象

```ts
interface TranslateRequest {
  segments: Array<{ id: string; text: string; kind: Block['kind'] }>;
  contextBefore?: string;   // 前一个逻辑段落，截断 300 字符
  contextAfter?: string;
  srcLang: string;          // 'auto' | 'en' | ...
  dstLang: string;          // 'zh-CN'
  glossary?: Array<{ source: string; target: string }>;
}

interface TranslateResult {
  segments: Array<{ id: string; text: string; ok: boolean; error?: string }>;
}

interface Provider {
  id: string;
  kind: 'openai-compatible' | 'deepl' | 'google' | 'ollama';
  capabilities: {
    glossary: 'native' | 'prompt' | 'none';
    batch: boolean;
    maxChars: number;
    maxSegments: number;
    concurrency: number;
  };
  translate(req: TranslateRequest, cfg: ProviderConfig, signal: AbortSignal): Promise<TranslateResult>;
  testConnection(cfg: ProviderConfig): Promise<{ ok: boolean; message: string }>;
}
```

### 8.2 首批支持的引擎

| provider | kind | 术语表 | 说明 |
|---|---|---|---|
| `deepseek` | openai-compatible | prompt | **首选**。中文强、便宜、国内可直连 |
| `openai` | openai-compatible | prompt | GPT 系列 |
| `moonshot` / `zhipu` / `qwen` | openai-compatible | prompt | 同一个实现，改 baseUrl 即可 |
| `deepl` | deepl | **native** | 术语一致性最好，长句偏生硬 |
| `google` | google | 前后替换 | 便宜快速，兜底 |
| `ollama` | ollama | prompt | 离线/隐私，并发 1 |

> **注释**：`openai-compatible` 一个实现覆盖 5 家，这是刻意的。国内可用的 LLM 几乎都提供 OpenAI 兼容端点，抽象成本极低。

### 8.3 学术翻译的四个工程手段

不靠 prompt 玄学，靠工程。

#### ① 术语表：只注入命中的词

```ts
// ❌ 错误：把整本术语表塞进 prompt
// → token 爆炸，模型注意力分散，反而更差

// ✅ 正确：只注入本批实际出现的术语，最多 40 条，长术语优先
const hits = glossary
  .filter(e => batchText.includes(e.source))
  .sort((a, b) => b.source.length - a.source.length)   // 长术语优先，避免被短术语覆盖
  .slice(0, 40);
```

**为什么长术语优先**：术语表里同时有 `state` 和 `state capacity` 时，如果先匹配 `state`，`state capacity` 就永远匹配不到。

#### ② 上下文：给前后各一段，但明确标注「不要翻译」

```ts
const prompt = `
你在翻译学术文献。请把下面的段落翻译成${dstLang}。

${contextBefore ? `【上文，仅作语境参考，不要翻译】\n${contextBefore}\n` : ''}
${contextAfter  ? `【下文，仅作语境参考，不要翻译】\n${contextAfter}\n`  : ''}

【需要翻译的内容】
${segments.map((s, i) => `[${i + 1}] ${s.text}`).join('\n\n')}

要求：
1. 保持学术语体，不要口语化
2. 保留 ⟦M⟧ ⟦C⟧ ⟦U⟧ ⟦L⟧ ⟦R⟧ 这些占位符，原样输出，不要翻译、不要增删
3. 输出严格 JSON：{"segments":[{"i":1,"text":"..."}]}
`;
```

#### ③ 参考文献跳过

`kind === 'reference'` 的块默认不送翻译。这是产品级默认，可在设置里改。

#### ④ JSON 降级链

LLM 输出 JSON 不稳定是常态。三级降级：

```ts
async function parseSegments(raw: string, expected: number) {
  // 一级：直接 parse
  try { return JSON.parse(raw).segments; } catch {}

  // 二级：抠出 {...} 再 parse（模型爱加 markdown 代码块）
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]).segments; } catch {}

  // 三级：正则抠 "i":N,"text":"..." 对
  const pairs = [...raw.matchAll(/"i"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  if (pairs.length === expected) return pairs.map(...);

  // 四级：逐段单发纯文本（最慢但最稳）
  return null;   // 调用方降级
}
```

### 8.4 缓存

```ts
const hash = sha256([
  normalize(srcText),
  dstLang,
  providerID,
  model,
  glossaryHash,   // sha256(entries)，术语表变了缓存失效
].join('\u0000'));
```

- **内存 LRU**：500 条，命中 0ms
- **SQLite**：持久化，重启后仍然命中
- **in-flight Map**：同一段落并发请求去重（用户来回滚动时不会重复发请求）

### 8.5 并发与优先级

```ts
const concurrency = {
  'openai-compatible': 3,
  deepl: 4,
  google: 5,
  ollama: 1,
};

// 优先级队列：数字小的先发
const priority = {
  viewport: 0,      // 当前视口内的块
  prefetch: 1,      // 下一页
  document: 2,      // 整篇翻译任务
};
```

**退避**：429 / 5xx 指数退避 3 次（1s / 2s / 4s），仍失败则标记该块为 `failed`，UI 显示「重试」按钮。

**取消**：每个文档一个 `AbortController`。切文档、关 tab、切引擎时 `abort()` 所有在途请求。

### 8.6 译文块的视觉

```css
.translation-block {
  font-family: "PingFang SC", -apple-system, sans-serif;
  font-size: clamp(12px, 13px * var(--zoom-ratio), 17px);
  line-height: 1.75;
  color: var(--text-secondary);
  padding: 6px 8px 8px;
  margin: 4px 0 8px;
  border-left: 2px solid var(--accent-muted);
  background: var(--translation-bg);
  border-radius: 0 4px 4px 0;
}

/* 加载中：锁高，避免布局跳动 */
.translation-block[data-state="loading"] {
  min-height: 3.4em;
  background: linear-gradient(90deg, var(--skeleton-a), var(--skeleton-b), var(--skeleton-a));
  animation: shimmer 1.4s infinite;
}

/* 折叠态：只显示一行 + 展开按钮 */
.translation-block[data-collapsed="true"] {
  max-height: 1.75em;
  overflow: hidden;
}
```

> **注释**：左侧 2px 的 accent 竖线是刻意的。它让译文块在视觉上「挂在」上方原文段落下面，形成归属关系，而不像一个独立的卡片。这是 interlinear 的关键视觉语言。

---

## 9. 划词翻译与结果沉淀

### 9.1 数据流

```
用户选中文本（debounce 180ms）
  │
  ├─ selection.anchorNode.closest('[data-block-id]')
  │   → blockId（不需要几何命中测试）
  │
  ├─ 取整段文本（block.text）+ 选中片段（selection.toString()）
  │
  ├─ 构造 PDF 坐标 rects
  │   range.getClientRects() → 每个 rect 减去 band 偏移 → 除以 scale → 翻转 y
  │
  ├─ 查缓存（hash 命中 → 0ms 返回）
  │
  ├─ 未命中 → 单段请求（带整段语境，低延迟）
  │
  └─ 浮层展示
       ├─ 译文
       ├─ [整段] [术语] 分段控件
       └─ 操作：存为注释 · 加入术语表 · 复制 · 重译
```

### 9.2 坐标反算

```ts
function selectionToPdfRects(range: Range, bandEl: HTMLElement, pageH: number, scale: number) {
  const bandTop = bandEl.offsetTop;             // 页面坐标系下的 band 顶
  return [...range.getClientRects()].map(r => {
    const pageRelTop = r.top - bandEl.getBoundingClientRect().top + bandTop;
    const x0 = r.left / scale;
    const x1 = r.right / scale;
    const y1 = pageH - (pageRelTop / scale);           // 翻转到 PDF 坐标（原点左下）
    const y0 = pageH - ((pageRelTop + r.height) / scale);
    return [x0, y0, x1, y1];
  });
}
```

### 9.3 落库：复用 `itemAnnotations`

语义与 Zotero 完全对齐，这样将来导出不会错。

| 字段 | 值 | 理由 |
|---|---|---|
| `type` | `1`（highlight） | 在 Zotero 里就是「高亮 + 可写评论」，导回去语义对得上 |
| `text` | 原文选中片段 | |
| `comment` | `译文：…\n\n—— deepseek / deepseek-chat` | 带引擎署名，便于追溯 |
| `color` | 翻译注释 `#2ea8e5`（蓝）；普通高亮 `#ffd400`（黄） | 其余 6 色用 Zotero 原生板 |
| `position` | `{"pageIndex":N,"rects":[[x0,y0,x1,y1],...]}` | 与 Zotero 完全一致 |
| `sortIndex` | `页序号5位｜距页顶×1000 九位｜00000` | Zotero 的排序约定 |

**反向索引**：`app_annotation_anchor(annotationKey, attachmentKey, blockId, sourceHash, providerID, model)` 支持「点注释跳回原文块」。

### 9.4 浮层 UI

```
┌─────────────────────────────────────┐
│  city mineral resources              │  ← 选中原文（11px, secondary）
├─────────────────────────────────────┤
│  城市矿产资源                         │  ← 译文（13px, primary）
│                                      │
├─────────────────────────────────────┤
│  [整段] [术语]        [存为注释] [⋯]  │  ← 分段控件 + 操作
└─────────────────────────────────────┘
```

**定位**：`@floating-ui/dom`，`placement: 'bottom-start'`，`flip()` + `shift()` 保证不出屏。

**为什么「整段」是默认而不是「选中」**：学术句子的语义依赖上下文。选三个词翻译，脱离句子的译文经常是错的。所以浮层默认展示**整段译文**，用 `[选中] [整段]` 切换。这跟 `zotero-pdf-translate` 的默认行为相反，但学术场景下更对。

---

## 10. 入库能力

### 10.1 三个入口

| 入口 | 流程 |
|---|---|
| 粘 DOI / arXiv ID / PMID | 正则识别 → API 查询 → 映射成 Zotero item 结构 → **预览确认** → 入库 |
| 拖 PDF 进窗口 | 抽首页文本 → 正则找 DOI → 命中则抓取；否则用字号最大的行猜标题、`Last, First` 模式猜作者 → **预览确认** → 入库 |
| 手动新建 | 选类型 → 按 `itemTypeFields` 渲染表单 → 入库 |

> **注释**：「预览确认」是强制的，不是可选项。DOI 抓取的元数据质量参差不齐（CrossRef 里大量条目缺卷期页），直接把垃圾数据写进库比手动输入更糟。所有抓取结果都进一个可编辑的表单，用户确认后才落库。

### 10.2 网络层

```ts
const USER_AGENT = 'Jian/0.1 (mailto:your@email)';   // CrossRef 要求带 mailto 进 polite pool

async function fetchJson(url: string, schema: ZodSchema, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return schema.parse(await res.json());
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * 2 ** i);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}
```

**明确不做**：CNKI / 知网抓取。无公开 API，需要登录态，且涉及反爬。

### 10.3 全文索引

导入完成后台任务：

```
对每个有 PDF 的附件：
  pdfjs-dist legacy build（可在主进程 Node 里跑）
  → getTextContent() 逐页
  → 拼接文本
  → 写 item_fts（trigram）

49 个 PDF 预计 1–2 分钟
进度写 app_job，可取消
增量：文件 mtime 变了才重抽
```

### 10.4 导出与引用格式化

**导出格式**：

| 格式 | 保真度 | 用途 |
|---|---|---|
| CSL-JSON | 书目元数据最全 | 通用交换 |
| BibTeX | 中 | LaTeX 工作流 |
| RIS | 中低（字段贫乏） | 兼容性最广 |

三者都不含分类、笔记、附件、标注——这是格式的固有限制，不是实现问题。

**引用格式化**：citeproc-js + 三个内置 CSL 文件：

- `china-national-standard-gb-t-7714-2015-numeric.csl`
- `apa.csl`
- `chicago-author-date.csl`

`⌘⇧C` 复制格式化引用；`⌘⇧B` 复制整篇参考文献表。

---

## 11. UI 设计规范

### 11.1 窗口

```ts
new BrowserWindow({
  titleBarStyle: 'hiddenInset',
  trafficLightPosition: { x: 18, y: 18 },
  vibrancy: 'sidebar',
  visualEffectState: 'followWindow',
  roundedCorners: true,
  backgroundColor: '#00000000',
  minWidth: 900, minHeight: 600,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, '../preload/index.mjs'),
  },
});
```

### 11.2 布局

```
┌──────────┬──────────────────────────────────────────────┐
│          │  ⌘ 搜索                     [+ 新建] [导入]  │  ← 工具栏 44px
│ 侧边栏    ├──────────────────────────────────────────────┤
│ 220-280  │  文献列表（虚拟化）              │ 详情面板    │
│          │  行高 40                        │ 320px      │
│ ▸ 我的文库│  ┌────────────────────────────┐ │ 标题        │
│ ▸ 最近添加│  │ 城市矿产开发利用：前景、...  │ │ 作者        │
│          │  │ 马继亮 · 2021        [PDF]  │ │ 年份 期刊   │
│ 分类      │  ├────────────────────────────┤ │ DOI        │
│ · SDG13  │  │ 「城市矿产」资源产生及其...  │ │ ─────────  │
│ · 马继亮  │  │ 张三 · 2020          [PDF] │ │ 摘要        │
│ · 中日外交│  └────────────────────────────┘ │ 标签        │
│ · 国家安全│                                │ 附件        │
│ · 俄罗斯  │                                │ 笔记        │
│ · IPE    │                                │ 标注        │
│          │                                │            │
│ 标签      │                                │            │
└──────────┴──────────────────────────────────────────────┘
```

**阅读器在主窗口 Tab 里，不做独立窗口。** 理由：一个 React 树、一套 store，不用跨窗口状态同步；Tab 天然支持「边读边翻库」；将来要做独立窗口只需换 props。

### 11.3 设计 token 全表

```css
/* src/renderer/src/styles/tokens.css */

:root {
  /* ========== 字号（macOS 默认 13pt，最小 10pt，HIG 明文）========== */
  --text-display: 22px;    --lh-display: 28px;   --fw-display: 600;
  --text-title1: 17px;     --lh-title1: 22px;    --fw-title1: 600;
  --text-title2: 15px;     --lh-title2: 20px;    --fw-title2: 600;
  --text-title3: 13px;     --lh-title3: 18px;    --fw-title3: 600;
  --text-body: 13px;       --lh-body: 18px;      --fw-body: 400;   /* 全局默认 */
  --text-callout: 12px;    --lh-callout: 16px;   --fw-callout: 400;
  --text-subhead: 11px;    --lh-subhead: 15px;   --fw-subhead: 400;
  --text-caption: 10px;    --lh-caption: 13px;   --fw-caption: 500; /* 下限，勿再小 */

  /* ========== 字族 ========== */
  --font-ui: -apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
  --font-reading: "PingFang SC", -apple-system, "Songti SC", serif;
  --font-mono: "SF Mono", ui-monospace, Menlo, monospace;

  /* ========== 间距（4pt 基数）========== */
  --sp-1: 2px;  --sp-2: 4px;  --sp-3: 8px;   --sp-4: 12px;
  --sp-5: 16px; --sp-6: 20px; --sp-7: 24px;  --sp-8: 32px; --sp-9: 40px;
  --gap-icon-text: 6px;
  --row-padding-x: 12px;      /* 紧凑 */
  --row-padding-x-comfy: 16px;
  --card-padding: 16px;
  --section-gap: 24px;

  /* ========== 行高 ========== */
  --row-sidebar: 28px;        /* comfortable */
  --row-sidebar-compact: 24px;
  --row-list-single: 24px;
  --row-list-double: 40px;

  /* ========== 圆角 ========== */
  --radius-xs: 3px;    /* 标签、角标 */
  --radius-sm: 5px;    /* 小按钮、输入框内元素 */
  --radius-md: 6px;    /* 标准按钮、下拉、分段控件 */
  --radius-lg: 8px;    /* 卡片、面板、列表选中态 */
  --radius-xl: 10px;   /* popover */
  --radius-window: 12px;
  --radius-full: 999px;

  /* ========== 颜色（浅色）========== */
  --bg-window: #ECECEC;
  --bg-content: #FFFFFF;
  --bg-sidebar: rgba(246, 246, 246, 0.72);
  --bg-card: #FFFFFF;
  --bg-elevated: #FFFFFF;

  --text-primary: rgba(0, 0, 0, 0.85);
  --text-secondary: rgba(0, 0, 0, 0.55);
  --text-tertiary: rgba(0, 0, 0, 0.35);
  --text-quaternary: rgba(0, 0, 0, 0.20);

  --separator: rgba(0, 0, 0, 0.08);
  --separator-strong: rgba(0, 0, 0, 0.14);

  --accent: AccentColor;                    /* 跟随系统强调色，不写死 */
  --accent-soft: color-mix(in srgb, AccentColor 12%, transparent);
  --accent-soft-strong: color-mix(in srgb, AccentColor 20%, transparent);

  --translation-bg: color-mix(in srgb, AccentColor 4%, transparent);
  --accent-muted: color-mix(in srgb, AccentColor 45%, transparent);

  --skeleton-a: rgba(0, 0, 0, 0.04);
  --skeleton-b: rgba(0, 0, 0, 0.08);

  /* ========== 阴影 ========== */
  --shadow-card: 0 1px 2px rgba(0,0,0,.06), 0 0 0 .5px rgba(0,0,0,.05);
  --shadow-popover: 0 8px 24px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.06);

  /* ========== 动效 ========== */
  --dur-hover: 120ms;
  --dur-panel: 220ms;
  --ease-out: cubic-bezier(0.32, 0.72, 0, 1);
}

/* ========== 深色 ========== */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-window: #1E1E1E;
    --bg-content: #1E1E1E;
    --bg-sidebar: rgba(40, 40, 40, 0.72);
    --bg-card: #2C2C2C;
    --bg-elevated: #2C2C2C;

    --text-primary: rgba(255, 255, 255, 0.88);
    --text-secondary: rgba(255, 255, 255, 0.58);
    --text-tertiary: rgba(255, 255, 255, 0.38);
    --text-quaternary: rgba(255, 255, 255, 0.22);

    --separator: rgba(255, 255, 255, 0.08);
    --separator-strong: rgba(255, 255, 255, 0.14);

    --skeleton-a: rgba(255, 255, 255, 0.04);
    --skeleton-b: rgba(255, 255, 255, 0.09);

    --shadow-card: 0 1px 2px rgba(0,0,0,.30), 0 0 0 .5px rgba(255,255,255,.06);
    --shadow-popover: 0 8px 24px rgba(0,0,0,.45), 0 0 0 .5px rgba(255,255,255,.08);
  }
}

/* ========== 尊重减弱动效 ========== */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### 11.4 HIG 硬约束清单

| 约束 | 出处 | 我们的做法 |
|---|---|---|
| macOS 默认字号 13pt，最小 10pt | HIG Typography | `--text-body: 13px`，`--text-caption: 10px` |
| 侧边栏选中态用圆角矩形，不是整行色块 | macOS 11 起规范 | `border-radius: var(--radius-lg)` + `--accent-soft` |
| 侧边栏图标默认用系统强调色 | HIG Sidebars | `--accent: AccentColor` |
| 每个工具栏项都必须在菜单栏有对应命令 | HIG Toolbars | 工具栏按钮全部映射到 Menu 项 |
| 关键控件不放窗口底部 | HIG Layout | 所有操作在顶部工具栏或右键菜单 |
| 不提供 app 专属深浅色开关 | HIG Dark Mode | 只跟系统，设置页无外观选项 |
| 分隔线 1 物理像素 | 系统行为 | `1px` + 语义色 |
| 高频交互不加动效 | HIG Motion | 滚动/选中/输入零 transition |
| 尊重 Reduce Motion | HIG Motion | `@media (prefers-reduced-motion: reduce)` 全关 |

### 11.5 界面清单

| 界面 | 要点 |
|---|---|
| 空状态 | 检测到 `~/Zotero` 则文案变「发现 95 条文献，一键迁移」 |
| 导入向导 | 三步：Preflight（统计 + 风险提示）→ Progress（进度条 + 可取消）→ Report（成功/缺失/不支持清单） |
| 文献列表 | 行高 40，标题 13/500 + 作者·年份 11/secondary，右侧 PDF/标注/⚠ 徽章 |
| 详情面板 | 320px，字段可编辑，点击即改，失焦保存 |
| 新建/抓取弹窗 | 粘 DOI 自动查询，结果进可编辑表单 |
| 阅读器 | 44px 工具栏：返回 / 标题 / 页码 / 缩放 / 双语模式 Segmented / 引擎 / 更多 |
| 标注侧栏 | 按页分组，点条目跳回原文 |
| 翻译设置 | 引擎选择、API Key、模型、术语表开关、参考文献跳过开关 |
| 术语表 | CSV 导入导出，与 BabelDOC 格式兼容（`source,target`） |

---

## 12. IPC 契约

### 12.1 原则

- `src/shared/ipc-contract.ts` 是唯一契约，类型即文档
- preload 只暴露**具名方法**，**不暴露 `ipcRenderer`**——渲染进程无法自造 channel
- 所有跨进程数据用 zod 校验
- **PDF 二进制不走 IPC**（见 12.3）

### 12.2 接口清单

```ts
export interface IpcContract {
  // ========== 库 ==========
  'library:list': {
    req: { collectionKey?: string; tag?: string; query?: string; sort?: 'dateAdded'|'title'|'date'; limit?: number; offset?: number };
    res: { items: ItemSummary[]; total: number };
  };
  'library:item': { req: { itemKey: string }; res: ItemDetail };
  'library:create': { req: { type: string; fields: Record<string,string>; creators: Creator[] }; res: { itemKey: string } };
  'library:update': { req: { itemKey: string; fields?: Record<string,string>; creators?: Creator[]; tags?: string[] }; res: void };
  'library:delete': { req: { itemKeys: string[] }; res: void };
  'library:collections': { req: {}; res: CollectionNode[] };
  'library:tags': { req: {}; res: Array<{ name: string; count: number }> };
  'library:stats': { req: {}; res: { items: number; attachments: number; annotations: number; collections: number } };

  // ========== 导入 ==========
  'import:detect': { req: {}; res: { found: boolean; path?: string; schemaVersion?: number; counts?: Counts } };
  'import:start': { req: { path?: string }; res: { runId: number } };
  'import:cancel': { req: { runId: number }; res: void };
  // 事件：'import:progress' → { runId, phase, done, total, message }

  // ========== 入库 ==========
  'ingest:lookup': { req: { input: string }; res: IngestPreview };
  'ingest:fromPdf': { req: { filePath: string }; res: IngestPreview };
  'ingest:confirm': { req: { preview: IngestPreview; overrides?: Partial<ItemDetail> }; res: { itemKey: string } };

  // ========== PDF ==========
  'pdf:open': { req: { attachmentKey: string }; res: { url: string; pageCount: number; title: string } };
  'pdf:layout': { req: { attachmentKey: string; pageIndex: number }; res: PageLayout };
  'pdf:saveOverrides': { req: { attachmentKey: string; pageIndex: number; overrides: unknown }; res: void };
  'pdf:readingState': { req: { attachmentKey: string }; res: ReadingState | null };
  'pdf:saveReadingState': { req: { attachmentKey: string; state: ReadingState }; res: void };

  // ========== 翻译 ==========
  'translate:blocks': { req: { segments: Segment[]; srcLang?: string; dstLang: string; priority: 0|1|2 }; res: SegmentResult[] };
  'translate:selection': { req: { text: string; blockText: string; srcLang?: string; dstLang: string }; res: { text: string; provider: string; model: string; cached: boolean } };
  'translate:startDocJob': { req: { attachmentKey: string; pageRange?: [number, number] }; res: { jobId: number } };
  'translate:cancel': { req: { attachmentKey: string }; res: void };
  'translate:providers': { req: {}; res: ProviderInfo[] };
  'translate:upsertProvider': { req: { provider: ProviderConfig }; res: void };
  'translate:testProvider': { req: { providerID: string }; res: { ok: boolean; message: string } };
  // 事件：'translate:progress' → { attachmentKey, done, total }

  // ========== 注释 ==========
  'annotation:list': { req: { attachmentKey?: string; itemKey?: string }; res: Annotation[] };
  'annotation:create': { req: { attachmentKey: string; type: number; text: string; comment?: string; color: string; position: AnnotationPosition; anchor?: AnchorMeta }; res: { annotationKey: string } };
  'annotation:update': { req: { annotationKey: string; comment?: string; color?: string }; res: void };
  'annotation:delete': { req: { annotationKey: string }; res: void };

  // ========== 笔记 ==========
  'note:create': { req: { parentItemKey?: string; text: string; anchor?: AnchorMeta }; res: { noteKey: string } };
  'note:list': { req: { itemKey: string }; res: Note[] };

  // ========== 术语表 ==========
  'glossary:list': { req: {}; res: Glossary[] };
  'glossary:create': { req: { name: string }; res: { glossaryId: number } };
  'glossary:addEntry': { req: { glossaryId: number; source: string; target: string; note?: string }; res: void };
  'glossary:importCsv': { req: { glossaryId: number; csv: string }; res: { imported: number; skipped: number } };

  // ========== 导出 / 引用 ==========
  'export:items': { req: { itemKeys: string[]; format: 'csljson'|'bibtex'|'ris' }; res: { content: string; filename: string } };
  'cite:format': { req: { itemKeys: string[]; styleId: string; asBibliography: boolean }; res: { text: string } };
  'cite:styles': { req: {}; res: Array<{ id: string; label: string }> };

  // ========== 设置 / 窗口 ==========
  'settings:get': { req: {}; res: AppSettings };
  'settings:set': { req: { patch: Partial<AppSettings> }; res: void };
  'window:openReader': { req: { attachmentKey: string }; res: void };
  'window:toggleSidebar': { req: {}; res: void };
}
```

### 12.3 PDF 二进制为什么不走 IPC

**方案**：注册自定义协议 `jian://`，pdf.js 直接按 URL 拉取。

```ts
protocol.handle('jian', async (request) => {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname.slice(1));

  // 防目录穿越：解析后的真实路径必须落在 library 目录内
  const abs = path.resolve(LIBRARY_DIR, rel);
  if (!abs.startsWith(LIBRARY_DIR + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }

  // 支持 Range（pdf.js 分块加载需要）
  const range = request.headers.get('Range');
  const stat = await fs.promises.stat(abs);
  if (range) {
    const [startStr, endStr] = range.replace('bytes=', '').split('-');
    const start = Number(startStr);
    const end = endStr ? Number(endStr) : stat.size - 1;
    const stream = fs.createReadStream(abs, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': 'application/pdf',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(abs)) as ReadableStream, {
    headers: { 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Content-Length': String(stat.size) },
  });
});
```

**理由**：20 MB 的 PDF 走 IPC 要序列化一次、拷贝一次、反序列化一次，主进程和渲染进程各占一份内存。自定义协议 + Range 是流式的，pdf.js 只加载需要的分块。

---

## 13. 分期与验收

| 期 | 内容 | 验收（能做什么算通过） |
|---|---|---|
| **P0 探针** | 骨架 + 三个致命不确定性 | ① 窗口起来、`hiddenInset` 生效；② 主进程 `node:sqlite` 读出 `SELECT count(*) FROM items`；③ 打开真实 PDF 第 1 页渲染成功；④ 页面切成 3 段、中间插假译文、原文可选中 |
| **P1 库与浏览** | 快照/只读读取/文件拷贝/VIEW/虚拟列表/详情/分类树/标签/元数据搜索 | ① 报告 `95 条 / 49 附件 / 3 CAJ 不支持`；② 列表显示 33 篇期刊论文、作者年份正确；③ 点「中日外交」能过滤；④ **导入前后 `stat -f %m ~/Zotero/zotero.sqlite` 不变**；⑤ 重跑不产生重复 |
| **P2 阅读器** | 版面分析全管线 + band 渲染 + 自建文本层 + 注释层 + 虚拟化 + 缩放 + 模式切换 | ① 48 页连续滚动无白屏、内存 < 700MB；② 双栏左右分别渲染、译文插在正确栏；③ 缩放 80–200% 选区框不偏移；④ 原有 4 条标注显示在正确位置；⑤ 页眉页码不出译文块 |
| **P3 段落 + 翻译** | 段合并/参考文献/占位符/DeepSeek/缓存/译文块/整篇任务 | ① 抽 20 段人工核对，切分正确率 ≥90%；② 参考文献区 0 段被翻译；③ 公式与引用标记原样保留；④ 二次打开 0 请求（命中缓存）；⑤ 首屏一页 < 5s |
| **P4 划词 + 沉淀** | 浮层/存注释/加术语表/存笔记/普通高亮/标注侧栏 | ① 选中一句 1.5s 内出译文；② 存为注释后列表出现、PDF 出现蓝色高亮、重启仍在；③ 加术语表后重译该页生效；④ 存为笔记后点「回到原文」能跳转 |
| **P5 入库能力** | DOI/arXiv 抓取 + 拖 PDF + 手动新建/编辑 + 全文索引 + 导出 + 引用格式化 | ① 粘一个 DOI 回车 → 3s 内出完整条目；② 拖一篇 PDF 进窗口 → 自动建条目并挂上附件；③ 搜「城市矿产」能命中正文里的词；④ 导出 BibTeX 能被 Zotero 正确导入；⑤ `⌘⇧C` 复制出 GB/T 7714 格式引用 |
| **P6 收尾** | 多 provider / 术语表 UI / 设置页 / 菜单 / 暗色核对 / DESIGN.md 定稿 | 4 个 provider「测试连接」全绿；浅深色两套视觉走查无硬编码色残留 |

**P0 是 Go/No-Go 关卡**：若 `node:sqlite` 在 Electron 45 不可用，立刻切 `node-sqlite3-wasm`（`SqliteLike` 接口已抽象，切换成本半天）。

**本轮明确不做**：加载现有 Zotero 插件 · Connector 协议 · 双向同步 · OCR · CAJ 解析 · Word/LibreOffice 插件 · 网页快照 · 代码签名公证（dev 用 ad-hoc）。

---

## 14. 风险清单

按「会不会导致返工」排序。

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| 1 | **段落还原准确率不达标**（双栏/跨栏/参考文献） | 译文块切错位置，核心体验崩 | band 粒度与段落解耦，最差降级「逐行对照」；每页 confidence 低自动切 overlay；手动合并/拆分；6 篇真实论文做回归 |
| 2 | **SQLite 驱动**（`node:sqlite` 在 Electron 45 不可用） | 数据层全部返工 | `SqliteLike` 三后端统一 API；P0 首日验证；**绝不引入 node-gyp 包** |
| 3 | **pdf.js worker 在 Vite 下打包失败**（ESM-only） | 阅读器起不来 | `?url` + `GlobalWorkerOptions.workerSrc`；dev `optimizeDeps.exclude`；最差 `disableWorker: true` |
| 4 | **单页 canvas 重绘掉帧** | 滚动卡顿 | 只在 rAF 内重绘；按脏 band 局部 `putImageData` 兜底；页位图 LRU 4–6 页；scale 上限 2.0；退路是回到 per-band canvas |
| 5 | **读到 Zotero 半写状态** | 数据不一致，用户库可能受影响 | Backup API 一致性快照优先；三文件拷贝兜底；只读双保险；导入后 `integrity_check` |
| 6 | **DOI 抓取元数据质量参差 / 被限流** | 建出脏条目 | 一律进「预览确认」可编辑再入库；CrossRef 带 `mailto` 进 polite pool；超时重试 2 次后降级手动填 |
| 7 | 扫描件 / CAJ | 打不开或无法翻译 | `textContent.items.length < 5` 即明确提示；CAJ 标 `unsupported-caj` 并给「在 Zotero 中打开」 |
| 8 | 可变页高滚动抖动 | 阅读体验差 | skeleton 锁高 + 手动 scroll anchoring + `overflow-anchor: none` |
| 9 | 异常文件名（尾部空格/引号/URL 编码） | 附件缺失 | 四级候选路径 + 同扩展名模糊匹配；导入报告列出 missing 清单 |

---

## 15. 文件清单

```
IndiLife/
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── .gitignore
├── DESIGN.md                        ← 本文档
│
├── src/
│   ├── main/                        Electron 主进程
│   │   ├── index.ts                 应用入口、生命周期
│   │   ├── window.ts                窗口创建（hiddenInset / vibrancy）
│   │   ├── menu.ts                  菜单栏（工具栏项的对应命令）
│   │   ├── protocol.ts              jian:// 自定义协议 + Range
│   │   ├── paths.ts                 库路径、数据目录
│   │   ├── db/
│   │   │   ├── driver.ts            SqliteLike 三后端抽象
│   │   │   ├── connection.ts        连接、PRAGMA、迁移
│   │   │   ├── schema.sql           4.2 / 4.3 全部 DDL
│   │   │   ├── seed.ts              字典表种子数据
│   │   │   └── repos/
│   │   │       ├── items.ts
│   │   │       ├── collections.ts
│   │   │       ├── attachments.ts
│   │   │       ├── annotations.ts
│   │   │       ├── notes.ts
│   │   │       └── search.ts        FTS5 trigram
│   │   ├── zotero/
│   │   │   ├── preflight.ts         定位、版本检查、统计
│   │   │   ├── snapshot.ts          Backup API + 三文件拷贝兜底
│   │   │   ├── reader.ts            只读读取全部表
│   │   │   ├── paths.ts             四级候选附件路径解析
│   │   │   ├── importer.ts          编排 + 幂等 upsert
│   │   │   └── report.ts            导入报告
│   │   ├── ingest/
│   │   │   ├── doi.ts               CrossRef
│   │   │   ├── arxiv.ts             arXiv API
│   │   │   ├── pubmed.ts            NCBI eutils
│   │   │   ├── pdfGuess.ts          首页文本 → DOI / 标题 / 作者
│   │   │   ├── itemBuilder.ts       映射成 Zotero item 结构
│   │   │   └── fulltext.ts          pdf.js legacy 抽取 + FTS 写入
│   │   ├── translate/
│   │   │   ├── manager.ts           队列、并发、缓存、取消
│   │   │   ├── prompt.ts            prompt 构造
│   │   │   ├── placeholders.ts      占位符化与回填校验
│   │   │   ├── glossary.ts          术语表匹配
│   │   │   └── providers/
│   │   │       ├── openai-compatible.ts
│   │   │       ├── deepl.ts
│   │   │       ├── google.ts
│   │   │       └── ollama.ts
│   │   ├── cite/
│   │   │   ├── citeproc.ts          citeproc-js 封装
│   │   │   └── styles/
│   │   │       ├── gb-t-7714-2015.csl
│   │   │       ├── apa.csl
│   │   │       └── chicago-author-date.csl
│   │   ├── export/
│   │   │   ├── csljson.ts
│   │   │   ├── bibtex.ts
│   │   │   └── ris.ts
│   │   ├── security/
│   │   │   └── keystore.ts          safeStorage + security 命令行回退
│   │   └── ipc/
│   │       ├── index.ts             注册全部 handler
│   │       ├── library.ts
│   │       ├── import.ts
│   │       ├── ingest.ts
│   │       ├── pdf.ts
│   │       ├── translate.ts
│   │       ├── annotation.ts
│   │       ├── note.ts
│   │       ├── glossary.ts
│   │       ├── export.ts
│   │       ├── cite.ts
│   │       └── settings.ts
│   │
│   ├── preload/
│   │   └── index.ts                 contextBridge 具名方法
│   │
│   ├── shared/
│   │   ├── ipc-contract.ts          唯一契约
│   │   ├── types.ts                 ItemSummary / ItemDetail / PageLayout / Block ...
│   │   └── constants.ts             全部算法阈值
│   │
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── styles/
│           │   ├── tokens.css       11.3 全表
│           │   ├── global.css
│           │   └── translation.css
│           ├── app/
│           │   ├── router.tsx
│           │   └── store/
│           │       ├── library.ts
│           │       ├── reader.ts
│           │       ├── translate.ts
│           │       └── ui.ts
│           ├── features/
│           │   ├── library/
│           │   │   ├── LibraryView.tsx
│           │   │   ├── Sidebar.tsx
│           │   │   ├── ItemList.tsx
│           │   │   ├── ItemRow.tsx
│           │   │   ├── DetailPane.tsx
│           │   │   ├── ItemForm.tsx
│           │   │   └── QuickAddDialog.tsx
│           │   ├── import/
│           │   │   ├── ImportWizard.tsx
│           │   │   └── steps/{Preflight,Progress,Report}.tsx
│           │   ├── reader/
│           │   │   ├── ReaderView.tsx
│           │   │   ├── ReaderToolbar.tsx
│           │   │   ├── PdfScroller.tsx
│           │   │   ├── PageView.tsx           ← 命门一的实现
│           │   │   ├── BandCanvas.tsx
│           │   │   ├── TextLayer.tsx
│           │   │   ├── TranslationBlock.tsx
│           │   │   ├── AnnotationLayer.tsx
│           │   │   ├── AnnotationSidebar.tsx
│           │   │   ├── SelectionPopover.tsx
│           │   │   ├── geometry.ts
│           │   │   ├── usePdfDocument.ts
│           │   │   ├── usePageLayout.ts
│           │   │   └── useVirtualPages.ts
│           │   ├── reader/layout/             ← 命门二，纯函数，可单测
│           │   │   ├── index.ts
│           │   │   ├── lines.ts
│           │   │   ├── columns.ts
│           │   │   ├── regions.ts
│           │   │   ├── paragraphs.ts
│           │   │   ├── classify.ts
│           │   │   ├── references.ts
│           │   │   └── tiling.ts
│           │   ├── settings/
│           │   └── glossary/
│           └── workers/
│               ├── layout.worker.ts
│               └── pdfWorkerSetup.ts
│
└── test/
    ├── fixtures/
    │   ├── two-column-en.json
    │   ├── single-col-thesis.json
    │   ├── cnki-cn.json
    │   ├── formula-heavy.json
    │   ├── scanned.json
    │   └── long-refs.json
    └── layout/
        ├── lines.spec.ts
        ├── columns.spec.ts
        ├── paragraphs.spec.ts
        └── tiling.spec.ts
```

---

## 16. 待确认的点

以下五处我做了判断，但值得你亲自看一眼。它们都会影响后续返工量。

### ① 双栏 PDF 的 interlinear 副作用，你接受吗

左栏译文会把左栏后续内容下推，右栏不动，两栏逐渐错位，region 底部出现空白。

我的判断：可接受，因为双栏的两栏本来就是独立文本流，从不逐行对齐。但如果你常读双栏英文期刊，可能会觉得别扭。

**替代方案**：检测到双栏时，默认用 `sideBySide`（左原文右译文）而不是 `interlinear`。

### ② 划词浮层默认展示「整段译文」而不是「选中片段译文」

学术句子的语义依赖上下文，选三个词翻译经常是错的。

但这跟 `zotero-pdf-translate` 的习惯相反（它默认译选中）。如果你已经习惯后者，会觉得多一步。

### ③ 参考文献默认不翻译

学术阅读的共识，但如果你想看参考文献的中文，需要手动开。

### ④ 条目类型覆盖范围

我准备覆盖：`journalArticle / book / bookSection / thesis / report / webpage / preprint / newspaperArticle / manuscript / conferencePaper`。

你的库里只有前四种 + `report` + `newspaperArticle`。要更全还是够用就行？

### ⑤ 应用名「笺」的 bundle id

拟用 `com.kris.jian`。如果你想改（比如加个前缀），现在改成本最低。

---

## 17. 附录

### A. Zotero 标注 type 取值

| 值 | 类型 | 说明 |
|---|---|---|
| 1 | highlight | 高亮（可写 comment） |
| 2 | note | 便签（页面上一个可点击的图标） |
| 3 | image | 区域截图 |
| 4 | ink | 手绘 |
| 5 | underline | 下划线 |
| 6 | text | 文本选择（不改变外观，只记录位置） |

### B. Zotero 默认标注色板

`#ffd400` 黄 · `#ff6666` 红 · `#5fb236` 绿 · `#2ea8e5` 蓝 · `#a28ae5` 紫 · `#e56eee` 品红 · `#f19837` 橙 · `#aaaaaa` 灰

### C. 调试技巧

| 场景 | 方法 |
|---|---|
| 看版面分析结果 | 开发模式下按 `⌘⌥L`，在页面上叠加显示 band 边界与 block 分类色块 |
| 看原始 textContent | 阅读器里 `⌘⌥T` 打印当前页 items 到控制台 |
| 强制重算版面 | `⌘⌥R`，清空 `app_page_layout` 当前页缓存 |
| 强制重绘 canvas | `⌘⌥P` |
| 翻译请求日志 | 设置里开「详细日志」，写 `~/Library/Logs/笺/translate.log` |

### D. 关键参考来源

| 主题 | 来源 |
|---|---|
| Zotero 数据目录结构 | https://www.zotero.org/support/zotero_data |
| Zotero 直接读 sqlite 的官方态度 | https://www.zotero.org/support/dev/client_coding/direct_sqlite_database_access |
| Zotero 7/8/10 插件迁移（XUL overlay 废弃） | https://www.zotero.org/support/dev/zotero_7_for_developers |
| Zotero 插件权限说明 | https://www.zotero.org/support/plugins |
| Zotero schema（公开 JSON） | https://api.zotero.org/schema |
| Zotero 数据格式支持矩阵 | https://www.zotero.org/support/dev/data_formats |
| CSL-JSON 字段结构 | https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html |
| Apple HIG 侧边栏 | https://developer.apple.com/design/human-interface-guidelines/sidebars |
| Apple HIG 工具栏 | https://developer.apple.com/design/human-interface-guidelines/toolbars |
| Apple HIG 排版 | https://developer.apple.com/design/human-interface-guidelines/typography |
| Apple HIG 材质 | https://developer.apple.com/design/human-interface-guidelines/materials |
| Apple HIG 动效 | https://developer.apple.com/design/human-interface-guidelines/motion |
| Electron BrowserWindow 选项 | https://www.electronjs.org/docs/latest/api/structures/base-window-options |
| BabelDOC（双语 PDF 的工程参考） | https://github.com/funstory-ai/BabelDOC |
| PDFMathTranslate（EMNLP 2025 Demo） | https://github.com/PDFMathTranslate/PDFMathTranslate |
| zotero-pdf-translate（交互参考） | https://github.com/windingwind/zotero-pdf-translate |

---

*本文档随实现演进，任何偏离都会在对应章节标注「实现偏离」并说明原因。*
