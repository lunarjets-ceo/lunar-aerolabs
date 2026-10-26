'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { upload } from '@vercel/blob/client'
import { uploadErrorMessage } from '@/lib/upload-errors'
import { createRelease, createRepo, deleteRelease, deleteRepo, setRepoDocuments, setRepoMembers, updateRepo } from './actions'
import type { ActionResult } from '../actions'
import { FormError, SubmitButton } from '@/components/ui'
import { DeliveryList } from '@/components/DeliveryList'

function Result({ state }: { state: ActionResult }) {
  return (
    <>
      <FormError error={state?.error} />
      {state?.ok && <p className="form-ok">{state.ok}</p>}
      {state?.deliveries && state.deliveries.length > 0 && <DeliveryList deliveries={state.deliveries} />}
    </>
  )
}

export function CreateRepoForm() {
  const [state, action] = useActionState(createRepo, undefined)
  return (
    <form action={action} className="stack">
      <div className="row">
        <label className="grow">
          Name
          <input name="name" required placeholder="LAGF800 Flight Software" />
        </label>
        <label className="grow">
          URL name <span className="hint">(optional, defaults to the name)</span>
          <input name="slug" placeholder="lagf800-flight-software" />
        </label>
      </div>
      <label>
        Short description <span className="hint">(optional)</span>
        <input name="description" />
      </label>
      <Result state={state} />
      <SubmitButton pendingText="Creating…">Create repository</SubmitButton>
    </form>
  )
}

export function EditRepoForm({ repo }: { repo: { id: string; name: string; description: string; readme: string } }) {
  const [state, action] = useActionState(updateRepo, undefined)
  return (
    <form action={action} className="stack">
      <input type="hidden" name="repoId" value={repo.id} />
      <div className="row">
        <label className="grow">
          Name
          <input name="name" required defaultValue={repo.name} />
        </label>
        <label className="grow">
          Short description
          <input name="description" defaultValue={repo.description} />
        </label>
      </div>
      <label>
        README <span className="hint">(Markdown, shown on the repository page: install steps, known issues, contacts)</span>
        <textarea name="readme" rows={8} defaultValue={repo.readme} />
      </label>
      <Result state={state} />
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  )
}

export interface CheckOption {
  id: string
  label: string
  detail: string
  checked: boolean
}

