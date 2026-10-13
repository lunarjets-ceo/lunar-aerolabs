'use client'

import { useActionState } from 'react'
import { uploadDocument } from './actions'
import { FormError, SubmitButton } from '@/components/ui'

export function UploadForm() {
  const [state, action] = useActionState(uploadDocument, undefined)
  return (
    <form action={action} className="stack">
      <div className="row">
        <label className="grow">
          PDF file <span className="hint">(max 4 MB)</span>
          <input name="file" type="file" accept="application/pdf,.pdf" required />
        </label>
        <label className="grow">
          Title <span className="hint">(optional)</span>
          <input name="title" placeholder="Defaults to the file name" />
        </label>
      </div>
      <FormError error={state?.error} />
      <SubmitButton pendingText="Uploading…">Upload & place fields</SubmitButton>
    </form>
  )
}
