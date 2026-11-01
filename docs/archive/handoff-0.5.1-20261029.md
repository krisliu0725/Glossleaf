# 笺 Jian · 0.5.1 交接

2026-10-29 · schema v4 · 在 0.5.0 基础上做了一轮界面与信息架构调整。

- 完整状态见 `docs/M5-M6与Dashboard-验收说明.md`
- 本轮改动见 `docs/refinement-2026-10-29.md`（六条反馈逐条对应）
- M5 / M6 的正式发行门槛仍未全部完成

---

## 1. 本轮改了什么（0.5.0 → 0.5.1）

| # | 问题 | 处理 |
|---|---|---|
| 1 | 使用概览侧栏左下有大片空白 | 页脚不再 `margin-top:auto`，紧跟导航；留白处只放竖向渐隐线与「笺」印记 |
| 2 | 「研究方向」用集合名当分类 | 数据层删除以 `collection` 兜底 `fields` 的查询；改为**文献标签 + 用户确认分类**，页面由两列改为单列排行 |
| 3 | 趋势图不好看；总览与阅读记录几乎一样 | 柱状图换成**连续周列热力图**（一列一周、一行一日、月份标在底部、五级朱色、每天/每周切换）；两个面板内容拆分 |
| 4 | 文库侧栏死板、行之间没边界 | 每行加 16px 线性图标；分组标题加细分隔线；悬停底色；选中行左侧起朱线；计数改胶囊 |
| 5 | 检索关键词看不清 | 高亮从 12% 朱色底改为**黄底墨字 + 下缘细线**；命中类型用颜色区分（文献信息=黄、正文=青、摘录=朱） |
| 6 | 命名似是而非 | 改为两字实词：**文库 / 阅读 / 个人**（Library / Reader / Profile）；默认页改为**文库**；总览并入「个人」，加本地账户条与用户名编辑；落地五色 token |

### 涉及文件

```
src/renderer/src/i18n.ts                     新增：中英文案、本地用户名
src/renderer/src/analytics/Heatmap.tsx       重写：连续周列热力图
src/renderer/src/analytics/Dashboard.tsx     重写：个人页、账户条、面板拆分
src/renderer/src/views/LibraryView.tsx       侧栏图标、i18n、?q= 深链
src/renderer/src/views/LibraryIcons.tsx      新增：侧栏图标
src/renderer/src/views/view.ts               导航顺序（文库在前）
src/renderer/src/App.tsx                     默认视图、导航文案、话题跳转
src/renderer/src/m4/SearchResults.tsx        命中类型 data-kind
src/renderer/src/design/tokens.css           五色 token
src/renderer/src/design/refine.css           新增：本轮全部样式覆盖
src/data-service/analytics.ts                研究方向不再取集合
```

---

## 2. 使用

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

> **本机必读**：Electron 的 Chromium 沙箱会与某些宿主沙箱冲突，表现为
> `sandbox initialization failed: Operation not permitted` 后 SIGTRAP 崩溃。
> 无头运行或截图时加 `--no-sandbox`：
>
> ```bash
> ./scripts/run.sh start --no-sandbox
> ```

入口：**文库 / 阅读 / 个人**；设置或 `⌘,` 管理外观、统计和 API。

开发期无头截图（本仓库自带）：

```bash
JIAN_LIBRARY_DIR=/tmp/jian-dev-lib \
JIAN_VIEW=dashboard JIAN_QUERY="panel=research" \
JIAN_CAPTURE=/tmp/shot.png JIAN_CAPTURE_DELAY=7000 \
./scripts/run.sh start --no-sandbox
```

可用参数：`JIAN_VIEW` = `library` / `reader` / `dashboard` / `probe`；
`JIAN_QUERY` 支持 `panel=overview|reading|research|models`、`q=<检索词>`。

---

## 3. 验证

`pnpm test` 共 40 项。Electron 脚本应为每次运行指定全新测试目录，并移除宿主继承的 `ELECTRON_RUN_AS_NODE`：

```bash
env -u ELECTRON_RUN_AS_NODE JIAN_TEST_ROOT=/tmp/jian-m5 \
  ./node_modules/.bin/electron scripts/m5-ui-e2e.cjs

env -u ELECTRON_RUN_AS_NODE JIAN_TEST_ROOT=/tmp/jian-dashboard \
  ./node_modules/.bin/electron scripts/dashboard-e2e.cjs

env -u ELECTRON_RUN_AS_NODE JIAN_TEST_ROOT=/tmp/jian-reading \
  ./node_modules/.bin/electron scripts/reading-activity-e2e.cjs

env -u ELECTRON_RUN_AS_NODE JIAN_TEST_ROOT=/tmp/jian-m6 \
  ./node_modules/.bin/electron scripts/e2e-m6.cjs
```

本轮改动后的实际状态：`tsc --noEmit` 通过、`electron-vite build` 三入口通过、
用 51 篇真实文献的测试库（`/tmp/jian-dev-lib`，schema v2 → v4 自动迁移）逐页截图核对。

---

## 4. 数据与边界

- schema 仍为 v4，本轮未改表结构；只删掉一处统计查询。
- 研究方向不再受集合影响：已确认分类优先，其余取文献标签。多个标签可覆盖同一文献，时长不可直接相加。
- 热力图粒度：总览固定 52 周；阅读记录按时间范围取 13 / 26 / 39 / 52 周。
- **英文版只覆盖壳**：导航、个人页、文库侧栏、主要按钮可切 EN；
  统计口径说明、对话框正文仍是中文，属完整 i18n 的后续工作。
- 正式签名公证、真实长读/大文库性能、完整恢复矩阵与 M2 历史边界继续待办。

历史交接归档在 `docs/archive/`；第三方来源与许可见 `THIRD_PARTY.md` 与 `resources/licenses/`。
