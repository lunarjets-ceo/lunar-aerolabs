/**
 * The Blob client reports any refusal from our token route as "Failed to
 * retrieve the client token". The route only refuses when the admin session is
 * gone (it lasts 12 hours), so say that instead.
 */
export function uploadErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : ''
  if (/client token/i.test(message)) {
    return 'Your sign-in has expired, so the upload could not start. Reload the page, sign in again, then retry.'
  }
  return message || 'Upload failed.'
}
