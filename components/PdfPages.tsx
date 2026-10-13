'use client'

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * Renders every page of a PDF stacked vertically. Each page gets an overlay
 * (positioned over the page, sized 100%×100%) so callers can place fields
 * using fractional coordinates.
 */
export function PdfPages({
  url,
  renderOverlay,
  onPageClick,
}: {
  url: string
  renderOverlay: (page: number) => React.ReactNode
  onPageClick?: (page: number, x: number, y: number, aspect: number) => void
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: { destroy: () => Promise<void> } | null = null
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const loadingTask = pdfjs.getDocument({ url, withCredentials: true })
        task = loadingTask
        const loaded = await loadingTask.promise
        const s = []
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 })
          s.push({ w: vp.width, h: vp.height })
        }
        if (!cancelled) {
          setSizes(s)
          setDoc(loaded)
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) setError('Could not load the document.')
      }
    })()
    return () => {
      cancelled = true
      task?.destroy()
    }
  }, [url])

  if (error) return <p className="form-error">{error}</p>
  if (!doc) return <p className="muted pdf-loading">Loading document…</p>

  return (
    <div className="pdf-pages">
      {sizes.map((size, i) => (
        <div key={i} className="pdf-page-wrap">
          <div className="pdf-page-label">
            Page {i + 1} of {sizes.length}
          </div>
          <div
            className="pdf-page"
            style={{ aspectRatio: `${size.w} / ${size.h}` }}
            onPointerDown={(e) => {
              if (!onPageClick || e.target !== e.currentTarget.querySelector('.pdf-overlay')) return
              const rect = e.currentTarget.getBoundingClientRect()
              onPageClick(i + 1, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, size.w / size.h)
            }}
          >
            <PageCanvas doc={doc} pageNumber={i + 1} />
            <div className="pdf-overlay">{renderOverlay(i + 1)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function PageCanvas({ doc, pageNumber }: { doc: PDFDocumentProxy; pageNumber: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    let lastWidth = 0

    const render = async () => {
      const cssWidth = canvas.parentElement!.clientWidth
      if (!cssWidth || Math.abs(cssWidth - lastWidth) < 2) return
      lastWidth = cssWidth
      const page = await doc.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2) })
      canvas.width = viewport.width
      canvas.height = viewport.height
      task?.cancel()
      task = page.render({ canvas, viewport })
      await task.promise.catch(() => {})
    }

    render()
    const observer = new ResizeObserver(() => render())
    observer.observe(canvas.parentElement!)
    return () => {
      observer.disconnect()
      task?.cancel()
    }
  }, [doc, pageNumber])

  return <canvas ref={ref} className="pdf-canvas" />
}
