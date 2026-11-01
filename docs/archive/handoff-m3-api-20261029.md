# 笺 Jian · M3 交接说明

日期：2026-10-29  
版本：0.3.1  
进度：M0–M2 原交接基础保留；M3 双语阅读闭环已实现并通过本文列出的测试。复杂真实论文的准确率、真实云服务质量与大规模性能未据此宣称达标。

## 启动

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm start
```

启动包装 `scripts/run.sh` 会清除继承的 `ELECTRON_RUN_AS_NODE`。运行时应使用自己的开发文库或设置 `JIAN_LIBRARY_DIR`，不要把验收样本混入日常文库。

在已有 M2 项目中使用本交付代码时，先保留项目和文库备份，再合并源码与构建配置，重新构建。没有新增 npm 依赖；沿用锁文件中已验证版本。压缩包包含预构建 `out/`，不包含 `node_modules`、真实文献、密钥和测试文库。

## M3 使用路径

1. 从文库打开 PDF。标准文本层允许选字；链接允许打开 HTTPS/HTTP 外部地址，内部 PDF 目的地可跳转。
2. 点击“翻译设置”。预设 DeepSeek、Google Gemini API 的 Gemma 4 / Gemini，以及 Ollama。端点、模型与密钥均可自行调整；“更多设置”可调整协议、目标语言、温度和超时。支持模型列表获取和保存前的示例翻译测试。具体步骤见 `docs/API-配置说明.md`。
3. 保存配置；云端请求须确认发送范围。密钥使用 Electron safeStorage 加密到文库 `.secrets/profiles.enc`，按协议及端点分开保存，不进入 SQLite 或备份。切换服务只读取该端点的密钥；旧 `provider.enc` 在首次保存前按旧配置迁移。
4. 点击“双语”，按段号定位原文，点击“翻译本页”或“翻译此段”。自动翻译默认不发起。
5. 选中文本，点击浮层“翻译”，查看带段落语境的流式结果；“存为摘录”保留原文、译文、评论与页级坐标，普通“高亮”不保存临时译文。
6. “术语表”支持文库级和文献级词条，以及编辑、移除。改动相关术语后重译生效，无关术语不改变相同请求缓存。
7. “整篇翻译”显示解析范围和粗略用量，确认后运行。支持暂停、继续、取消；重启后运行中任务恢复为暂停。配置变化时拒绝静默换引擎继续。连续三次失败后暂停，避免持续消耗。
8. “摘录”中点击“回到原文”，按持久锚点回跳。重新打开阅读器可读取已有成功缓存，不自动请求云端。

## 新增/修改模块

| 位置 | 责任 |
|---|---|
| `src/shared/providers.ts` | 服务预设、端点规范化、密钥身份与实际请求地址 |
| `src/main/translation/credentials.ts` | 按协议及端点隔离的系统加密密钥存储、旧配置迁移 |
| `src/shared/m3.ts` | 段落、坐标、请求事件、引擎、摘录与任务契约 |
| `src/data-service/m3.ts` | 术语、缓存、任务检查点、摘录与永久译文记录 |
| `src/main/translation/core.ts` | 端点校验、语境缓存键、术语匹配、占位符、SSE/NDJSON 解码与完成校验 |
| `src/main/translation/manager.ts` | 共享请求、订阅取消、交互槽位、文档任务生命周期 |
| `src/main/translation/ipc.ts` | 具名 IPC、密钥存储、配置和错误包装 |
| `src/renderer/src/reader/layout/analyze.ts` | 区域/栏位候选、行和段落、参考文献标记 |
| `PdfPage.tsx` | 标准文本层、链接、高亮、跨页 Range 到 PDF 锚点转换 |
| `ReaderView.tsx` | 双语联动、选区、摘录、任务、缩放和阅读位置 |
| `TranslationSettings` / `GlossaryDialog` / `Dialog` | 设置、术语及焦点约束 |
| `ImportedNote.tsx` | 导入笔记只读白名单树渲染，不使用原 HTML 注入 |
| `src/main/index.ts` / `guard.ts` | CSP 响应头、权限默认拒绝、主 frame 与来源校验 |
| `src/data-service/backup.ts` | 修复仅接受 v1 的旧备份检查；清单按一致副本读取 |
| `tests/m3.test.ts` / `scripts/e2e.cjs` | 可重复自动测试和 Electron 交互验收 |

继续保持：单一数据服务写连接、UUID 身份、origin_map 四元标识、内容寻址附件。M3 复用已有预留表，数据库 schema 仍为 v2，不修改 Zotero 原库。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
```

`pnpm test` 使用 Node 内置测试器与已安装的 esbuild，包含回环 HTTP 测试服务；严格沙箱需要允许本机监听。

Electron 验收（独立目录，每次使用新的目录）：

```bash
env -u ELECTRON_RUN_AS_NODE JIAN_TEST_ROOT=/tmp/jian-m3-test \
  ./node_modules/.bin/electron scripts/e2e.cjs

env -u ELECTRON_RUN_AS_NODE JIAN_TEST_PROVIDER=gemini JIAN_TEST_VARIANT=rotate \
  JIAN_TEST_ROOT=/tmp/jian-m3-rotated \
  ./node_modules/.bin/electron scripts/e2e.cjs
```

测试自动生成合成 PDF 和模拟翻译响应，不向真实服务发送文献。测试目录中包含证据 JSON 和截图。模拟译文只是功能夹具，不能证明真实翻译质量。

0.3.1 验证：15 项自动测试、两种协议 Electron 流程通过；原生 Google 在旋转/CropBox 样本上通过。未使用真实密钥。API 配置详见 `docs/API-配置说明.md`，M3 结果与限制详见 `docs/M3-验收与使用说明.md`。M2 原始交接保留在 `docs/archive/handoff-m2-20261029.md`。

## 仍在后续范围

- M4 的全文/摘录搜索、DOI 元数据入库、引用与交换格式导出。
- 行间重排、OCR、CAJ 解析不属于本轮 M3。
- 更多复杂真实论文、日俄等多语文档、RTL、UserUnit、长文内存和 VoiceOver 全流程仍需扩展验收。
- 段落分析为可测的本地启发式实现；尚未建立人工标注语料，不能宣称达到 DESIGN.md 的真实论文 F1 目标。
- 真实云端与真实 Ollama 模型的质量、额度、速率和费用需要在用户配置后实测；本轮验证协议与任务行为。
- 既有 M2 的相对外链重定位、导入流式进度、孤立 blob 清理、来源关系移除入口和更完整冲突 UI 继续保留为后续工作，不影响本轮合成样本闭环验收。
- 多窗口阅读标签恢复、自动可见段落翻译开关、译文字号 UI、独立页面背景偏好及正式签名公证留在日常打磨阶段。
