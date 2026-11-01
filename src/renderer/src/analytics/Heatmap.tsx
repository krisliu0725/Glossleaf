import { dateLocale, useLocale, ui } from '../i18n'
import { useMemo } from 'react'
import { buildCalendar } from './calendar'

interface Props {
  /** 逐日数据，day 为本地日期 YYYY-MM-DD */
  data: Array<{ day: string; activeMs: number }>
  /** 显示最近多少周 */
  weeks: number
  /** 每天：7 行日历格；每周：单行周合计 */
  mode: 'day' | 'week'
  label: string
  less: string
  more: string
}

const CELL = 11
const GAP = 3
const STEP = CELL + GAP
const WEEKDAY_LABELS = ['一', '三', '五', '日']

/**
 * 连续周列热力图：一列一周、一行一日，月份标在底部。
 * 参考常见代码托管平台的活动图：小格、低饱和空值、单色由浅到深，尽量不抢正文。
 */
export default function Heatmap({ data, weeks, mode, label, less, more }: Props): React.ReactElement {
  const [locale] = useLocale()
  const { columns, monthLabels, max, total } = useMemo(() => {
    const today = data.at(-1)?.day ?? new Date().toLocaleDateString('en-CA')
    const result = buildCalendar(data, weeks, today)
    const labels: Array<{x:number;text:string}> = []
    let month = ''
    result.columns.forEach((column,c) => {
      const current = column.days[0].day.slice(0,7)
      if (current !== month) { month = current; labels.push({x:c*STEP,text:new Intl.DateTimeFormat(dateLocale(),{month:'short',timeZone:'UTC'}).format(new Date(current+'-01T12:00:00Z'))}) }
    })
    return {...result, monthLabels:labels}
  }, [data, weeks, locale])

  const rows = mode === 'day' ? 7 : 1
  const gridWidth = weeks * STEP - GAP

  const level = (ms: number): number => {
    if (ms <= 0) return 0
    if (max <= 0) return 1
    return Math.min(4, Math.max(1, Math.ceil((ms / max) * 4)))
  }

  const weekMax = Math.max(1, ...columns.map((c) => c.total))
  const weekLevel = (ms: number): number => {
    if (ms <= 0) return 0
    return Math.min(4, Math.max(1, Math.ceil((ms / weekMax) * 4)))
  }

  return (
    <div className="heatmap">
      <div className="heatmap__frame">
        <div className="heatmap__axis" aria-hidden="true">
          {WEEKDAY_LABELS.map((w, i) => (
            <span key={w} style={{ top: mode === 'day' ? i * 2 * STEP : 0 }}>
              {ui(w)}
            </span>
          ))}
        </div>

        <div
          className="heatmap__plot"
          role="img"
          aria-label={ui("{0}：近 {1} 周画布，图中累计 {2} 分钟有效阅读", label, weeks, Math.round(total / 60000))}
        >
          <div
            className="heatmap__grid"
            style={{
              gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`,
              gridTemplateRows: `repeat(${rows}, ${mode === 'week' ? 30 : CELL}px)`
            }}
          >
            {mode === 'day'
              ? columns.map((column, c) =>
                  column.days.map((cell, r) => (
                    <span
                      key={cell.day}
                      className={`heatmap__cell heatmap__cell--l${cell.state === 'recorded' ? level(cell.ms) : 0}`}
                      data-empty={cell.state === 'recorded' ? undefined : '1'}
                      data-state={cell.state}
                      style={{ gridColumn: c + 1, gridRow: r + 1 }}
                      title={`${cell.day}：${cell.state === 'future' ? ui("未来日期") : cell.state === 'outside' ? ui("不在当前统计范围内") : cell.ms > 0 ? ui("{0} 分钟", Math.round(cell.ms / 60000)) : ui("范围内无活动记录")}`}
                    />
                  ))
                )
              : columns.map((column, c) => (
                  <span
                    key={`w-${c}`}
                    className={`heatmap__cell heatmap__cell--l${weekLevel(column.total)}`}
                    data-empty={column.days.every(d => d.state !== 'recorded') ? '1' : undefined}
                    style={{ gridColumn: c + 1, gridRow: 1, height: 30 }}
                    title={ui("{0} 起一周：{1}", column.days[0].day, column.days.every(d => d.state !== 'recorded') ? ui('不在当前统计范围内') : ui('{0} 分钟（仅统计范围内日期）', Math.round(column.total / 60000)))}
                  />
                ))}
          </div>

          <div className="heatmap__months" style={{ width: gridWidth }}>
            {monthLabels.map((m) => (
              <span key={`${m.text}-${m.x}`} style={{ left: m.x }}>
                {m.text}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="heatmap__legend" aria-hidden="true">
        <span>{less}</span>
        {[0, 1, 2, 3, 4].map((lv) => (
          <i key={lv} className={`heatmap__swatch heatmap__cell--l${lv}`} />
        ))}
        <span>{more}</span>
      </div>
    </div>
  )
}
