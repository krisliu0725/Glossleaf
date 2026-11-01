# M4 新增第三方组件与来源

## citeproc-js 2.4.63

- 作者 / 版权：Copyright © 2009–2019 Frank Bennett。
- 项目：https://github.com/Juris-M/citeproc-js
- npm 固定版本：`citeproc@2.4.63`。
- 原发行提供 CPAL 或 AGPL 双重许可；本交付选择 CPAL-1.0。
- 原始 NOTICE、完整 CPAL 文本、未修改的处理器源文件分别保存在 `resources/licenses/citeproc-NOTICE.txt`、`CPAL-1.0.txt`、`citeproc-2.4.63-source.js`。源文件 SHA-256 记录在资源清单。
- 引用预览中显示处理器和版权署名，可展开查看版本信息。

## Citation Style Language 样式与 locale

- 样式：China National Standard GB/T 7714-2015 (numeric, 中文)。原作者牛耕田，贡献者 Zeping Lee；原始文件内保留作者、联系方式、ID、更新时间和许可。
- 样式来源：https://github.com/citation-style-language/styles/blob/master/china-national-standard-gb-t-7714-2015-numeric.csl
- Locale 来源：https://github.com/citation-style-language/locales ，本交付保存 zh-CN 与 en-US。
- 三份文件均按源文件声明使用 CC BY-SA 3.0，未修改。完整许可见 `resources/licenses/CC-BY-SA-3.0.txt`。
- 取得日期：2026-10-29。精确内容 SHA-256 见 `resources/csl/manifest.json`；不依赖运行时在线读取 master。

## 独立交换格式测试

- `@citation-js/core@0.7.21` 与 `@citation-js/plugin-bibtex@0.7.21`，作者 Lars Willighagen，MIT。
- 项目：https://github.com/citation-js/citation-js
- 只用于测试导出的 CSL-JSON / BibTeX，可由另一套解析器读取；不承担生产引用排版。

## 元数据服务

DOI 查询使用 Crossref REST API：https://www.crossref.org/documentation/retrieve-metadata/rest-api/ 。只对用户主动输入的 DOI 查询元数据。保留返回的原始元数据与取得时间，不在本地离线包内预载用户文献资料。

本清单仅列出 M4 新增部分。其他 Electron、PDF.js、React、SQLite 及已有依赖的上游许可继续适用，固定依赖树见 `pnpm-lock.yaml`。

## 0.5.0 本地预览运行时

本地 `.app` 同时附带 Electron 发行包中的 LICENSE、完整 Chromium 第三方声明，以及 React / React DOM、PDF.js、Zod、Zustand、Floating UI、TanStack React Virtual 的上游根许可文本，保存在 `resources/licenses/runtime/`，对应版本和文件见该目录 manifest。PDF.js 字体、CMap、WASM 等离线目录继续保留随目录的声明。字体通过系统字体栈调用，未另行打包商业字体。此清单不代表完成正式分发的全部依赖合规审计。

## Added in 0.7.0

- **Source Serif 4**, Adobe. Copyright 2014–2023 Adobe; SIL Open Font License 1.1. Unmodified Regular and Semibold OTF files are included under src/renderer/src/design/fonts/. License: resources/licenses/SourceSerif-OFL.txt. No system fonts are redistributed.
- **APA 7th edition, MLA Handbook 9th edition, Chicago Author–Date, IEEE CSL styles**, from the official citation-style-language/styles repository. Each file retains its original author credits and CC BY-SA 3.0 notice in its info section. The files are unmodified. Existing CC BY-SA license text is included in resources/licenses/; upstream URLs and SHA-256 digests are recorded in resources/ADDED-SOURCES-0.7.json.
- citeproc-js and the existing GB/T style/locales retain their previous attribution and licenses. New styles are rendered through the same local processor.

## User-provided Logo Colorways V3

The user supplied the Glossleaf Logo Colorways V3 archive and usage guide. Original assets are retained under resources/brand/logo-v3/. Application use follows that guide; no independent public redistribution license is inferred.

## LXGW WenKai

The unmodified LXGWWenKai-Regular.ttf is bundled for margin notes. Copyright 2021-2025 LXGW and Copyright 2020 The Klee Project Authors. Licensed under SIL OFL 1.1; see docs/licenses/LXGW-WenKai-OFL.txt and the embedded font metadata. Source: https://github.com/lxgw/LxgwWenKai. Source Serif 4 remains the Latin interface face; long notes fall back to the editorial serif.
