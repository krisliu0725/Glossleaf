# Current brand: Logo Colorways V3

0.9.0 uses the user-supplied assets in logo-v3/. See LOGO_USAGE_GUIDE.md there and src/shared/logo-palettes.json. Original two-path geometry is retained. The previous letterleaf assets below are historical and no longer used for the product header.

# 笺 · Glossleaf 品牌资源

0.8.0 当前页面品牌使用 `glossleaf-letterleaf.svg`：原创折角信纸与叶片线稿。组件实现位于 src/renderer/src/design/Brand.tsx，中英文布局独立适配。旧资源保留为历史素材；英文页面以 Glossleaf 为准。当前应用 Dock 图标仍沿用既有资源，此轮更新的是页面头部品牌。

# Jian Brand Kit v1.0 / 笺品牌资源包

基于《笺 Jian · 产品与设计开发方案 v3.0》。**不包含页面布局、页面效果图**。

- `design/JIAN_BRAND_GUIDELINES.md`：正式方案（命名、英译、五色、icon、字体、验收）
- `design/tokens.css`：浅色/深色主题色彩变量
- `locales/zh-CN.json`、`en-US.json`：中英文命名及常用操作词典
- `icons/app/`：应用图标 SVG；16、32、128、512px PNG，含浅/深模式及微型版
- `brand/`：中文/英文可编辑 SVG 字标（正式商用前转曲检验）
- `icons/core/`：六个核心功能 SVG（24×24、单色 currentColor）
- `icons/utility/`：辅助工具功能 SVG（24×24、单色 currentColor）
- `preview/Jian_Identity_Preview.png`：品牌规范概览图（非页面 UI）

注：所有图标是本次设计的初稿，非 macOS 官方或第三方注册商标。无字体文件分发。

开发提示：`currentColor` 功能图标请以内联 SVG / SVGR 组件方式使用，否则外部 `<img>` 的 CSS 色彩不会继承。
