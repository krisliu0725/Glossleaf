# 笺 · Glossleaf 0.7.0 改进与交付说明

日期：2026-10-30。基于 0.6.0 独立开发，保持真实用户项目与文库原状。

## 本轮结果

| 需求 | 已完成的改进 |
|---|---|
| 长标题与行空间 | 中栏获得更多宽度；行高随标题伸展，标题最多两行，作者/刊物另占一行，固定年份列；超长标题省略并提供完整悬停文本 |
| 中文字体 | 书府侧栏、中栏、设置、弹窗等应用文字统一使用衬线字体体系，中文回退到宋体，取消黑体作为主要界面字体 |
| 引用与导出 | 五种真实 CSL 样式；文内引用与参考文献分别复制；参考文献支持富文本；新增 RIS 与 HTML，保留 CSL-JSON、BibTeX、Markdown、摘录 JSON |
| 元数据 | 本机前两页索引提取 DOI 提示；Crossref 检索、DataCite DOI 回退；题名候选排名、责任者识别、字段差异比较、逐项合并与来源记录 |
| 模型服务 | DeepSeek、GPT、Claude、Gemini、Gemma、Kimi 全球/中国、Ollama 与自定义入口；保留地址、协议、型号和密钥编辑与模型发现 |
| 提示标识 | 菜单、下拉框、折叠区、集合统一采用同一折线箭头；动作菜单使用轻微折角，呼应信笺 |
| 按钮 | 统一圆角、控件高度、图文间距与操作组间距，修正设置页按钮贴边问题 |
| 无意义标签 | 移除小传页面的 Asia/Shanghai 等时区展示，内部仍按本地日期正确计算 |
| 两个主页 | 顶部书府 / 小传开关，与设置收纳到同一区域，移除侧栏底部的小传重复入口 |
| 英文品牌与层级 | 可见英文品牌改为 Glossleaf；Collections / Tags 同字号、字重、常规大小写，不再一处全大写一处混排 |
| 英文排版 | 随应用提供 Adobe Source Serif 4 常规与半粗字体，离线可用；中英文共享留白、色彩和层级，文案按操作语境适配 |

## 版式与字体

列表单行标题与双行标题使用不同的实际高度，作者来源始终在标题下方。宽窗口与 900 像素窗口均验证了中英文、两行题名和极端长题名。省略只作用于题名显示，不截断元数据本身。侧栏集合名称也可自然换行。

字体为 Source Serif 4 → Iowan Old Style / Baskerville / Georgia → Songti SC / STSong / Noto Serif CJK SC → serif 的回退体系。英文随包使用 Source Serif 4，中文在 macOS 使用系统宋体。没有提取、复制或分发系统字体；跨平台中文显示依赖目标系统已有的宋体类字体。

功能图标仍然使用原有线稿体系，避免装饰性文字占用工具空间。展开方向随状态转动，键盘焦点与禁用状态保留。顶部切换不再与列表视图选项混淆。

## 引用与导出怎么用

选中文献 → 详情更多操作 → 引用与导出。也可选择多篇导出。提供 GB/T 7714—2015 顺序编码、APA 第 7 版、MLA 第 9 版、Chicago Author–Date、IEEE。样式由 citeproc-js 与实际 CSL 文件生成，并附样式来源、许可、版本内容哈希。

面板显示文内引用与参考文献。两个位置可分别复制；参考文献同时写入纯文本和 HTML 剪贴板，在支持的编辑器中保留斜体。详情里的快速复制沿用本机最近选择的样式。

- TXT：纯文本参考文献。
- HTML：含基本排版的参考文献文件。
- RIS / BibTeX / CSL-JSON：文献元数据交换。
- Markdown / JSON：已保存的阅读摘录、译文、评论及来源锚点。

这些导出不能替代带附件的完整书府备份。文内引用当前为所选文献生成的通用引文，不包含 Word 动态字段、自动回链或用户指定页码。

## 元数据识别如何工作

