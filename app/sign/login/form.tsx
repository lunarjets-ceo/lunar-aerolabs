'use client'

import { useActionState } from 'react'
import { login } from '../auth-actions'
import { FormError, SubmitButton } from '@/components/ui'

export function LoginForm() {
  const [state, action] = useActionState(login, undefined)
  return (
    <form action={action} className="stack">
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <FormError error={state?.error} />
      <SubmitButton pendingText="Signing in…">Continue</SubmitButton>
    </form>
  )
}
