import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { extname, resolve, sep } from 'node:path'

/**
 * 文档访问协议：jian://doc/<token>
 *
 * 设计约束（DESIGN.md §15.1）：
 * - URL 里不出现真实路径，只有一次性的 token
 * - 只返回已登记的具体文件，不接受任意路径
 * - 支持 Range 的三种形式：单范围、开放结尾、后缀
 */

const tokens = new Map<string, { absPath: string; contentType: string;identity?:{byteSize:number;modifiedAt:number} }>()

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

export function registerDocument(absPath: string,identity?:{byteSize:number;modifiedAt:number}): string {
  const token = randomUUID().replace(/-/g, '')
  tokens.set(token, {
    absPath: resolve(absPath),identity,
    contentType: MIME[extname(absPath).toLowerCase()] ?? 'application/octet-stream'
  })
  return token
}

/** 必须在 app.whenReady() 之前调用 */
export function registerDocumentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'jian',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: false
      }
    }
  ])
}

interface ParsedRange {
  start: number
  end: number
}

/**
 * 解析 Range 头。返回 null 表示「按 200 返回整个文件」，
 * 返回 'invalid' 表示语法不合法（应回 416）。
 */
export function parseRange(
  header: string | null,
  size: number
): ParsedRange | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return 'invalid'
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return 'invalid'

  // 后缀形式：bytes=-500 表示最后 500 字节
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid'
    if (size === 0) return 'invalid'
    const start = Math.max(0, size - suffix)
    return { start, end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return 'invalid'
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return 'invalid'
  return { start, end }
}

function nodeStreamToWeb(stream: Readable): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream
}

export function handleDocumentProtocol(): void {
  protocol.handle('jian', async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    if (url.hostname !== 'doc') {
      return new Response('Not Found', { status: 404 })
    }

    const token = url.pathname.replace(/^\//, '')
    const entry = tokens.get(token)
    if (!entry) {
      return new Response('Not Found', { status: 404 })
    }

    // 纵深防御：登记的路径必须落在用户数据目录或本次会话显式登记的根之内。
    // M0 阶段 token 只由主进程登记，渲染层无法构造，故这里做一次规范化校验即可。
    if (entry.absPath.split(sep).includes('..')) {
      return new Response('Forbidden', { status: 403 })
    }

    let stat
    try {
      stat = await fs.stat(entry.absPath)
    } catch {
      return new Response('Not Found', { status: 404 })
    }
    if (!stat.isFile()) {
      return new Response('Not Found', { status: 404 })
    }

    if(entry.identity&&(stat.size!==entry.identity.byteSize||stat.mtimeMs!==entry.identity.modifiedAt))return new Response('Linked file changed; reopen or relink the original',{status:409})
    const size = stat.size
    const baseHeaders: Record<string, string> = {
      'Content-Type': entry.contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(size) }
      })
    }

    const range = parseRange(request.headers.get('Range'), size)
    if (range === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` }
      })
    }

    if (range) {
      const stream = createReadStream(entry.absPath, {
        start: range.start,
        end: range.end
      })
      return new Response(nodeStreamToWeb(stream), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Content-Length': String(range.end - range.start + 1)
        }
      })
    }

    return new Response(nodeStreamToWeb(createReadStream(entry.absPath)), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(size) }
    })
  })
}

export function revokeDocument(token: string): void { tokens.delete(token) }

/** 应用退出前清理，避免 token 泄漏到下一次会话 */
export function clearDocumentTokens(): void {
  tokens.clear()
}

export function appVersion(): string {
  return app.getVersion()
}
