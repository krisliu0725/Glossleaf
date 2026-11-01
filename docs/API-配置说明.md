# 笺 Jian · API 自定义配置

版本：0.3.1 · 更新日期：2026-10-29

## 使用路径

打开 PDF → 右上角「翻译设置」→ 选择服务 → 填写 API Key → 确认发送范围 →「测试翻译」→「保存配置」。

测试使用界面中当前填写的配置，不要求先保存，只翻译固定示例句。成功后会显示示例译文；不会读取当前文献。测试可能产生少量服务用量。关闭窗口而不保存，不会把草稿配置和密钥写入文库。

## 预设与模型

| 服务 | 接口协议 | API 基础地址 | 默认模型 ID |
|---|---|---|---|
| DeepSeek 官方 API | OpenAI 兼容 · Chat Completions | `https://api.deepseek.com` | `deepseek-flash` |
| Google Gemini API · Gemma 4 | Google 原生 · Gemini / Gemma | `https://generativelanguage.googleapis.com/v1beta` | `gemma-4-26b-a4b-it` |
| Google Gemini API · Gemini | Google 原生 · Gemini / Gemma | 同上 | `gemini-3.1-flash-lite` |
| 本地模型 · Ollama | Ollama 本地接口 | `http://127.0.0.1:11434` | `qwen3:8b` |

预设只用于填入初始值，端点和模型都可直接修改。它不代表你的账户已经拥有对应模型权限。Ollama 需要自行启动服务并安装模型。

Gemma 4 可将模型改成 `gemma-4-31b-it`。DeepSeek 模型也可直接填写服务商返回的其他 ID，例如 `deepseek-v4-pro`。Google 的 Gemma 模型与 Gemini 模型共用 Google API 基础地址和该端点已保存的密钥。

点击「获取模型列表」读取当前端点可返回的模型，随后在模型输入框中选择。Google 列表支持分页并过滤明确不支持生成内容的模型；列表可能受账户权限与服务端策略影响。列表失败时仍可手动输入模型 ID。

服务商模型及可用状态会变化。此处初始值按更新日的官方文档核对，实际可调用性以「测试翻译」与服务商控制台为准。

## 你可以调整的项目

- 服务和 API 基础地址。
- 模型 ID，自由输入或读取列表。
- API Key，可替换，也可明确移除当前端点的密钥。
- 「更多设置」中的接口协议、目标语言、Temperature 和请求超时。
- 「更多设置」中可预览最终请求地址，不显示密钥。

Temperature 默认 0，可填 0–2，具体模型可能有更窄的限制。请求超时默认 90 秒，可填 15–300 秒。改变生成温度会使用新的缓存标识；只改超时不会使相同成功译文的缓存失效。模型、端点或协议变化也会更新缓存标识。

使用代理或第三方托管 Gemma 时，根据服务商要求选择协议。如果它提供 `/chat/completions`，选择「OpenAI 兼容」；如果提供 Google 原生 `:streamGenerateContent`，选择「Google 原生」。这里只实现这两种流式协议与 Ollama 原生协议，未实现 Vertex AI 的服务账户/OAuth、Azure 部署式鉴权或任意自定义请求头。

## 地址怎么填

填写基础地址即可，程序会补齐相应路径：

| 协议 | 流式翻译路径 | 获取模型路径 |
|---|---|---|
| OpenAI 兼容 | `/chat/completions` | `/models` |
| Google 原生 | `/models/<模型ID>:streamGenerateContent?alt=sse` | `/models` |
| Ollama | `/api/chat` | `/api/tags` |

兼容接口中，若服务商要求 `/v1`，请保留这一级。例如 `https://example.com/v1`。官方 DeepSeek 预设使用根地址。

粘贴以 `/chat/completions`、Google 的 `/models/<模型ID>:generateContent` 或 `/api/chat` 结尾的地址时会去掉相应请求后缀。基础地址不能包含 Key、用户名、查询参数或片段；公共服务要求 HTTPS，本机回环地址允许 HTTP。不要把控制台网页地址当作 API 基础地址。

## 密钥与切换

密钥由主进程使用系统安全存储加密保存到文库目录 `.secrets/profiles.enc`，按「协议＋规范化端点」分开存放。配置读取只返回是否已有密钥，不返回密钥明文。备份不包含密钥；普通文献、设置和备份不会因此获得额外加密。

- 留空表示使用**当前端点**已保存的密钥。输入新值后，保存时替换它。
- 点击「移除此端点密钥」，再点击「保存配置」，才会执行移除；保存前可撤销。
- 切换到另一服务时不会把原服务密钥自动发送过去。切换回来后可继续使用原端点密钥。
- Google 使用 `x-goog-api-key` 请求头，兼容接口使用 Bearer 请求头；不把密钥放进 URL。
- 修改 API 基础地址或协议后会取消勾选发送同意项，需要重新确认。
- 从 0.3.0 升级时，旧的 `.secrets/provider.enc` 会在首次保存配置前迁移，并只绑定到升级前保存的端点。清空后不会因旧文件仍在而复活密钥。

系统安全存储不可用时不写入明文密钥，并显示错误。新电脑或恢复文库备份后，需要重新填写密钥。

## 常见反馈

| 反馈 | 处理 |
|---|---|
| 认证失败 | 检查当前端点密钥、账户/模型权限及地区访问条件 |
| 未找到接口或模型 | 核对协议、基础地址和模型 ID，避免重复填写请求路径 |
| 请求频繁或额度不足 | 查看服务商额度与频率限制；稍后再试 |
| 模型列表不识别 | 可先手填模型 ID，再用「测试翻译」核对 |
| 响应未正常完成 | 可能是长度截断、过滤或断流，不作为成功译文写入缓存 |

后台整篇任务在开始时冻结配置。更换模型后，旧任务不会静默改用新引擎继续；可切回原配置恢复，或取消后重新建立任务。

## 本轮验证

- 15 项自动测试通过，含 Google 原生 SSE、分包/多行事件、思考片段排除、正常终止与截断检查、Google 模型分页、DeepSeek 兼容路径及 Bearer 鉴权、密钥隔离和旧密钥迁移。
- TypeScript 严格检查与生产构建通过。
- Electron 真实界面通过预设选择、自定义模型保存、获取模型列表、草稿测试、选区翻译、段落翻译、摘录保存、缓存和整篇任务流程；两种协议均用本机模拟 API。
- 未使用你的真实密钥，未调用真实云端或真实 Ollama 模型，因此不宣称真实服务质量、额度、地区可用性或费用已经验证。

## 官方接口依据

- [DeepSeek API 基础地址与模型](https://api-docs.deepseek.com/)
- [Gemma 4 through Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)
- [Google 模型列表与分页](https://ai.google.dev/api/models)
- [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
