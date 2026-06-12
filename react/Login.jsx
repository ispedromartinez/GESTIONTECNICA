import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const RUTA_POR_ROL = {
  superadmin:    '/superadmin',
  admin_empresa: '/admin',
  supervisor:    '/supervisor',
  tecnico:       '/tecnico'
};

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Error al iniciar sesión');
        return;
      }
      localStorage.setItem('token',   data.token);
      localStorage.setItem('usuario', JSON.stringify(data.usuario));
      navigate(RUTA_POR_ROL[data.usuario.rol] || '/');
    } catch {
      setError('No se pudo conectar con el servidor');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h2 style={styles.title}>Iniciar sesión</h2>

        {error && <p style={styles.error}>{error}</p>}

        <label style={styles.label}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoFocus
          style={styles.input}
        />

        <label style={styles.label}>Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={styles.input}
        />

        <button type="submit" disabled={cargando} style={styles.btn}>
          {cargando ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f0f4f8'
  },
  card: {
    background: '#fff',
    borderRadius: 8,
    padding: '2rem',
    width: 360,
    boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem'
  },
  title: { margin: '0 0 0.5rem', color: '#1a3a6c', textAlign: 'center' },
  label: { fontWeight: 600, fontSize: 14, color: '#333' },
  input: {
    padding: '0.5rem 0.75rem',
    borderRadius: 4,
    border: '1px solid #ccc',
    fontSize: 15
  },
  btn: {
    marginTop: '0.5rem',
    padding: '0.65rem',
    background: '#1a3a6c',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: 15,
    cursor: 'pointer',
    fontWeight: 600
  },
  error: {
    background: '#fdecea',
    color: '#c0392b',
    padding: '0.5rem 0.75rem',
    borderRadius: 4,
    fontSize: 14,
    margin: 0
  }
};
