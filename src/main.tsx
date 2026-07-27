import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminApp from './admin/AdminApp';
import LearnApp from './learn/LearnApp';
import './styles.css';

function Home() {
  return (
    <div className="home-landing">
      <h1>AI Voice Trainer LMS</h1>
      <p>Choose your portal:</p>
      <div className="home-links">
        <a href="/learn" className="btn btn-primary">Learner Portal</a>
        <a href="/admin" className="btn btn-outline">Admin Portal</a>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/learn/*" element={<LearnApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
