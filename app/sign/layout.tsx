// Everything under /sign is per-user and must never be statically cached.
export const dynamic = 'force-dynamic'

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return children
}
