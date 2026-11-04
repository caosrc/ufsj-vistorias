async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Não foi possível concluir a operação.')
  }
  return data
}

export function openServerSession(accessToken) {
  return request('/auth/session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function getServerSession() {
  return request('/auth/session')
}

export function closeServerSession() {
  return request('/auth/logout', { method: 'POST' })
}

export function getResidentProfile() {
  return request('/resident/profile')
}

export function saveResidentProfile(profile) {
  return request('/resident/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export function inviteStaff(email, redirectTo) {
  return request('/admin/invites', {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo }),
  })
}
