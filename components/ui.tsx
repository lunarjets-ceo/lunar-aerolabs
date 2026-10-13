'use client'

import { useFormStatus } from 'react-dom'

export function SubmitButton({
  children,
  pendingText,
  className = 'btn btn-primary',
}: {
  children: React.ReactNode
  pendingText?: string
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? (pendingText ?? 'Working…') : children}
    </button>
  )
}

export function FormError({ error }: { error?: string }) {
  if (!error) return null
  return (
    <p className="form-error" role="alert">
      {error}
    </p>
  )
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand">Lunar AeroLabs</div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </main>
  )
}
