import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { registerDocument } from '../protocol'
import type { PdfSample } from '../../shared/types'

/**
 * M0 探针：从 ~/Zotero/storage 里找一个真实 PDF，登记为文档 token，
 * 供渲染层验证 PDF.js 的 worker、字体、CMap 与页面渲染能否离线跑通。
 *
 * 只读目录列表 + 只读文件；不复制、不移动、不写入用户 Zotero 目录。
 */
export async function findSamplePdf(): Promise<PdfSample | null> {
  const storage = join(homedir(), 'Zotero', 'storage')

  let dirs: string[]
  try {
    dirs = await fs.readdir(storage)
  } catch {
    return null
  }

  // 取体积适中、最可能是正文的那一份：按目录名排序保证可复现
  const candidates: Array<{ path: string; size: number; name: string }> = []
  for (const dir of dirs.sort()) {
    const abs = join(storage, dir)
    let entries: string[]
    try {
      entries = await fs.readdir(abs)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.pdf')) continue
      try {
        const st = await fs.stat(join(abs, name))
        if (st.isFile()) candidates.push({ path: join(abs, name), size: st.size, name })
      } catch {
        /* ignore */
      }
    }
  }

  if (candidates.length === 0) return null

  // 优先 200KB–8MB 的样本，太小的可能是封面，太大的首屏慢
  candidates.sort((a, b) => {
    const score = (s: number) => (s >= 200_000 && s <= 8_000_000 ? 0 : 1)
    return score(a.size) - score(b.size) || a.size - b.size
  })

  const picked = candidates[0]
  return {
    token: registerDocument(picked.path),
    displayName: picked.name,
    byteSize: picked.size
  }
}
