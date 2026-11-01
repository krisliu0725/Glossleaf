import { dateLocale, getLocale } from '../i18n'
import { ui } from '../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnalyticsRange, DashboardSnapshot, ItemClassification } from '@shared/analytics'
import type { ItemSummary } from '@shared/domain'
import Dialog from '../reader/Dialog'
import Mark from '../design/Mark'
import Heatmap from './Heatmap'
import {ReadingCharts,TopicCharts,ModelCharts} from './ResearchCharts'
import { calendarWeeks } from './calendar'
import { useStrings } from '../i18n'
import './dashboard.css'

type Panel = 'reading' | 'research' | 'models'
type Definition = 'reading' | 'characters' | 'pages' | 'tokens' | 'sources'

const number = (value: number): string => new Intl.NumberFormat(dateLocale()).format(Math.round(value))
const compact = (value: number): string => getLocale() === 'en' ? new Intl.NumberFormat('en-US', {notation:'compact',maximumFractionDigits:1}).format(value) : (value >= 10000 ? ui("{0}万", (value / 10000).toFixed(1)) : number(value))

function duration(ms: number): string {
  const minutes = ms / 60000
  if (minutes < 1) return ms > 0 ? ui("{0} 秒", Math.round(ms / 1000)) : ui("0 分钟")
  if (minutes < 60) return ui("{0} 分钟", Math.floor(minutes))
  return ui("{0} 小时 {1} 分", Math.floor(minutes / 60), Math.floor(minutes % 60))
}

const purposeNames = { interactive: '交互翻译', background: '整篇后台', test: '连接测试' }

function rangeLabel(range: AnalyticsRange): string {
  return range === '7' ? ui("最近 7 天") : range === '30' ? ui("最近 30 天") : range === '90' ? ui("最近 90 天") : ui("自开始记录")
}

/* ---------- 图标：16px 线性，与宋体标题的中宫相称 ---------- */

const iconProps = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

function IconReading(): React.ReactElement {
  return (
    <svg {...iconProps} className="sidebar__icon">
      <path d="M2.5 3.5h4A1.5 1.5 0 0 1 8 5v8a1.2 1.2 0 0 0-1.2-1.2H2.5z" />
      <path d="M13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8a1.2 1.2 0 0 1 1.2-1.2h4.3z" />
    </svg>
  )
}
function IconThreads(): React.ReactElement {
  return (
    <svg {...iconProps} className="sidebar__icon">
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="12" cy="6" r="1.6" />
      <circle cx="7" cy="12" r="1.6" />
      <path d="M5.3 4.7l5 1M11 7.2l-3 3.4M5.4 5.4l1.2 5" />
    </svg>
  )
}
function IconTally(): React.ReactElement {
  return (
    <svg {...iconProps} className="sidebar__icon">
      <path d="M3 12.5V8M6.3 12.5V5M9.6 12.5V9.5M13 12.5V4" />
    </svg>
  )
}
function IconLibrary(): React.ReactElement {
  return (
    <svg {...iconProps} className="sidebar__icon">
      <path d="M2.5 4.5h5v9h-5zM7.5 4.5h3v9h-3z" />
      <path d="M11.6 5.2l2 .5-2 8.2-2-.5z" />
    </svg>
  )
}
function IconPress(): React.ReactElement {
  return (
    <svg {...iconProps} className="sidebar__icon">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M4 4l1.1 1.1M10.9 10.9L12 12M12 4l-1.1 1.1M5.1 10.9L4 12" />
    </svg>
  )
}

const PANEL_ICONS: Record<Panel, () => React.ReactElement> = {
  reading: IconReading,
  research: IconThreads,
  models: IconTally
}

/* ---------- 基础组件 ---------- */