function ChecklistForm({
  repoId,
  name,
  options,
  empty,
  submit,
  serverAction,
}: {
  repoId: string
  name: string
  options: CheckOption[]
  empty: string
  submit: string
  serverAction: (state: ActionResult, fd: FormData) => Promise<ActionResult>
}) {
  const [state, action] = useActionState(serverAction, undefined)
  return (
    <form action={action} className="stack">
      <input type="hidden" name="repoId" value={repoId} />
      {options.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="recipient-list">
          {options.map((o) => (
            <li key={o.id}>
              <label className="checkbox">
                <input type="checkbox" name={name} value={o.id} defaultChecked={o.checked} />
                <span>
                  {o.label}
                  {o.detail && <small className="hint"> · {o.detail}</small>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Result state={state} />
      <SubmitButton pendingText="Saving…">{submit}</SubmitButton>
    </form>
  )
}

export function MembersForm({ repoId, people }: { repoId: string; people: CheckOption[] }) {
  return (
    <ChecklistForm
      repoId={repoId}
      name="userId"
      options={people}
      empty="Nobody is on the access list yet. Add people under Access list first."
      submit="Save members"
      serverAction={setRepoMembers}
    />
  )
}

export function RepoDocumentsForm({ repoId, documents }: { repoId: string; documents: CheckOption[] }) {
  return (
    <ChecklistForm
      repoId={repoId}
      name="documentId"
      options={documents}
      empty="No documents have been sent for signature yet."
      submit="Save required documents"
      serverAction={setRepoDocuments}
    />
  )
}

export function PublishReleaseForm({ repoId, suggestedTag }: { repoId: string; suggestedTag: string }) {
  const router = useRouter()
  const [progress, setProgress] = useState<number | null>(null)
  const [state, setState] = useState<ActionResult>()

  async function submit(fd: FormData) {
    const file = fd.get('file')
    if (!(file instanceof File) || file.size === 0) return setState({ error: 'Choose the build file to upload.' })
    if (!String(fd.get('tag') ?? '').trim()) return setState({ error: 'Enter a version, e.g. v0.3.0.' })
    setState(undefined)
    setProgress(0)
    try {
      const safeName = file.name.replace(/[^\w.\-() ]+/g, '_').slice(-200)
      const blob = await upload(`releases/${crypto.randomUUID()}/${safeName}`, file, {
        access: 'private',
        handleUploadUrl: '/sign/api/files/upload',
        multipart: true,
        onUploadProgress: (p) => setProgress(p.percentage),
      })
      const result = await createRelease({
        repoId,
        pathname: blob.pathname,
        fileName: file.name,
        tag: String(fd.get('tag')),
        title: String(fd.get('title') ?? ''),
        notes: String(fd.get('notes') ?? ''),
        notify: fd.get('notify') === 'on',
      })
      setState(result)
      if (!result.error) router.refresh()
    } catch (err) {
      setState({ error: uploadErrorMessage(err) })
    }
    setProgress(null)
  }

  const uploading = progress !== null
  return (
    <form action={submit} className="stack">
      <div className="row">
        <label className="grow">
          Version
          <input name="tag" required placeholder={suggestedTag} disabled={uploading} />
        </label>
        <label className="grow">
          Title <span className="hint">(optional)</span>
          <input name="title" placeholder="Stability fixes" disabled={uploading} />
        </label>
      </div>
      <label>
        Build file <span className="hint">(up to 10 GB, uploaded directly to private storage)</span>
        <input name="file" type="file" required disabled={uploading} />
      </label>
      <label>
        Release notes <span className="hint">(Markdown: what changed, what to test, how to update)</span>
        <textarea name="notes" rows={6} disabled={uploading} />
      </label>
      <label className="checkbox">
        <input type="checkbox" name="notify" defaultChecked disabled={uploading} />
        <span>Email members who can download</span>
      </label>
      {uploading && (
        <div>
          <progress max={100} value={progress} style={{ width: '100%' }} />
          <small className="hint">{progress.toFixed(1)}% uploaded. Keep this tab open.</small>
        </div>
      )}
      <Result state={state} />
      <SubmitButton pendingText="Publishing…">Publish release</SubmitButton>
    </form>
  )
}

/** Two clicks: the first only asks, so a stray click can't delete anything. */
function ConfirmDeleteForm({
  field,
  value,
  label,
  serverAction,
}: {
  field: string
  value: string
  label: string
  serverAction: (state: ActionResult, fd: FormData) => Promise<ActionResult>
}) {
  const [state, action] = useActionState(serverAction, undefined)
  const [confirming, setConfirming] = useState(false)
  return (
    <form action={action} className="stack">
      <input type="hidden" name={field} value={value} />
      {confirming ? (
        <div className="row">
          <SubmitButton className="btn btn-danger btn-small" pendingText="Deleting…">
            Delete permanently
          </SubmitButton>
          <button type="button" className="btn btn-small" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-danger btn-small" onClick={() => setConfirming(true)}>
          {label}
        </button>
      )}
      <FormError error={state?.error} />
    </form>
  )
}

export function DeleteReleaseForm({ releaseId }: { releaseId: string }) {
  return <ConfirmDeleteForm field="releaseId" value={releaseId} label="Delete" serverAction={deleteRelease} />
}

export function DeleteRepoForm({ repoId }: { repoId: string }) {
  return <ConfirmDeleteForm field="repoId" value={repoId} label="Delete repository" serverAction={deleteRepo} />
}
