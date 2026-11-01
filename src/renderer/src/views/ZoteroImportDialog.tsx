import { dateLocale } from '../i18n'
import { ui } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import Dialog from '../reader/Dialog'
import type { ZoteroDetect, ZoteroImportReport } from '../env'

interface Props {
  onClose: () => void
  onImported: () => void
}

type Phase = 'detecting' | 'ready' | 'blocked' | 'importing' | 'report' | 'error'

export default function ZoteroImportDialog({ onClose, onImported }: Props): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('detecting')
  const [detect, setDetect] = useState<ZoteroDetect | null>(null)
  const [report, setReport] = useState<ZoteroImportReport | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const runDetect = useCallback(async () => {
    setPhase('detecting')
    setMessage(null)

    // 开发自检：?zotero=report 直接展示最近一次导入结果，便于核对报告排版
    if (new URLSearchParams(window.location.search).get('zotero') === 'report') {
      const runs = await window.jian.zotero.runs()
      if (runs.ok && Array.isArray(runs.data) && runs.data.length > 0) {
        const latest = runs.data[0] as {
          id: string
          status: string
          startedAt: string
          finishedAt: string | null
          counts: ZoteroImportReport['counts'] | null
          conflicts: Array<{ itemKey: string; field: string }> | null
          error: string | null
        }
        if (latest.counts) {
          setReport({
            runId: latest.id,
            status: latest.status === 'published' ? 'published' : 'failed',
            source: { path: '', schemaVersion: null, fingerprint: '', descriptorReasons: [] },
            counts: latest.counts,
            warnings: [],
            conflicts: (latest.conflicts ?? []).map((c) => ({ ...c, title: '' })),
            durationMs: latest.finishedAt
              ? new Date(latest.finishedAt).getTime() - new Date(latest.startedAt).getTime()
              : 0
          })
          setPhase('report')
          return
        }
      }
      setMessage(ui("没有可展示的导入记录"))
      setPhase('error')
      return
    }

    const res = await window.jian.zotero.detect()
    if (!res.ok) {
      setMessage(`${res.error.code}: ${ui(res.error.message)}`)
      setPhase('error')
      return
    }
    setDetect(res.data)
    if (!res.data.exists) {
      setPhase('blocked')
      setMessage(ui("未找到 Zotero 文库"))
      return
    }
    if (res.data.running === true) {
      setPhase('blocked')
      setMessage(ui("Zotero 正在运行，请先完全退出（⌘Q）再重试"))
      return
    }
    if (res.data.running === null) {
      setPhase('blocked')
      setMessage(ui("无法确认 Zotero 是否已退出，请关闭后重试"))
      return
    }
    setPhase('ready')
  }, [])

  useEffect(() => {
    void runDetect()
  }, [runDetect])

  // 开发自检：?zotero=import 时检测通过后自动开始导入，便于截取真实报告
  const autoImport = new URLSearchParams(window.location.search).get('zotero') === 'import'
  useEffect(() => {
    if (!autoImport || phase !== 'ready') return
    void doImport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoImport, phase])

  const doImport = async (): Promise<void> => {
    setPhase('importing')
    setMessage(null)
    const res = await window.jian.zotero.import()
    if (!res.ok) {
      setMessage(`${res.error.code}: ${ui(res.error.message)}`)
      setPhase('error')
      return
    }
    setReport(res.data)
    setPhase('report')
    onImported()
  }

  return (
    <Dialog title={ui("从 Zotero 导入")} onClose={onClose} closeDisabled={phase === 'importing'} footer={<>

          {phase === 'ready' && (
            <>
              <button type="button" className="btn" onClick={onClose}>
                {ui("取消")}</button>
              <button type="button" className="btn btn--primary" onClick={() => void doImport()}>
                {ui("开始导入")}</button>
            </>
          )}
          {(phase === 'report' || phase === 'error' || phase === 'blocked') && (
            <button type="button" className="btn btn--primary" onClick={onClose}>
              {ui("完成")}</button>
          )}
          {phase === 'importing' && (
            <button type="button" className="btn" disabled>
              {ui("导入中…")}</button>
          )}
    </>}>
          {phase === 'detecting' && <p className="modal__text">{ui("正在检查 Zotero 文库…")}</p>}

          {phase === 'blocked' && (
            <>
              <p className="modal__alert">{ui(message)}</p>
              {detect && (
                <dl className="kv">
                  <dt>{ui("文库路径")}</dt>
                  <dd className="kv__mono">{detect.dbPath}</dd>
                  <dt>{ui("状态")}</dt>
                  <dd>{detect.exists ? ui("文件存在") : ui("文件缺失")}</dd>
                </dl>
              )}
              <button type="button" className="btn" onClick={() => void runDetect()}>
                {ui("重新检测")}</button>
            </>
          )}

          {phase === 'ready' && detect && (
            <>
              <p className="modal__text">
                {ui("将读取 Zotero 文库的只读快照并导入笺。")}<strong>{ui("不会修改、移动或清理你的 Zotero 文库。")}</strong>
              </p>
              <dl className="kv">
                <dt>{ui("文库路径")}</dt>
                <dd className="kv__mono">{detect.dbPath}</dd>
                <dt>{ui("主库大小")}</dt>
                <dd>{detect.byteSize ? `${(detect.byteSize / 1024 / 1024).toFixed(2)} MB` : '—'}</dd>
                <dt>{ui("Zotero 状态")}</dt>
                <dd>{ui("已退出")}</dd>
                {detect.lastRun && (
                  <>
                    <dt>{ui("上次导入")}</dt>
                    <dd>
                      {new Date(detect.lastRun.startedAt).toLocaleString(dateLocale(), {
                        hour12: false
                      })}{' '}
                      · {detect.lastRun.status}
                    </dd>
                  </>
                )}
              </dl>
              <p className="modal__note">
                {ui("重复导入不会产生重复条目：同一来源的条目按外部标识匹配，冲突时默认保留你本地的修改。")}</p>
            </>
          )}

          {phase === 'importing' && (
            <>
              <p className="modal__text">{ui("正在快照并解析 Zotero 文库…")}</p>
              <p className="modal__note">
                {ui("先复制一份只读快照，再在副本上读取；源库保持不动。文献较多时可能需要几十秒。")}</p>
            </>
          )}

          {phase === 'report' && report && (
            <>
              <p className="modal__text">
                {report.status === 'published' ? ui("导入完成") : ui("导入未完成")} {ui("· 用时")}{' '}
                {(report.durationMs / 1000).toFixed(1)} {ui("秒")}</p>
              <div className="report-grid">
                <Cell label={ui("文献")} value={report.counts.bibliographic} />
                <Cell label={ui("附件")} value={report.counts.attachments} />
                <Cell label={ui("笔记")} value={report.counts.notes} />
                <Cell label={ui("标注")} value={report.counts.annotations} />
                <Cell label={ui("集合")} value={report.counts.collections} />
                <Cell label={ui("标签")} value={report.counts.tags} />
                <Cell label={ui("新建")} value={report.counts.created} />
                <Cell label={ui("更新")} value={report.counts.updated} />
                <Cell label={ui("未变")} value={report.counts.unchanged} />
              </div>
              {report.counts.keptLocal > 0 && (
                <p className="modal__note">
                  {report.counts.keptLocal} {ui("条文献在笺里改过、Zotero 那边没变，已保留你的修改。")}</p>
              )}
              {(report.counts.missingFiles > 0 ||
                report.counts.unsupported > 0 ||
                report.counts.skippedTrash > 0 ||
                report.counts.conflicts > 0) && (
                <ul className="warn-list">
                  {report.counts.missingFiles > 0 && (
                    <li>{report.counts.missingFiles} {ui("个附件未找到，已标记为待定位")}</li>
                  )}
                  {report.counts.unsupported > 0 && (
                    <li>{report.counts.unsupported} {ui("个 CAJ 附件已复制，暂不支持阅读")}</li>
                  )}
                  {report.counts.skippedTrash > 0 && (
                    <li>{report.counts.skippedTrash} {ui("个条目在 Zotero 回收站中，已跳过")}</li>
                  )}
                  {report.counts.conflicts > 0 && (
                    <li>{report.counts.conflicts} {ui("处字段两端都改过，已保留本地值")}</li>
                  )}
                </ul>
              )}
              {report.conflicts.length > 0 && (
                <details className="conflict-details">
                  <summary>{ui("查看冲突明细")}</summary>
                  <ul>
                    {report.conflicts.slice(0, 20).map((c, i) => (
                      <li key={`${c.itemKey}-${c.field}-${i}`}>
                        {c.title || c.itemKey} · {c.field}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {report.warnings.length > 0 && (
                <details className="conflict-details">
                  <summary>{ui("查看")}{report.warnings.length} {ui("条告警")}</summary>
                  <ul>
                    {report.warnings.slice(0, 30).map((w, i) => (
                      <li key={i}>{ui(w)}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {phase === 'error' && <p className="modal__alert">{ui(message)}</p>}
    </Dialog>
  )
}

function Cell({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="report-cell">
      <span className="report-cell__value">{value}</span>
      <span className="report-cell__label">{ui(label)}</span>
    </div>
  )
}
