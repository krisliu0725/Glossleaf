import { ui } from '../i18n'
import type { ProbeReport } from '@shared/types'

interface Props {
  report: ProbeReport | null
  error: string | null
}

interface Check {
  name: string
  ok: boolean | null
  detail: string
}

function buildChecks(report: ProbeReport): Check[] {
  const s = report.sqlite
  const z = s.zotero
  const mtimeStable =
    z.sourceMtimeBefore !== undefined &&
    z.sourceMtimeAfter !== undefined &&
    z.sourceMtimeBefore === z.sourceMtimeAfter

  return [
    {
      name: ui("node:sqlite 可加载"),
      ok: s.module.available,
      detail: s.module.available
        ? `exports: ${(s.module.exports ?? []).join(', ')}`
        : (s.module.error ?? ui("模块不可用"))
    },
    {
      name: ui("SQLite 版本"),
      ok: s.sqliteVersion !== null,
      detail: s.sqliteVersion ?? ui("未取到")
    },
    {
      name: ui("FTS5 编译可用"),
      ok: s.fts5.available,
      detail: s.fts5.available ? ui("CREATE VIRTUAL TABLE ... USING fts5 成功") : (s.fts5.error ?? ui("失败"))
    },
    {
      name: ui("FTS5 trigram 中文检索"),
      ok: s.trigram.available && (s.trigram.cases ?? []).some((c) => c.chars >= 3 && c.hit),
      detail: s.trigram.available
        ? (s.trigram.cases ?? [])
            .map((c) => ui("{0}字「{1}」{2}", c.chars, c.query, c.hit ? '命中' : c.error ? '报错' : '未命中'))
            .join(' · ')
        : (s.trigram.error ?? ui("失败"))
    },
    {
      name: ui("porter unicode61（拉丁词干）"),
      ok: s.porter.available,
      detail: s.porter.available ? ui("可用") : (s.porter.error ?? ui("失败"))
    },
    {
      name: ui("backup() 一致备份"),
      ok: s.backup.available && s.backup.worked === true,
      detail: s.backup.available
        ? ui("API 存在；实际备份：{0}", s.backup.worked ? '成功' : (s.backup.error ?? '未完成'))
        : ui("node:sqlite 未暴露 backup()")
    },
    {
      name: ui("Zotero 源库只读探测"),
      ok: z.exists && z.copied && z.items !== undefined,
      detail: z.exists
        ? ui("副本读取 {0} 个 items{1}", z.items ?? '—', z.error ? `；错误：${z.error}` : '')
        : ui("未找到 {0}", z.sourcePath)
    },
    {
      name: ui("源库 mtime 未被改动"),
      ok: mtimeStable,
      detail: mtimeStable
        ? `${z.sourceMtimeBefore} → ${z.sourceMtimeAfter}`
        : `${z.sourceMtimeBefore ?? '—'} → ${z.sourceMtimeAfter ?? '—'}`
    },
    {
      name: ui("样本 PDF 已登记"),
      ok: report.pdfSample !== null,
      detail: report.pdfSample
        ? `${report.pdfSample.displayName} · ${(report.pdfSample.byteSize / 1024).toFixed(0)} KB`
        : ui("未在 ~/Zotero/storage 找到 PDF")
    }
  ]
}

export default function ProbeView({ report, error }: Props): React.ReactElement {
  if (error) {
    return (
      <div className="probe">
        <div className="probe__inner">
          <h1 className="probe__title">{ui("探针调用失败")}</h1>
          <p className="probe__lead">{ui(error)}</p>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="probe">
        <div className="probe__inner">
          <h1 className="probe__title">{ui("正在运行 M0 探针…")}</h1>
          <p className="probe__lead">
            {ui("验证 Electron 运行时实际提供的 SQLite 能力、FTS5 分词器与一致备份接口。")}</p>
        </div>
      </div>
    )
  }

  const checks = buildChecks(report)
  const failed = checks.filter((c) => c.ok === false).length

  return (
    <div className="probe">
      <div className="probe__inner">
        <h1 className="probe__title">
          {failed === 0 ? ui("全部探针通过") : ui("{0} 项需要处理", failed)}
        </h1>
        <p className="probe__lead">
          Electron {report.sqlite.electron} · Node {report.sqlite.node} · Chromium{' '}
          {report.sqlite.chrome} {ui("· 用时")}{report.sqlite.durationMs} ms
        </p>

        {checks.map((c) => (
          <div className="check" key={c.name}>
            <span
              className={`check__mark ${c.ok ? 'check__mark--ok' : c.ok === false ? 'check__mark--fail' : ''}`}
              aria-hidden="true"
            >
              {c.ok ? '✓' : c.ok === false ? '✗' : '·'}
            </span>
            <span className="check__name">{c.name}</span>
            <span className="check__detail">{c.detail}</span>
          </div>
        ))}

        {report.sqlite.zotero.byType && (
          <>
            <div className="check" style={{ borderTop: 'none' }}>
              <span className="check__mark" aria-hidden="true">
                {' '}
              </span>
              <span className="check__name">{ui("条目类型分布")}</span>
              <span className="check__detail">
                {Object.entries(report.sqlite.zotero.byType)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
