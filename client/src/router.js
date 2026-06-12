import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/',               component: () => import('./views/Landing.vue') },
  { path: '/login',          component: () => import('./views/Login.vue') },
  { path: '/selector',       component: () => import('./views/Selector.vue'),       meta: { auth: true } },
  { path: '/dashboard',      component: () => import('./views/Dashboard.vue'),      meta: { auth: true } },
  { path: '/admin',          component: () => import('./views/Admin.vue'),           meta: { auth: true } },
  { path: '/nuevo-proyecto', component: () => import('./views/NuevoProyecto.vue'),  meta: { auth: true } },
  { path: '/proyecto/:slug', component: () => import('./views/Proyecto.vue'),       meta: { auth: true } },
  { path: '/tigo',           component: () => import('./views/InformeClima.vue'),   meta: { auth: true } },
  { path: '/wom',            component: () => import('./views/InformeWom.vue'),     meta: { auth: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.meta.auth) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token')
    if (!token) return '/login'
  }
})

export default router
