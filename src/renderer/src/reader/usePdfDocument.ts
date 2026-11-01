import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getPdfjs } from '../lib/pdf'

/** 加载一份 PDF 文档；URL 变化时销毁旧文档，避免 worker 侧泄漏。 */
export function usePdfDocument(url: string | null): {
  doc: PDFDocumentProxy | null
  error: string | null
  loading: boolean
} {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!url) {
      setDoc(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setDoc(null)

    const task = getPdfjs().getDocument({ url, cMapUrl: new URL('./pdfjs/cmaps/', document.baseURI).href, cMapPacked: true, standardFontDataUrl: new URL('./pdfjs/standard_fonts/', document.baseURI).href, wasmUrl: new URL('./pdfjs/wasm/', document.baseURI).href })
    task.promise
      .then((d) => {
        if (cancelled) {
          void task.destroy()
          return
        }
        setDoc(d)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [url])

  return { doc, error, loading }
}
