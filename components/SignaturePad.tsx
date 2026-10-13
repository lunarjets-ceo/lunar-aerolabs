'use client'

import { useEffect, useRef, useState } from 'react'

const WIDTH = 600
const HEIGHT = 200

/** Modal for adopting a signature or initials, either drawn or typed. Returns a PNG data URL. */
export function SignaturePad({
  kind,
  defaultText,
  onAdopt,
  onCancel,
}: {
  kind: 'signature' | 'initials'
  defaultText: string
  onAdopt: (dataUrl: string) => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<'type' | 'draw'>('type')
  const [text, setText] = useState(defaultText)
  const [hasInk, setHasInk] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    if (mode === 'type') {
      ctx.fillStyle = '#0b1a3c'
      let size = kind === 'initials' ? 110 : 84
      const font = (s: number) => `italic ${s}px "Snell Roundhand", "Segoe Script", "Brush Script MT", cursive`
      ctx.font = font(size)
      while (size > 20 && ctx.measureText(text).width > WIDTH - 40) ctx.font = font((size -= 4))
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillText(text, WIDTH / 2, HEIGHT / 2)
    }
    setHasInk(mode === 'type' ? text.trim().length > 0 : false)
  }, [mode, text, kind])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - rect.left) / rect.width) * WIDTH, ((e.clientY - rect.top) / rect.height) * HEIGHT] as const
  }

  const adopt = () => {
    const src = canvasRef.current!
    // Crop to the inked area so the signature fills its field.
    const ctx = src.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT)
    let minX = WIDTH, minY = HEIGHT, maxX = 0, maxY = 0
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (data[(y * WIDTH + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x)
          minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        }
      }
    }
    if (maxX <= minX) return
    const pad = 6
    const w = Math.min(WIDTH, maxX - minX + pad * 2)
    const h = Math.min(HEIGHT, maxY - minY + pad * 2)
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d')!.drawImage(src, Math.max(0, minX - pad), Math.max(0, minY - pad), w, h, 0, 0, w, h)
    onAdopt(out.toDataURL('image/png'))
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Adopt your {kind}</h2>
        <div className="tabs">
          <button type="button" className={mode === 'type' ? 'active' : ''} onClick={() => setMode('type')}>
            Type
          </button>
          <button type="button" className={mode === 'draw' ? 'active' : ''} onClick={() => setMode('draw')}>
            Draw
          </button>
        </div>
        {mode === 'type' && (
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={60} aria-label={`Type your ${kind}`} autoFocus />
        )}
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className={`signature-canvas ${mode}`}
          onPointerDown={(e) => {
            if (mode !== 'draw') return
            e.currentTarget.setPointerCapture(e.pointerId)
            drawing.current = true
            const ctx = e.currentTarget.getContext('2d')!
            const [x, y] = point(e)
            ctx.beginPath()
            ctx.moveTo(x, y)
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return
            const ctx = e.currentTarget.getContext('2d')!
            ctx.lineWidth = 3.2
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.strokeStyle = '#0b1a3c'
            const [x, y] = point(e)
            ctx.lineTo(x, y)
            ctx.stroke()
            setHasInk(true)
          }}
          onPointerUp={() => (drawing.current = false)}
        />
        {mode === 'draw' && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              canvasRef.current!.getContext('2d')!.clearRect(0, 0, WIDTH, HEIGHT)
              setHasInk(false)
            }}
          >
            Clear
          </button>
        )}
        <p className="hint">
          By selecting Adopt and Sign, I agree that this mark is the electronic representation of my {kind} for all
          purposes when I use it on documents.
        </p>
        <div className="row end">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!hasInk} onClick={adopt}>
            Adopt and Sign
          </button>
        </div>
      </div>
    </div>
  )
}
