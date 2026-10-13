'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PdfPages } from '@/components/PdfPages'
import { DeliveryList } from '@/components/DeliveryList'
import { saveDraft, sendDocument, type ActionResult, type FieldInput } from '../../actions'

export interface Person {
  id: string
  email: string
  name: string
  status: string
}

type EditorField = FieldInput & { key: string }

const COLORS = ['#5b8def', '#e3a33b', '#4cc38a', '#d9608c', '#9b7cf0', '#3bbad4']

const FIELD_TYPES: { type: FieldInput['type']; label: string; w: number; h: number }[] = [
  { type: 'signature', label: 'Signature', w: 0.24, h: 0.055 },
  { type: 'initials', label: 'Initials', w: 0.09, h: 0.045 },
  { type: 'name', label: 'Full name', w: 0.24, h: 0.03 },
  { type: 'date', label: 'Date signed', w: 0.16, h: 0.03 },
  { type: 'text', label: 'Text', w: 0.24, h: 0.03 },
  { type: 'checkbox', label: 'Checkbox', w: 0.025, h: 0 },
]

let nextKey = 0
const newKey = () => `f${++nextKey}`

export function FieldEditor({
  documentId,
  initialTitle,
  initialMessage,
  people,
  initialRecipients,
  initialFields,
}: {
  documentId: string
  initialTitle: string
  initialMessage: string
  people: Person[]
  initialRecipients: string[]
  initialFields: FieldInput[]
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [message, setMessage] = useState(initialMessage)
  const [recipients, setRecipients] = useState<string[]>(initialRecipients)
  const [active, setActive] = useState<string | null>(initialRecipients[0] ?? null)
  const [tool, setTool] = useState<FieldInput['type']>('signature')
  const [fields, setFields] = useState<EditorField[]>(() => initialFields.map((f) => ({ ...f, key: newKey() })))
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<ActionResult>()
  const [pending, startTransition] = useTransition()
  const drag = useRef<{ key: string; mode: 'move' | 'resize'; startX: number; startY: number; orig: EditorField; rect: DOMRect } | null>(null)

  const color = (userId: string) => COLORS[recipients.indexOf(userId) % COLORS.length]
  const person = (id: string) => people.find((p) => p.id === id)
  const available = people.filter((p) => !recipients.includes(p.id))
  const selectedField = fields.find((f) => f.key === selected)

  const payload = () => ({
    title,
    message,
    recipientUserIds: recipients,
    fields: fields.map(({ key: _key, ...f }) => f),
  })

  const update = (key: string, patch: Partial<EditorField>) =>
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)))

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.startX) / d.rect.width
    const dy = (e.clientY - d.startY) / d.rect.height
    if (d.mode === 'move') {
      update(d.key, {
        x: Math.min(1 - d.orig.w, Math.max(0, d.orig.x + dx)),
        y: Math.min(1 - d.orig.h, Math.max(0, d.orig.y + dy)),
      })
    } else {
      update(d.key, {
        w: Math.min(1 - d.orig.x, Math.max(0.02, d.orig.w + dx)),
        h: Math.min(1 - d.orig.y, Math.max(0.015, d.orig.h + dy)),
      })
    }
  }

  const startDrag = (e: React.PointerEvent, f: EditorField, mode: 'move' | 'resize') => {
    e.stopPropagation()
    setSelected(f.key)
    const rect = (e.currentTarget.closest('.pdf-overlay') as HTMLElement).getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { key: f.key, mode, startX: e.clientX, startY: e.clientY, orig: f, rect }
  }

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setResult(await fn())
    })

  if (result?.deliveries && result.ok) {
    return (
      <div className="panel narrow">
        <h2>Sent for signature</h2>
        <DeliveryList deliveries={result.deliveries} />
        <button className="btn btn-primary" onClick={() => router.refresh()}>
          View status
        </button>
      </div>
    )
  }

  return (
    <div className="editor">
      <aside className="editor-sidebar">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Message to recipients
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional" />
        </label>

        <h3>Recipients</h3>
        {recipients.length === 0 && <p className="hint">Add who needs to sign.</p>}
        <ul className="recipient-list">
          {recipients.map((id) => (
            <li key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}>
              <span className="swatch" style={{ background: color(id) }} />
              <span className="grow">
                {person(id)?.name || person(id)?.email}
                <small>{person(id)?.email}</small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Remove recipient"
                onClick={(e) => {
                  e.stopPropagation()
                  setRecipients((r) => r.filter((x) => x !== id))
                  setFields((fs) => fs.filter((f) => f.recipientUserId !== id))
                  if (active === id) setActive(null)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {available.length > 0 ? (
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return
              setRecipients((r) => [...r, e.target.value])
              setActive(e.target.value)
            }}
          >
            <option value="">+ Add recipient from access list…</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ? `${p.name} — ${p.email}` : p.email}
                {p.status === 'invited' ? ' (invite pending)' : ''}
              </option>
            ))}
          </select>
        ) : null}
        <p className="hint">
          Only people on the <Link href="/sign/admin/people">access list</Link> can receive documents.
        </p>

        <h3>Fields</h3>
        <div className="tool-grid">
          {FIELD_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              className={tool === t.type ? 'active' : ''}
              onClick={() => setTool(t.type)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="hint">
          {active
            ? `Click on the document to place a ${tool} field for ${person(active)?.name || person(active)?.email}.`
            : 'Select a recipient first.'}
        </p>

        {selectedField && (
          <div className="field-inspector">
            <h3>Selected field</h3>
            <p className="hint">
              {selectedField.type} · {person(selectedField.recipientUserId)?.email}
            </p>
            {selectedField.type === 'text' && (
              <label>
                Label
                <input value={selectedField.label} onChange={(e) => update(selectedField.key, { label: e.target.value })} />
              </label>
            )}
            {!['date', 'name'].includes(selectedField.type) && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={selectedField.required}
                  onChange={(e) => update(selectedField.key, { required: e.target.checked })}
                />
                Required
              </label>
            )}
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setFields((fs) => fs.filter((f) => f.key !== selectedField.key))
                setSelected(null)
              }}
            >
              Delete field
            </button>
          </div>
        )}

        <div className="editor-actions">
          {result?.error && <p className="form-error">{result.error}</p>}
          {result?.ok && !result.deliveries && <p className="form-ok">{result.ok}</p>}
          <button className="btn" disabled={pending} onClick={() => run(() => saveDraft(documentId, payload()))}>
            Save draft
          </button>
          <button
            className="btn btn-primary"
            disabled={pending || recipients.length === 0}
            onClick={() => run(() => sendDocument(documentId, payload()))}
          >
            {pending ? 'Working…' : 'Send for signature'}
          </button>
        </div>
      </aside>

      <section className="editor-canvas" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
        <PdfPages
          url={`/sign/api/documents/${documentId}/pdf`}
          onPageClick={(page, x, y, aspect) => {
            if (!active) return
            const def = FIELD_TYPES.find((t) => t.type === tool)!
            const w = def.w
            const h = def.h || w * aspect // square checkboxes
            const field: EditorField = {
              key: newKey(),
              recipientUserId: active,
              type: tool,
              page,
              x: Math.min(1 - w, Math.max(0, x - w / 2)),
              y: Math.min(1 - h, Math.max(0, y - h / 2)),
              w,
              h,
              required: tool !== 'checkbox',
              label: '',
            }
            setFields((fs) => [...fs, field])
            setSelected(field.key)
          }}
          renderOverlay={(page) =>
            fields
              .filter((f) => f.page === page)
              .map((f) => (
                <div
                  key={f.key}
                  className={`field-box editing ${selected === f.key ? 'selected' : ''}`}
                  style={{
                    left: `${f.x * 100}%`,
                    top: `${f.y * 100}%`,
                    width: `${f.w * 100}%`,
                    height: `${f.h * 100}%`,
                    borderColor: color(f.recipientUserId),
                    background: `${color(f.recipientUserId)}33`,
                  }}
                  onPointerDown={(e) => startDrag(e, f, 'move')}
                >
                  <span className="field-label">{f.type === 'checkbox' ? '' : f.label || FIELD_TYPES.find((t) => t.type === f.type)!.label}</span>
                  <span className="resize-handle" onPointerDown={(e) => startDrag(e, f, 'resize')} />
                </div>
              ))
          }
        />
      </section>
    </div>
  )
}
