# Verification scripts

For 0.6.0, run test.cjs via pnpm test, then the three redesign-*.cjs desktop checks with a fresh JIAN_TEST_ROOT.

- redesign-e2e.cjs: compact Library, Settings, English UI, Reader, saving work, Trash, and Dashboard.
- redesign-chinese-e2e.cjs: real CJK PDF extraction and grouping with synthetic material.
- redesign-inline-e2e.cjs: experimental interlinear source pixels, anchors, selection, and restored position.
- package-preview.cjs: macOS local preview packaging; requires a fresh .app destination and keeps the Chromium sandbox.
- make-fixture.cjs / make-chinese-fixture.cjs: reproducible synthetic PDFs.

Earlier stage e2e scripts are retained for historical evidence and describe their original interfaces. Their selectors are not the current acceptance entry points. Never run fixtures against a personal library.

## 0.7.0 / Glossleaf

Use glossleaf-e2e.cjs for the current general desktop regression and glossleaf-features-e2e.cjs for the new title, metadata, provider and citation flows. Run redesign-chinese-e2e.cjs and redesign-inline-e2e.cjs for the preserved PDF features. Old redesign-e2e.cjs asserts the historical 56px row layout and is retained as history, not a current acceptance script. Each run needs a fresh JIAN_TEST_ROOT. Keep the Electron sandbox enabled and unset ELECTRON_RUN_AS_NODE.

## 0.10.1 acceptance

Use glossleaf-fusion-e2e.cjs for the shared shell, unified selection panel, note writing/review, stable zoom, navigation and export; glossleaf-fusion-geometry.cjs for zoom/rotation/cross-page/scan checks. The 0.10.0 reading-room suite asserts the superseded single-header/printed-label design and is historical. reading-search, note-race and redesign-inline preserve their functional scope; reading-performance supports the synthetic 200-page case and optional GLOSSLEAF_REAL_PDF for the known 13-page acceptance document. Never set JIAN_TEST_ROOT or JIAN_LIBRARY_DIR to a personal library. The optional real PDF is linked and hash checked, never bundled in delivery.

## 0.11.0 acceptance

The current UI entry is glossleaf-reading-desk-e2e.cjs (split toolbar, compact notes, tabs, six long titles, saved-state isolation, immediate commit, save-conflict navigation barrier and recovery). Session lifetime is the window; only the active Reader is mounted. The fusion suite uses the updated visible controls and waits for asynchronous saved navigation. Use fresh JIAN_TEST_ROOT values; never run against a personal library.

## 0.11.1 interaction audit

Use glossleaf-interaction-audit-e2e.cjs for actual Chromium pointer events, gated slow annotation writes/reading responses, latest-intent navigation, queued closes, focus and animation interruption. glossleaf-home-navigation-e2e.cjs checks Reader→Memoir commit, five Settings scroll regions and returning through Library. The compact Library document shelf is navigation, not an active Reader tablist. Use fresh isolated JIAN_TEST_ROOT values only.
