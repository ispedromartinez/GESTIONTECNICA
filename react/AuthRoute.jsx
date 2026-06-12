import { Navigate } from 'react-router-dom';

// Devuelve el usuario del localStorage o null si el token no existe
export function getUsuario() {
  try {
    return JSON.parse(localStorage.getItem('usuario'));
  } catch {
    return null;
  }
}

export function getToken() {
  return localStorage.getItem('token') || null;
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
}

const JERARQUIA = {
  superadmin:    4,
  admin_empresa: 3,
  supervisor:    2,
  tecnico:       1
};

// Protege una ruta según rol mínimo requerido o lista de roles permitidos.
//
// Uso:
//   <AuthRoute roles={['superadmin']}>          — solo superadmin
//   <AuthRoute nivelMinimo={3}>                 — admin_empresa o superadmin
//   <AuthRoute>                                 — cualquier usuario autenticado
//
export default function AuthRoute({ children, roles, nivelMinimo }) {
  const usuario = getUsuario();

  if (!usuario || !getToken()) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(usuario.rol)) {
    return <Navigate to="/sin-acceso" replace />;
  }

  if (nivelMinimo !== undefined) {
    const nivel = JERARQUIA[usuario.rol] || 0;
    if (nivel < nivelMinimo) {
      return <Navigate to="/sin-acceso" replace />;
    }
  }

  return children;
}
