import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || sessionStorage.getItem('token') || '')
  const usuario = ref(null)

  function setToken(t, remember = false) {
    token.value = t
    if (remember) {
      localStorage.setItem('token', t)
      sessionStorage.removeItem('token')
    } else {
      sessionStorage.setItem('token', t)
      localStorage.removeItem('token')
    }
  }

  function setUsuario(u) {
    usuario.value = u
  }

  function logout() {
    token.value = ''
    usuario.value = null
    localStorage.removeItem('token')
    sessionStorage.removeItem('token')
  }

  function isLoggedIn() {
    return !!(localStorage.getItem('token') || sessionStorage.getItem('token'))
  }

  async function fetchMe() {
    const t = localStorage.getItem('token') || sessionStorage.getItem('token')
    if (!t) return false
    try {
      const res = await fetch('/auth/me', {
        headers: { Authorization: 'Bearer ' + t }
      })
      if (!res.ok) { logout(); return false }
      const { usuario: u } = await res.json()
      setUsuario(u)
      return true
    } catch {
      return false
    }
  }

  return { token, usuario, setToken, setUsuario, logout, isLoggedIn, fetchMe }
})
