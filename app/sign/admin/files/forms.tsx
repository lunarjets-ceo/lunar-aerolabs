'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { upload } from '@vercel/blob/client'
import { createSharedFile, sendFile, setRequiredDocuments } from './actions'
import { FormError, SubmitButton } from '@/components/ui'
import { DeliveryList } from '@/components/DeliveryList'

export function FileUploadForm() {
  const router = useRouter()
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string>()

  async function submit(fd: FormData) {
    const file = fd.get('file')
    if (!(file instanceof File) || file.size === 0) return setError('Choose a file to upload.')
    setError(undefined)
    setProgress(0)
    try {
      const safeName = file.name.replace(/[^\w.\-() ]+/g, '_').slice(-200)
      const blob = await upload(`shared-files/${crypto.randomUUID()}/${safeName}`, file, {
        access: 'private',
        handleUploadUrl: '/sign/api/files/upload',
        multipart: true,
        onUploadProgress: (p) => setProgress(p.percentage),
      })
      const result = await createSharedFile({
        pathname: blob.pathname,
        fileName: file.name,
        title: String(fd.get('title') ?? ''),
        message: String(fd.get('message') ?? ''),
      })
      if (result.error) throw new Error(result.error)
      router.push(`/sign/admin/files/${result.id}`)
    } catch (err) {
      setError((err as Error).message || 'Upload failed.')
      setProgress(null)
    }
  }

  const uploading = progress !== null
  return (
    <form action={submit} className="stack">
      <div className="row">
        <label className="grow">
          File <span className="hint">(up to 10 GB, uploaded directly to private storage)</span>
          <input name="file" type="file" required disabled={uploading} />
        </label>
        <label className="grow">
          Title <span className="hint">(optional)</span>
          <input name="title" placeholder="Defaults to the file name" disabled={uploading} />
        </label>
      </div>
      <label>
        Message to testers <span className="hint">(optional, shown in the email)</span>
        <textarea name="message" rows={3} disabled={uploading} />
      </label>
      {uploading && (
        <div>
          <progress max={100} value={progress} style={{ width: '100%' }} />
          <small className="hint">{progress.toFixed(1)}% uploaded. Keep this tab open.</small>
        </div>
      )}
      <FormError error={error} />
      <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
    </form>
  )
}

export function SendFileForm({ fileId, everyone }: { fileId: string; everyone: string }) {
  const [state, action] = useActionState(sendFile, undefined)
  const [recipients, setRecipients] = useState('')
  return (
    <form action={action} className="stack">
      <input type="hidden" name="fileId" value={fileId} />
      <label>
        Testers <span className="hint">(one per line: email, or Name &lt;email&gt;)</span>
        <textarea
          name="recipients"
          rows={5}
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder={'ada@example.com\nGrace Hopper <grace@example.com>'}
        />
      </label>
      {everyone && (
        <button type="button" className="link-button" style={{ alignSelf: 'flex-start' }} onClick={() => setRecipients(everyone)}>
          Add everyone who has signed a required document
        </button>
      )}
      <FormError error={state?.error} />
      {state?.ok && <p className="form-ok">{state.ok}</p>}
      {state?.deliveries && <DeliveryList deliveries={state.deliveries} />}
      <SubmitButton pendingText="Sending…">Email personal download links</SubmitButton>
    </form>
  )
}

export interface DocumentOption {
  id: string
  title: string
  signers: string
  required: boolean
}

export function RequiredDocumentsForm({ fileId, documents }: { fileId: string; documents: DocumentOption[] }) {
  const [state, action] = useActionState(setRequiredDocuments, undefined)
  return (
    <form action={action} className="stack">
      <input type="hidden" name="fileId" value={fileId} />
      {documents.length === 0 ? (
        <p className="muted">No documents have been sent for signature yet.</p>
      ) : (
        <ul className="recipient-list">
          {documents.map((d) => (
            <li key={d.id}>
              <label className="checkbox">
                <input type="checkbox" name="documentId" value={d.id} defaultChecked={d.required} />
                <span>
                  {d.title}
                  {d.signers && <small className="hint"> · signed by {d.signers}</small>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <FormError error={state?.error} />
      {state?.ok && <p className="form-ok">{state.ok}</p>}
      <SubmitButton pendingText="Saving…">Save required documents</SubmitButton>
    </form>
  )
}