采用“本机识别线索 → 受信元数据库查询 → 候选核对 → 字段合并”的方式，参考 Zotero 的 PDF 元数据识别思路。Zotero 的公开文档说明其服务结合 PDF 前几页文字与 DOI / ISBN、Crossref 等线索；本版仅在本机提取 DOI 提示，并把用户可见的 DOI 或题名发给固定元数据库，不上传 PDF 前几页全文。[Zotero 官方说明](https://www.zotero.org/support/retrieve_pdf_metadata)

编辑文献信息时展开检索区，可采用索引前两页发现的 DOI，也可直接输入完整题名。DOI 优先查询 Crossref；只有未收录（404）时回退到 DataCite，认证/限流/网络错误不会被当作无结果掩盖。对返回 DOI 再次核验，避免采用不一致记录。[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api)、[DataCite REST API](https://support.datacite.org/docs/rest-api)

题名检索最多返回六个候选，使用规范化题名的二元字符相似度进行本地排序。此值是字符串相似度，不是作者匹配概率，也不是文章身份确认。作者、出版物和年份同时显示，用户核对后再逐项采纳。机构作者保持为机构；个人姓名保留姓与名的结构。已有字段默认不覆盖；原记录中的自定义字段保留。

来源系统、原始元数据和检索时间与条目一起保存。查询取消、响应大小限制、固定服务主机与本地重复 DOI 检查继续生效。没有通过模型臆测作者，也没有批量静默修正文库。

公开服务覆盖存在边界：中文数据库中的部分文章、扫描件、无 DOI 资料或出版方缺失记录仍需人工编辑或从已有 Zotero 库导入。本轮未实现浏览器 Connector、任意出版社页面抓取、OCR 或 ISBN 查询。

## 服务接入

| 预设 | 协议 | 地址与模型 |
|---|---|---|
| DeepSeek | Chat Completions 兼容接口 | 可编辑 |
| OpenAI / GPT | Chat Completions | 可编辑；先获取模型列表或输入型号 |
| Anthropic / Claude | 原生 Messages + SSE | 可编辑；支持原生模型列表分页与用量事件 |
| Gemini / Gemma | Google 原生内容生成 | 可编辑，沿用已有接入 |
| Kimi 全球 / 中国 | Chat Completions 兼容接口 | 两个区域地址预设，均可编辑 |
| Ollama | 本机接口 | 可编辑 |
| 自定义 | 四种协议中选择 | 自填地址与型号 |

新加入的服务不硬编码某个长期有效的型号，避免账户权限、地区与产品迭代造成误导。接口预设不是账号权限或可用性保证。密钥按协议和端点分别加密保存，切换端点不借用其他端点的密钥，云端内容授权继续独立确认。

Claude 使用核对过的原生请求、流事件与分页，用量合并处理累计值；按当前协议不发送已移除的 temperature。兼容接口的 Temperature 可留空采用服务默认，也可手动配置。具体模型是否支持该接口和参数，仍以服务实际返回为准。[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Claude Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、[Claude API 版本](https://platform.claude.com/docs/en/api/versioning)、[Moonshot 官方配置](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/providers.md)

## 验证与兼容

本版使用隔离合成资料与模拟服务验证，不修改用户真实文库，不消耗用户模型额度。测试结果、桌面截图和打包验证记录随交接包提供；自动化不能代表真实模型质量或所有学术数据库的覆盖率。

保留 SQLite schema 4、文库数据路径、密钥存储身份及 jian 内部命名空间。品牌改为 Glossleaf 不会把已有资料迁移到一个看似空白的新目录。阅读、摘录、札记、索引、备份与实验夹注沿用原功能。

预览应用为 macOS arm64 本地 ad-hoc 签名，尚未公证。历史方案和证据保留供追踪，但新版主页入口和字体约定以 0.7.0 为准。

## 开发接续

交接包 project/ 包含源码、测试、脚本、构建产物、引用样式、字体、锁文件、许可与文档；handoff/ 提供交接与使用入口。运行方式与主要文件见 [HANDOFF.md](../HANDOFF.md)。

## 验收结果

65 项自动测试全部通过；类型检查和生产构建通过。四组桌面回归通过，覆盖新功能、中英文读写流程、中文 PDF 与夹注实验。900 / 1280 像素窗口验证通过；缩放后 PDF 区域宽度分别为 495 / 704 像素，滚动内容与容器同宽。夹注前后原件像素差异为 0，锚点差异为 0，恢复阅读偏移约 79.2 像素（目标 80）。打包产物与构建逐文件一致，本地签名验证和英文冷启动通过。

公开 DOI 联通检查：Crossref 与 DataCite 均返回并通过身份/题名/作者解析。仅使用公开示例 DOI，无用户资料。

## 界面预览

以下均为隔离合成资料，用于展示布局，不是用户真实文献或模型质量示例。

中文书府：两行长标题与作者来源分开，保留年份列。

![中文书府：两行长标题与作者来源分开，保留年份列。](evidence-0.7.0/features/long-titles-zh-1280.png)

英文 Glossleaf：Source Serif 4、统一的 Collections / Tags 层级和双主页开关。

![英文 Glossleaf：Source Serif 4、统一的 Collections / Tags 层级和双主页开关。](evidence-0.7.0/features/long-titles-en.png)

引用面板：APA、文内引用与参考文献分别复制。

![引用面板：APA、文内引用与参考文献分别复制。](evidence-0.7.0/features/citation-apa-en.png)

元数据：候选核对、差异选择与保留已有信息。

![元数据：候选核对、差异选择与保留已有信息。](evidence-0.7.0/features/metadata-review-zh.png)

Memoir：统计仍按本地日期计算，去除技术时区标签。

![Memoir：统计仍按本地日期计算，去除技术时区标签。](evidence-0.7.0/features/memoir-en.png)
