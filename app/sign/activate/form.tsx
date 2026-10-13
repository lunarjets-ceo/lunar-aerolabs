'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { requestActivation } from '../auth-actions'
import { FormError, SubmitButton } from '@/components/ui'

export function ActivateForm() {
  const [state, action] = useActionState(requestActivation, undefined)
  return (
    <>
      {state?.ok ? (
        <p className="form-ok">{state.ok}</p>
      ) : (
        <form action={action} className="stack">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required autoFocus />
          </label>
          <FormError error={state?.error} />
          <SubmitButton pendingText="Sending…">Email me a sign-up link</SubmitButton>
        </form>
      )}
      <p className="auth-footer">
        Already set up? <Link href="/sign/login">Sign in</Link>
      </p>
    </>
  )
}
