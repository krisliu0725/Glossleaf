import { ui } from '../i18n'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let configured = false

/**
 * PDF.js 单例配置。
 * worker 走 Vite 的 ?url 资源，保证打包后离线可用（DESIGN.md §17.2 第二问）。
 */
export function getPdfjs(): typeof pdfjsLib {
  if (!configured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
    configured = true
  }
  return pdfjsLib
}

export interface RenderOptions {
  scale: number
  maxDpr: number
}

/** 把一个页面渲染到给定 canvas，正确处理 DPR（§12.2 的 C → D 变换） */
export async function renderPageToCanvas(
  canvas: HTMLCanvasElement,
  sourceUrl: string,
  pageNumber: number,
  { scale, maxDpr }: RenderOptions
): Promise<{ width: number; height: number; pageCount: number }> {
  const pdfjs = getPdfjs()
  const task = pdfjs.getDocument({ url: sourceUrl })
  const doc = await task.promise
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })

  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
  const cssWidth = Math.floor(viewport.width)
  const cssHeight = Math.floor(viewport.height)

  canvas.width = Math.floor(cssWidth * dpr)
  canvas.height = Math.floor(cssHeight * dpr)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(ui("无法获取 2D 上下文"))

  await page.render({
    canvasContext: ctx,
    viewport,
    // 只在这里使用一次设备倍率，CSS 尺寸保持缩放后的 viewport 值
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]
  } as Parameters<typeof page.render>[0]).promise

  const pageCount = doc.numPages
  // 释放文档与 worker 侧的缓存，避免每翻一页泄漏一份文档
  await task.destroy()
  return { width: cssWidth, height: cssHeight, pageCount }
}
