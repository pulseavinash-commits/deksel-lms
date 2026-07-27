import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import AdminLogin from './AdminLogin';
import CourseEditor from './CourseEditor';
import GeminiSettings from './GeminiSettings';
import Reports from './Reports';
import AdminSettings from './AdminSettings';

export default function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');

  useEffect(() => {
    api<{ email: string }>('/api/admin/me')
      .then((r) => { setEmail(r.email); setAuthed(true); })
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return <div className="admin-root"><div className="admin-login-wrap"><span className="spinner" /> Loading…</div></div>;
  }
  if (!authed) {
    return <AdminLogin onLogin={(e) => { setEmail(e); setAuthed(true); }} />;
  }

  const logout = async () => {
    await api('/api/admin/logout', { method: 'POST', body: {} });
    setAuthed(false);
  };

  return (
    <div className="admin-root">
      <header className="admin-topbar">
        <span className="brand">⚙ ADMIN CONSOLE</span>
        <nav>
          <NavLink to="/admin/course">Course</NavLink>
          <NavLink to="/admin/gemini">Gemini Live</NavLink>
          <NavLink to="/admin/reports">Reports</NavLink>
          <NavLink to="/admin/settings">Settings</NavLink>
        </nav>
        <span style={{ color: 'var(--admin-dim)', fontSize: '.85rem' }}>{email}</span>
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--admin-dim)' }} onClick={logout}>Sign out</button>
      </header>
      <main className="admin-main">
        <Routes>
          <Route path="/" element={<Navigate to="/admin/course" replace />} />
          <Route path="/course" element={<CourseEditor />} />
          <Route path="/gemini" element={<GeminiSettings />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<AdminSettings />} />
        </Routes>
      </main>
    </div>
  );
}
