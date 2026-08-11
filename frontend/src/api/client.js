/**
 * API client.
 *
 * The backend returns the SAME envelope shape for every outcome — success,
 * partial, and failure alike. So there is no try/catch and no res.ok branching
 * anywhere in the components: envelope in, envelope out.
 */

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

export function validateFile(file) {
  if (!file) return 'Choose an image first.'
  if (!ALLOWED.includes(file.type)) return 'Use a JPG, PNG, or WebP image.'
  if (file.size > MAX_BYTES) return 'That image is larger than 10 MB.'
  return null
}

function failed(message) {
  // Same shape the backend sends, error_detail included, so ErrorView never
  // has to ask where an envelope came from.
  return { status: 'failed', profile: null, error: message, error_detail: null }
}

export async function scanImage(file, mode = 'auto') {
  const body = new FormData()
  if (file) body.append('image', file)
  body.append('mode', mode)

  let res
  try {
    res = await fetch('/api/scan', { method: 'POST', body })
  } catch {
    return failed("Couldn't reach the server. Check that the backend is running.")
  }

  return res
    .json()
    .catch(() => failed('The server returned an unreadable response.'))
}

export async function fetchMocks() {
  try {
    const res = await fetch('/api/mocks')
    const json = await res.json()
    return json.mocks || []
  } catch {
    return []
  }
}

export async function fetchMock(id) {
  try {
    const res = await fetch(`/api/mocks/${id}`)
    return await res.json()
  } catch {
    return failed("Couldn't load the sample profile.")
  }
}

export async function fetchHealth() {
  try {
    const res = await fetch('/api/health')
    return await res.json()
  } catch {
    return null
  }
}
