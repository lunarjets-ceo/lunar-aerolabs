'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { requestPasswordReset } from '../auth-actions'
import { FormError, SubmitButton } from '@/components/ui'

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, undefined)
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
          <SubmitButton pendingText="Sending…">Email me a reset link</SubmitButton>
        </form>
      )}
      <p className="auth-footer">
        Remembered it? <Link href="/sign/login">Sign in</Link>
      </p>
    </>
  )
}
