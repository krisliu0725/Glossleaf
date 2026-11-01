# Glossleaf 0.11.1 开发交接

2026-11-01，基线 0.11.0。此次修订的是动画、保存入口、连续导航和标签样式；具体问题与边界见 docs/REVIEW-0.11.1.md。

## 核心约束

- Workspace 导航统一排队，打开请求采用最新意图，关闭请求保持顺序。不得恢复 busy 时直接忽略用户输入或直接 setView 绕过提交的分支。
- ReaderController 带 documentVersionId；保存前核对身份。leave() 在批注队列完成后读取最新阅读状态；null 阻止离开，undefined 允许尚未就绪的文献离开但不覆盖已存记录。
- 侧栏批注的显式切换先提交；取消旧的 outside-click 自动关闭。文本与颜色写入共用队列，避免首次创建重复记录。
- 动画只用于轻微状态反馈；不平移正文布局。用户新输入取消旧恢复／重试／同步滚动。减少动态效果必须生效。
- Library 的已打开文献导航不使用阅读页的活动页签选中语义；关闭键和单标签宽度须隔离通用按钮样式。

## 代码入口

App.tsx：导航串行处理、意图版本、控制器身份核对、全局快捷键。
ReaderView.tsx：批注提交、状态恢复、取消过时定位、加载期工具保护。
reader/AnnotationTools.tsx：文本与颜色队列、草稿和错误恢复。
reader/ReaderTabs.tsx：导航语义、键盘焦点、水平滚动。
reader/motion.ts：可取消的单一滚动动画。
design/interaction-audit.css：最终样式，位于 reading-desk.css 之后。

## 验证

安装依赖后 npm run typecheck、npm test、npm run build。主要新验收为 scripts/glossleaf-interaction-audit-e2e.cjs，包含原生鼠标事件和人为延迟。reading-desk 回归用于六文献与中英文布局；fusion、geometry、reading-search、note-race 用于保留能力。只使用新的 JIAN_TEST_ROOT，绝不指向个人文库。

最终证据在 docs/evidence-0.11.1/verification.json。打包后核对 out 哈希、冷启动与签名。保持 Electron sandbox、context isolation 和 web security；不使用关闭沙箱参数。交接包不含 node_modules、临时数据库、个人原件或密钥。
