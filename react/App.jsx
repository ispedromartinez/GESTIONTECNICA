import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import AuthRoute from './AuthRoute';

// Pantallas por rol — reemplaza con tus componentes reales
function SuperAdminPanel() { return <h1>Panel Superadmin</h1>; }
function AdminPanel()      { return <h1>Panel Admin Empresa</h1>; }
function SupervisorPanel() { return <h1>Panel Supervisor</h1>; }
function TecnicoPanel()    { return <h1>Panel Técnico</h1>; }
function SinAcceso()       { return <h2>Sin acceso — rol insuficiente</h2>; }

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/sin-acceso" element={<SinAcceso />} />

        {/* superadmin */}
        <Route path="/superadmin/*" element={
          <AuthRoute roles={['superadmin']}>
            <SuperAdminPanel />
          </AuthRoute>
        } />

        {/* admin_empresa */}
        <Route path="/admin/*" element={
          <AuthRoute roles={['admin_empresa', 'superadmin']}>
            <AdminPanel />
          </AuthRoute>
        } />

        {/* supervisor */}
        <Route path="/supervisor/*" element={
          <AuthRoute roles={['supervisor', 'admin_empresa', 'superadmin']}>
            <SupervisorPanel />
          </AuthRoute>
        } />

        {/* tecnico */}
        <Route path="/tecnico/*" element={
          <AuthRoute roles={['tecnico', 'supervisor', 'admin_empresa', 'superadmin']}>
            <TecnicoPanel />
          </AuthRoute>
        } />

        {/* raíz → login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
