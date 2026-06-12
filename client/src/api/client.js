const getToken = () =>
  localStorage.getItem('token') || sessionStorage.getItem('token') || ''

export function authHeaders(extra = {}) {
  return { Authorization: 'Bearer ' + getToken(), ...extra }
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  })
  if (res.status === 401) {
    localStorage.removeItem('token')
    sessionStorage.removeItem('token')
    window.location.replace('/login')
    throw new Error('No autorizado')
  }
  return res
}

export async function apiGet(url) {
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function apiPost(url, body) {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return res
}

export async function apiDelete(url) {
  const res = await apiFetch(url, { method: 'DELETE' })
  return res
}
