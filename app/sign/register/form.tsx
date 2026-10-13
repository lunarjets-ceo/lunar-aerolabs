'use client'

import { useActionState } from 'react'
import { acceptInvite } from '../auth-actions'
import { FormError, SubmitButton } from '@/components/ui'

export function RegisterForm({ token, defaultName, email }: { token: string; defaultName: string; email: string }) {
  const [state, action] = useActionState(acceptInvite, undefined)
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} autoComplete="username" />
      <label>
        Full legal name
        <input name="name" defaultValue={defaultName} autoComplete="name" required />
      </label>
      <label>
        Password <span className="hint">(12+ characters)</span>
        <input name="password" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <label>
        Confirm password
        <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <FormError error={state?.error} />
      <SubmitButton pendingText="Creating account…">Continue to authenticator setup</SubmitButton>
    </form>
  )
}
