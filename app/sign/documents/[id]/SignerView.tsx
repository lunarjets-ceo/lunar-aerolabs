'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PdfPages } from '@/components/PdfPages'
import { SignaturePad } from '@/components/SignaturePad'
import { declineDocument, submitSignature } from '../actions'

export interface SignerField {
  id: string
  type: 'signature' | 'initials' | 'text' | 'date' | 'name' | 'checkbox'
  page: number
  x: number
  y: number
  w: number
  h: number
  required: boolean
  label: string
}

export function SignerView({
  documentId,
  fields,
  signerName,
}: {
  documentId: string
  fields: SignerField[]
  signerName: string
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({})
  const [adopted, setAdopted] = useState<{ signature?: string; initials?: string }>({})
  const [padFor, setPadFor] = useState<SignerField | null>(null)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const initials = signerName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('')

  const isDone = (f: SignerField) => f.type === 'date' || f.type === 'name' || Boolean(values[f.id])
  const remaining = fields.filter((f) => f.required && !isDone(f)).length

  const set = (id: string, v: string) => setValues((s) => ({ ...s, [id]: v }))

  const activate = (f: SignerField) => {
    if (f.type === 'signature' || f.type === 'initials') {
      const existing = adopted[f.type]
      if (existing && !values[f.id]) set(f.id, existing)
      else setPadFor(f)
    } else if (f.type === 'checkbox') {
      set(f.id, values[f.id] === 'true' ? '' : 'true')
    }
  }

  const goToNext = () => {
    const next = fields.find((f) => f.required && !isDone(f))
    document.getElementById(`field-${next?.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const submit = () =>
    startTransition(async () => {
      setError(null)
      const res = await submitSignature(documentId, values, consent)
      if (res?.error) setError(res.error)
      else router.refresh()
    })

  return (
    <>
      <div className="signer-bar">
        <span>
          {remaining > 0 ? `${remaining} required field${remaining === 1 ? '' : 's'} remaining` : 'All required fields complete'}
        </span>
        {remaining > 0 && (
          <button className="btn" onClick={goToNext}>
            Next field
          </button>
        )}
        <button className="link-button" onClick={() => setDeclining(true)}>
          Decline to sign
        </button>
      </div>

      <div className="signer-doc">
        <PdfPages
          url={`/sign/api/documents/${documentId}/pdf`}
          renderOverlay={(page) =>
            fields
              .filter((f) => f.page === page)
              .map((f) => (
                <div
                  key={f.id}
                  id={`field-${f.id}`}
                  className={`field-box signing ${isDone(f) ? 'done' : ''} ${f.required ? 'required' : ''} type-${f.type}`}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                  onClick={() => activate(f)}
                  title={f.label || f.type}
                >
                  {(f.type === 'signature' || f.type === 'initials') &&
                    (values[f.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={values[f.id]} alt={f.type} />
                    ) : (
                      <span className="field-label">{f.type === 'signature' ? 'Sign' : 'Initial'}</span>
                    ))}
                  {f.type === 'checkbox' && values[f.id] === 'true' && <span className="check">✕</span>}
                  {f.type === 'date' && <span className="auto-value">{today}</span>}
                  {f.type === 'name' && <span className="auto-value">{signerName}</span>}
                  {f.type === 'text' && (
                    <input
                      value={values[f.id] ?? ''}
                      placeholder={f.label || 'Enter text'}
                      maxLength={500}
                      onChange={(e) => set(f.id, e.target.value)}
                    />
                  )}
                </div>
              ))
          }
        />
      </div>

      <div className="finish-panel">
        <label className="checkbox">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I agree to use electronic records and signatures, and I intend my electronic signature to be legally binding
            on this document.
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={pending || remaining > 0 || !consent} onClick={submit}>
          {pending ? 'Submitting…' : 'Finish'}
        </button>
      </div>

      {padFor && (
        <SignaturePad
          kind={padFor.type as 'signature' | 'initials'}
          defaultText={padFor.type === 'initials' ? initials : signerName}
          onCancel={() => setPadFor(null)}
          onAdopt={(dataUrl) => {
            setAdopted((a) => ({ ...a, [padFor.type]: dataUrl }))
            set(padFor.id, dataUrl)
            setPadFor(null)
          }}
        />
      )}

      {declining && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Decline to sign</h2>
            <p className="muted">Lunar AeroLabs will be notified. You won't be able to sign this document afterwards.</p>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
            <div className="row end">
              <button className="btn" onClick={() => setDeclining(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await declineDocument(documentId, reason)
                    if (res?.error) setError(res.error)
                    setDeclining(false)
                    router.refresh()
                  })
                }
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