function Metric({
  label,
  value,
  unit,
  description,
  onInfo
}: {
  label: string
  value: string
  unit?: string
  description: string
  onInfo: () => void
}): React.ReactElement {
  return (
    <article className="dash-metric">
      <div className="dash-metric__head">
        <h2>{ui(String(label))}</h2>
        <button onClick={onInfo} aria-label={ui("{0}统计口径", label)} title={ui("查看统计口径")}>
          {ui("口径")}<Mark name="details" size={13}/></button>
      </div>
      <p className="dash-metric__value">
        {value}
        {unit && <span>{getLocale() === 'en' && ['条','次','个','项'].includes(String(unit)) ? '' : ui(String(unit))}</span>}
      </p>
      <p className="dash-metric__description">{description}</p>
    </article>
  )
}

/** 标签驱动的话题排行：basis 为 confirmed 表示用户确认过，tag 表示取自文献标签。 */
function TopicList({
  rows,
  limit,
  empty,
  onPick
}: {
  rows: DashboardSnapshot['topics']
  limit: number
  empty: string
  onPick?: (topic: string) => void
}): React.ReactElement {
  const max = Math.max(1, ...rows.map((r) => r.activeMs))
  if (rows.length === 0) {
    return (
      <div className="dash-chart-empty dash-chart-empty--small">
        {ui(empty)}
        <span>{ui("文献自带的标签会自动成为话题，无需手工建立。")}</span>
      </div>
    )
  }
  return (
    <div className="dash-topics">
      {rows.slice(0, limit).map((row) => (
        <div key={`${row.basis}-${row.id}`} className="dash-topic">
          <span className="dash-topic__name">
            {row.label}
            <span className="dash-topic__basis">　{row.basis === 'confirmed' ? ui("已确认") : ui("标签")}</span>
          </span>
          <span className="dash-topic__count">{row.documents} {getLocale() === 'en' && row.documents === 1 ? 'document' : ui("篇")}</span>
          <span className="dash-topic__time">{duration(row.activeMs)}</span>
          {onPick && <button type="button" className="icon-button topic-open" aria-label={ui("以「{0}」检索文库", row.label)} title={ui("以「{0}」检索文库", row.label)} onClick={() => onPick(row.label)}><Mark name="search" size={16}/></button>}
          <span className="dash-topic__track">
            <span style={{ width: `${(row.activeMs / max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

function ClassificationDialog({
  initialItem,
  onClose,
  onSaved
}: {
  initialItem?: string
  onClose: () => void
  onSaved: () => void
}): React.ReactElement {
  const [items, setItems] = useState<ItemSummary[]>([])
  const [selected, setSelected] = useState(initialItem ?? '')
  const [query, setQuery] = useState('')
  const [topics, setTopics] = useState('')
  const [field, setField] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [classifying, setClassifying] = useState(false)

  useEffect(() => {
    let dead = false
    const timer = setTimeout(() => {
      void window.jian.library.list({ query: query || null, limit: 100 }).then((r) => {
        if (dead) return
        if (r.ok) {
          setItems(r.data.items)
          if (!selected && r.data.items[0]) setSelected(r.data.items[0].id)
        } else setMessage(r.error.message)
      })
    }, 180)
    return () => {
      dead = true
      clearTimeout(timer)
    }
  }, [query, selected])

  useEffect(() => {
    let dead = false
    setTopics('')
    setField('')
    setClassifying(!!selected)
    if (selected)
      void window.jian.analytics.classifications(selected).then((r) => {
        if (dead) return
        if (r.ok) {
          setTopics(r.data?.topics.join('，') ?? '')
          setField(r.data?.field ?? '')
        } else setMessage(r.error.message)
        setClassifying(false)
      })
    return () => {
      dead = true
    }
  }, [selected])

  async function save(): Promise<void> {
    if (!selected) return
    setBusy(true)
    const value: ItemClassification = {
      itemId: selected,
      topics: [...new Set(topics.split(/[,，;；\n]/).map((v) => v.trim()).filter(Boolean))],
      field: field.trim() || null
    }
    try {
      const r = await window.jian.analytics.classify(value)
      if (r.ok) {
        onSaved()
        onClose()
      } else setMessage(r.error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={ui("整理志趣")}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="provider-footer-content">
          {message && <p role="status">{ui(message)}</p>}
          <button className="btn btn--primary" disabled={busy || classifying || !selected} onClick={() => void save()}>
            {ui("保存分类")}</button>
        </div>
      }
    >
      <div className="m3-form">
        <label>
          {ui("查找文献")}<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ui("题名或作者")} disabled={busy} />
        </label>
        <label>
          {ui("文献")}<select aria-label={ui("分类文献")} disabled={busy} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">{ui("请选择文献")}</option>
            {selected && !items.some((i) => i.id === selected) && <option value={selected}>{ui("当前文献")}</option>}
            {items.map((i) => (
              <option value={i.id} key={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {ui("关注话题")}<input value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={ui("例如：能源转型，国际关系")} disabled={busy || classifying} />
        </label>
        <label>
          {ui("所属领域")}<input value={field} onChange={(e) => setField(e.target.value)} placeholder={ui("例如：政治学")} disabled={busy || classifying} />
        </label>
        <p className="m3-muted">{ui("话题可以有多个，以逗号分隔。确认的分类优先于标签参考，不会修改原文献的标签或来源数据。")}</p>
      </div>
    </Dialog>
  )
}

function MetricNotes({
  kind,
  data,
  onClose
}: {
  kind: Definition
  data: DashboardSnapshot
  onClose: () => void
}): React.ReactElement {
  const notes: Record<Definition, { title: string; body: string[] }> = {
    reading: {
      title: ui("有效阅读时长"),
      body: [
        ui("只累计阅读器处于前台、窗口有焦点、最近一分钟有交互的相邻采样区间。模态弹窗、最小化、失焦、系统休眠不计入。"),
        ui("采样间隔约 5 秒，超过 15 秒的断档不补记；它是使用行为记录，不能衡量专注程度或理解程度。"),
        ui("统计自 {0} 开始；旧版本的历史阅读时长没有回填。", new Date(data.settings.trackingSince).toLocaleString(dateLocale()))
      ]
    },
    characters: {
      title: ui("访问页可提取字数"),
      body: [
        ui("按当前筛选时间内访问过的文档版本与页去重，汇总这些页在本地索引中可提取的字符与分词数量。"),
        ui("这是页面文字覆盖代理，不代表逐字阅读。没有文字层、索引未完成或没有文本的页不会假设字数。"),
        ui("当前 {0} / {1} 个访问页有可用索引。字符和词是两种不同口径，不能相加。", number(data.reading.pagesWithText), number(data.reading.uniquePages))
      ]
    },
    pages: {
      title: ui("访问页与阅读文献"),
      body: [
        ui("“访问页”按文档版本＋页码在所选时间内去重；重复访问另列，不会增加独立页数。"),
        ui("同一文献的不同附件版本单独保留记录；当前文库可能已删除的来源会在统计口径中保留或标记。"),
        ui("打开过页面不代表完成阅读。文库当前总数和阅读过的文献数分开显示。")
      ]
    },
    tokens: {
      title: ui("已回传 Token"),
      body: [
        ui("只对真实发出的网络请求记录一次；共享订阅和缓存复用不创建额外的网络用量。重试会产生新的请求记录。"),
        ui("兼容接口读取 usage，Google 读取 usageMetadata，Claude 读取消息事件中的 usage，Ollama 读取 eval_count / prompt_eval_count。未返回的数据保持未知，不能视为零。"),
        ui("本期间 {0} 次有用量回传，{1} 次未回传。输入、输出、缓存命中和推理 Token 可能有包含关系，不将所有子项相加。", data.tokens.reportedAttempts, data.tokens.unknownAttempts),
        ui("文本估算只作为粗略用量参考，独立于服务端回传值。服务商费用、余额和额度目前没有账单接口，不显示虚构金额。")
      ]
    },
    sources: {
      title: ui("数据范围与来源"),
      body: [
        ui("本面板来自本机文库、阅读活动采样和模型响应，不上传使用统计。可以在设置中暂停记录或清除统计，文献和摘录不会随之删除。"),
        ui("时间范围使用当前时区，趋势按本地日期归组。文库存量是当前快照，使用活动和模型用量按时间筛选；两者不混为一个时间口径。"),
        ui("话题优先使用用户确认的分类，其余取自文献自带的标签。集合不再作为话题来源，避免把文件夹名当成研究方向。"),
        ui("旧版本没有记录的行为和服务端未回传字段标为缺失。关闭统计期间不会通过现有缓存或元数据倒推使用记录。")
      ]
    }
  }
  return (
    <Dialog title={ui(notes[kind].title)} onClose={onClose}>
      <div className="dash-definition">
        {notes[kind].body.map((v) => (
          <p key={v}>{ui(v)}</p>
        ))}
        <dl>
          <dt>{ui("当前时间范围")}</dt>
          <dd>{rangeLabel(data.range)}</dd>
          <dt>{ui("最后更新")}</dt>
          <dd>{new Date(data.generatedAt).toLocaleString(dateLocale())}</dd>
        </dl>
      </div>
    </Dialog>
  )
}

/* ---------- 个人页：本地账户条 ---------- */

/* ---------- 主面板 ---------- */

export default function Dashboard({
  onLibrary,
  onOpenDocument,
  onSettings,
  onSearchTopic
}: {
  onLibrary: () => void
  onOpenDocument: (version: string, title: string) => void
  onSettings: () => void
  onSearchTopic?: (topic: string) => void
}): React.ReactElement {
  const s = useStrings()
  const [range, setRange] = useState<AnalyticsRange>('30')
  const [panel, setPanel] = useState<Panel>(() => {
    const p = new URLSearchParams(window.location.search).get('panel')
    return p === 'reading' || p === 'research' || p === 'models' ? p : 'reading'
  })
  const [data, setData] = useState<DashboardSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [definition, setDefinition] = useState<Definition | null>(null)
  const [classification, setClassification] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [heatMode, setHeatMode] = useState<'day' | 'week'>('day')
  const mainPane = useRef<HTMLElement>(null)
  useEffect(() => { mainPane.current?.scrollTo({ top: 0 }) }, [panel])
  const fetchVersion = useRef(0)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const refresh = useCallback(async () => {
    const version = ++fetchVersion.current
    setLoading(true)
    const r = await window.jian.analytics.snapshot({ range, timezone })
    if (version !== fetchVersion.current) return
    if (r.ok) {
      setData(r.data)
      setError('')
    } else setError(r.error.message)
    setLoading(false)
  }, [range, timezone])

  useEffect(() => {
    setData(null)
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => {
      fetchVersion.current++
      clearInterval(timer)
    }
  }, [refresh])

  async function exportUsage(): Promise<void> {
    setSaving(true)
    try {
      const r = await window.jian.preferences.saveUsage()
      if (!r.ok) setError(r.error.message)
      else if (!r.data.canceled) setError(ui("使用数据已保存。"))
    } finally {
      setSaving(false)
    }
  }

  const reading = data?.reading
  const tokens = data?.tokens

  // The annual canvas masks dates outside the query; reading uses the actual date span.
  const heatWeeks = useMemo(() => panel === 'reading' ? calendarWeeks(data?.trend ?? []) : 52, [panel, data?.trend])

  const panels: Array<{ id: Panel; label: string }> = [
    { id: 'reading', label: s.dash.panel.reading },
    { id: 'research', label: s.dash.panel.research },
    { id: 'models', label: s.dash.panel.models }
  ]

  return (
    <div className="dash-workspace">
      <nav className="sidebar dash-sidebar" aria-label={ui("使用概览导航")}>
        <div className="sidebar__group-label">{s.dash.overline}</div>
        {panels.map((item) => {
          const Icon = PANEL_ICONS[item.id]
          return (
            <button
              className="sidebar__row"
              aria-current={panel === item.id ? 'page' : undefined}
              key={item.id}
              onClick={() => setPanel(item.id)}
            >
              <Icon />
              <span className="sidebar__label">{item.label}</span>
            </button>
          )
        })}

        <div className="dash-sidebar__footer">
          <button className="sidebar__row" onClick={onLibrary}>
            <IconLibrary />
            <span className="sidebar__label">{s.dash.enterLibrary}</span>
          </button>
          <button className="sidebar__row" onClick={onSettings}>
            <IconPress />
            <span className="sidebar__label">{s.dash.appearance}</span>
          </button>
          {data && (
            <p>
              {s.dash.localOnly}
              <br />
              {s.dash.since}{' '}
              {new Date(data.settings.trackingSince).toLocaleDateString(dateLocale())}
            </p>
          )}
        </div>

        {/* 原来这里是一大片空白；改为一条竖线与「笺」印记，让留白有落款 */}
        <div className="dash-sidebar__seal" aria-hidden="true">
          <span className="dash-sidebar__seal-mark">{ui("笺")}</span>
          <span className="dash-sidebar__seal-note">{ui("纸短情长 读有所归")}</span>
        </div>
      </nav>

      <main key={panel} ref={mainPane} className="dash-main" aria-busy={loading}>
        <div className="dash-heading">
          <div>
            <p className="dash-overline">{s.dash.overline}</p>
            <h1>{s.dash.title[panel]}</h1>
          </div>
          <div className="dash-heading__actions">
            <select aria-label={ui("统计时间范围")} value={range} onChange={(e) => setRange(e.target.value as AnalyticsRange)}>
              <option value="7">{s.dash.range.d7}</option>
              <option value="30">{s.dash.range.d30}</option>
              <option value="90">{s.dash.range.d90}</option>
              <option value="all">{s.dash.range.all}</option>
            </select>
            <button className="btn" onClick={() => void refresh()} disabled={loading}>
              {s.dash.refresh}
            </button>
            <button
              className="btn"
              onClick={() => void exportUsage()}
              disabled={!data || saving}
              title={ui("导出全部历史记录，不受当前时间筛选影响")}
            >
              {s.dash.exportAll}
            </button>
            
          </div>
        </div>

        <div className="dash-context">
          <span>
            {rangeLabel(range)}
          </span>
          <button className="provider-text-button" disabled={!data} onClick={() => setDefinition('sources')}>
            {s.dash.sources}<Mark name="details" size={14}/>
          </button>
          {data && !data.settings.enabled && <strong>{ui("记录已暂停")}</strong>}
        </div>

        {error && (
          <div className="dash-feedback" role="status">
            {ui(error)}
            <button aria-label={ui("关闭提示")} onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}

        {!data ? (
          <div className="dash-empty">
            <h2>{loading ? ui("正在读取本地记录…") : ui("暂时无法读取统计")}</h2>
            {!loading && (
              <button className="btn" onClick={() => void refresh()}>
                {ui("重新读取")}</button>
            )}
          </div>
        ) : (
          <>

            {panel === 'research' && <TopicCharts data={data}/>}

            {panel === 'reading' && (
              <section className="dash-metrics" aria-label={ui("阅读与用量汇总")}>
                <Metric
                  label={ui("有效阅读")}
                  value={duration(reading!.activeMs)}
                  description={ui("{0} 次会话 · 排除失焦与闲置", number(reading!.sessions))}
                  onInfo={() => setDefinition('reading')}
                />
                <Metric
                  label={ui("访问页可提取字数")}
                  value={compact(reading!.uniqueVisitedCharacters)}
                  unit={ui("字")}
                  description={ui("{0} 词 · 去重页面文字代理", compact(reading!.uniqueVisitedWords))}
                  onInfo={() => setDefinition('characters')}
                />
                <Metric
                  label={ui("访问页面")}
                  value={number(reading!.uniquePages)}
                  unit={ui("页")}
                  description={ui("{0} 个文档版本 · {1} 次页面访问", reading!.documents, reading!.pageVisits)}
                  onInfo={() => setDefinition('pages')}
                />
                <Metric label={ui("阅读文献")} value={number(reading!.documents)} unit={ui("篇")} description={ui("按文档版本计数，不代表已读完。")} onInfo={() => setDefinition('pages')} />
              </section>
            )}

            {panel === 'reading' && <ReadingCharts data={data}/>}

            {panel === 'reading' && (
              <section className="dash-section">
                <div className="dash-section__head">
                  <h2>{s.dash.heatmap}</h2>
                  <div className="dash-switch" role="group" aria-label={ui("热力图粒度")}>
                    <button aria-pressed={heatMode === 'day'} onClick={() => setHeatMode('day')}>
                      {ui("每天")}</button>
                    <button aria-pressed={heatMode === 'week'} onClick={() => setHeatMode('week')}>
                      {ui("每周")}</button>
                  </div>
                </div>
                <p className="dash-section__note">
                  {s.dash.heatmapNote} {ui("显示当前范围，最多最近 {0} 周。", heatWeeks)} {ui("范围边界日可能只含部分时长。")}</p>
                <Heatmap
                  data={data.trend}
                  weeks={heatWeeks}
                  mode={heatMode}
                  label={s.dash.heatmap}
                  less={s.dash.less}
                  more={s.dash.more}
                />
              </section>
            )}

            {panel === 'research' && (
              <section className="dash-section">
                <div className="dash-section__head">
                  <h2>{panel === 'research' ? ui("话题") : s.dash.topics}</h2>
                  <button className="btn" onClick={() => setClassification('')}>
                    {s.dash.confirmTopics}
                  </button>
                </div>
                <p className="dash-section__note">
                  {ui("话题取自文献自带的标签；已确认的分类优先于标签。集合不再作为研究方向，避免把文件夹名当成研究内容。")}{getLocale() === 'en' ? ' ' : ''}{ui("按阅读时长排列前 50 项。")}
                </p>
                <TopicList
                  rows={data.topics}
                  limit={panel === 'research' ? 50 : 5}
                  empty={s.dash.emptyTopics}
                  onPick={onSearchTopic}
                />
              </section>
            )}

            {panel === 'research' && <section className="dash-section"><div className="dash-section__head"><h2>{ui("所属领域")}</h2></div><p className="dash-section__note">{ui("仅展示用户确认的领域，不使用集合名推断；篇数为当前存量，时长按当前期间统计。")}</p>{data.fields.length ? <div className="dash-topics">{data.fields.map(row => <div className="dash-topic" key={row.id}><span className="dash-topic__name">{row.label}<span className="dash-topic__basis">　{ui("已确认")}</span></span><span className="dash-topic__count">{row.documents} {getLocale() === 'en' && row.documents === 1 ? 'document' : ui("篇")}</span><span className="dash-topic__time">{duration(row.activeMs)}</span></div>)}</div> : <p className="dash-section__note">{ui("尚未确认领域。可通过“编辑分类”填写。")}</p>}</section>}

            {panel === 'reading' && (
              <section className="dash-section">
                <div className="dash-section__head">
                  <h2>{s.dash.readingList}</h2>
                  <span>
                    {data.readingDocuments.length} {ui("个文档版本")}{data.readingDocuments.length === 100 ? ui("· 前 100 项，完整记录可导出") : ''}
                  </span>
                </div>
                {data.readingDocuments.length ? (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>{s.dash.documents}</th>
                          <th>{ui("有效阅读")}</th>
                          <th>{ui("访问页")}</th>
                          <th>{ui("可提取字数")}</th>
                          <th>{s.dash.topics}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.readingDocuments.map((row) => (
                          <tr key={row.documentVersionId}>
                            <td>
                              <button
                                className="dash-document"
                                onClick={() => onOpenDocument(row.documentVersionId, row.title)}
                              >
                                {row.title}
                              </button>
                            </td>
                            <td>{duration(row.activeMs)}</td>
                            <td>{row.uniquePages} {ui("页")}</td>
                            <td>{compact(row.uniqueVisitedCharacters)} {ui("字")}</td>
                            <td>
                              <button className="dash-classification" onClick={() => setClassification(row.itemId)}>
                                {row.topics[0] || row.field || ui("确认分类")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="dash-empty dash-empty--inline">
                    <p>{ui("从一篇文献开始。")}</p>
                    <span>{ui("阅读器会记录有效活动；升级前的阅读历史不会推算补齐。")}</span>
                    <button className="btn btn--primary" onClick={onLibrary}>
                      <span className="sidebar__label">{s.dash.enterLibrary}</span>
                    </button>
                  </div>
                )}
              </section>
            )}

            {panel === 'reading' && (
              <section className="dash-section">
                <details className="dash-data-table">
                  <summary>{s.dash.daily}</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>{ui("日期")}</th>
                        <th>{ui("有效阅读")}</th>
                        <th>{ui("访问页")}</th>
                        <th>{ui("已回传 Token")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trend
                        .filter((row) => row.activeMs > 0 || row.pageVisits > 0 || row.totalTokens > 0)
                        .slice(-60)
                        .reverse()
                        .map((row) => (
                          <tr key={row.day}>
                            <td>{row.day}</td>
                            <td>{duration(row.activeMs)}</td>
                            <td>{row.pageVisits}</td>
                            <td>{row.totalTokens > 0 ? number(row.totalTokens) : '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </details>
              </section>
            )}

            {panel === 'models' && (
              <section className="dash-section">
                <div className="dash-section__head">
                  <h2>{s.dash.panel.models}</h2>
                  <button className="provider-text-button" onClick={() => setDefinition('tokens')}>
                    {ui("用量口径")}<Mark name="details" size={14}/></button>
                </div>
                <div className="dash-usage-summary">
                  <div>
                    <span>{ui("输入 Token")}</span>
                    <strong>{tokens!.inputTokens === null ? '—' : number(tokens!.inputTokens)}</strong>
                  </div>
                  <div>
                    <span>{ui("输出 Token")}</span>
                    <strong>{tokens!.outputTokens === null ? '—' : number(tokens!.outputTokens)}</strong>
                  </div>
                  <div>
                    <span>{ui("未回传请求")}</span>
                    <strong>
                      {tokens!.unknownAttempts}
                      <small> / {tokens!.attempts} {ui("次")}</small>
                    </strong>
                  </div>
                  <div>
                    <span>{ui("账单金额")}</span>
                    <strong className="dash-unavailable">{ui("暂无账单数据")}</strong>
                  </div>
                </div>
                <ModelCharts data={data}/>
                {data.models.length ? (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>{ui("服务 / 模型")}</th>
                          <th>{ui("回传 Token")}</th>
                          <th>{ui("回传覆盖")}</th>
                          <th>{ui("成功 / 失败 / 取消")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.models.map((m) => (
                          <tr key={`${m.provider}-${m.endpointHost}-${m.model}`}>
                            <td>
                              <strong>{m.model}</strong>
                              <small>
                                {m.endpointHost} · {m.provider}
                              </small>
                            </td>
                            <td>{m.totalTokens === null ? ui("未知") : number(m.totalTokens)}</td>
                            <td>
                              {m.reportedAttempts} / {m.attempts} {ui("次")}</td>
                            <td>
                              {m.completed} / {m.failed} / {m.cancelled}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="dash-chart-empty dash-chart-empty--small">
                    {ui("尚无模型请求记录")}<span>{ui("原文阅读无需配置模型。服务端回传用量后才会显示实际 Token。")}</span>
                  </div>
                )}
                {panel === 'models' && (
                  <>
                    <div className="dash-purpose-grid">
                      {data.purposes.map((p) => (
                        <article key={p.purpose}>
                          <h3>{ui(purposeNames[p.purpose])}</h3>
                          <strong>
                            {p.totalTokens === null ? ui("未知") : number(p.totalTokens)}
                            <small> Token</small>
                          </strong>
                          <p>
                            {p.attempts} {ui("次请求 ·")}{p.unknownAttempts} {ui("次未回传")}</p>
                        </article>
                      ))}
                    </div>
                    <details className="dash-estimates">
                      <summary>{ui("查看文本估算与细分字段")}</summary>
                      <p>
                        {ui("估算输入")}{number(tokens!.estimatedInputTokens)} {ui("Token；估算输出")}{' '}
                        {number(tokens!.estimatedOutputTokens)} {ui("Token。仅依据请求/响应文字粗估，与服务端 Token 分开，不用于账单。")}</p>
                      <p>
                        {ui("服务端已回传的缓存输入")}{' '}
                        {tokens!.cachedInputTokens === null ? ui("未知") : number(tokens!.cachedInputTokens)}{ui("；推理 Token")}{' '}
                        {tokens!.reasoningTokens === null ? ui("未知") : number(tokens!.reasoningTokens)}
                        {ui("。这些字段可能包含在输入或输出中，不再次加总。")}</p>
                    </details>
                  </>
                )}
              </section>
            )}

            {panel === 'models' && (
              <>
                <section className="dash-section">
                  <div className="dash-section__head">
                    <h2>{s.dash.activity}</h2>
                    <span>{ui("按所选时间范围")}</span>
                  </div>
                  <dl className="dash-inventory">
                    {[
                      [ui("新存摘录"), data.activity.annotations, ui("条")],
                      [ui("新增评论"), data.activity.comments, ui("条")],
                      [ui("翻译完成请求"), data.activity.translations, ui("次")],
                      [ui("导入文件 / 条目"), data.activity.imports, ui("项")],
                      [ui("导出操作"), data.activity.exports, ui("次")],
                      [ui("搜索"), data.activity.searches, ui("次")],
                      [ui("缓存复用"), data.activity.cacheHits, ui("次")],
                      [ui("任务完成"), data.activity.jobsCompleted, ui("个")],
                      [ui("任务失败"), data.activity.jobsFailed, ui("个")],
                      [ui("记录的错误"), data.activity.errors, ui("次")]
                    ].map(([label, value, unit]) => (
                      <div key={String(label)}>
                        <dt>{ui(String(label))}</dt>
                        <dd>
                          {number(Number(value))}
                          <span>{getLocale() === 'en' && ui(String(unit)) !== 'MB' ? '' : ui(String(unit))}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="dash-section">
                  <div className="dash-section__head">
                    <h2>{s.dash.inventory}</h2>
                    <span>{ui("当前存量 · 不随时间范围变化")}</span>
                  </div>
                  <dl className="dash-inventory">
                    {[
                      [ui("文献"), data.library.items, ui("篇")],
                      [ui("附件"), data.library.documents, ui("个")],
                      [ui("文库附件占用"), Math.round(data.library.managedBytes / 1024 / 1024), 'MB'],
                      [ui("原文件关联"),data.library.linkedDocuments??0,ui("个")],
                      [ui("关联原件大小"),Math.round((data.library.linkedBytes??0)/1024/1024),'MB'],
                      [ui("已索引页面"), data.library.indexedPages, ui("页")],
                      [ui("已索引文档"), data.library.indexedDocuments, ui("个")],
                      [ui("待索引 / 失败"), `${data.library.pendingDocuments} / ${data.library.failedDocuments}`, ui("个")],
                      [ui("摘录"), data.library.annotations, ui("条")],
                      [ui("有评论的摘录"), data.library.comments, ui("条")],
                      [ui("笔记"), data.library.notes, ui("条")],
                      [ui("永久译文"), data.library.translations, ui("条")],
                      [ui("术语"), data.library.glossaryTerms, ui("条")],
                      [ui("翻译缓存"), data.library.cachedTranslations, ui("条")]
                    ].map(([label, value, unit]) => (
                      <div key={String(label)}>
                        <dt>{ui(String(label))}</dt>
                        <dd>
                          {typeof value === 'number' ? number(value) : value}
                          <span>{getLocale() === 'en' && ui(String(unit)) !== 'MB' ? '' : ui(String(unit))}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </>
            )}

            <footer className="dash-footnote">
              <span>{data.settings.enabled ? ui("记录已开启，仅保存在本机") : ui("记录已暂停，已有数据与文库存量仍可查看")}</span>
              <span>{ui("更新于")}{new Date(data.generatedAt).toLocaleTimeString(dateLocale())}</span>
              {data.notices.length > 0 && (
                <details>
                  <summary>{ui("查看数据覆盖说明")}</summary>
                  {data.notices.map((n) => (
                    <p key={n}>{ui(n)}</p>
                  ))}
                </details>
              )}
            </footer>
          </>
        )}
      </main>

      {definition && data && <MetricNotes kind={definition} data={data} onClose={() => setDefinition(null)} />}
      {classification !== null && (
        <ClassificationDialog
          initialItem={classification || undefined}
          onClose={() => setClassification(null)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  )
}
