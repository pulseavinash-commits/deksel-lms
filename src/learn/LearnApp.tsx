import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AccessGate from './AccessGate';
import Register from './Register';
import LearningScreen from './LearningScreen';

type Stage = 'loading' | 'gate' | 'register' | 'learning';

export default function LearnApp() {
  const [stage, setStage] = useState<Stage>('loading');
  const [name, setName] = useState('');

  useEffect(() => {
    api<{ access: boolean; registered: boolean; name?: string }>('/api/learn/me')
      .then((r) => {
        if (!r.access) setStage('gate');
        else if (!r.registered) setStage('register');
        else { setName(r.name ?? ''); setStage('learning'); }
      })
      .catch(() => setStage('gate'));
  }, []);

  if (stage === 'loading') {
    return <div className="learn-root"><div className="learn-gate-wrap"><span className="spinner" /> Loading…</div></div>;
  }
  if (stage === 'gate') return <AccessGate onVerified={() => setStage('register')} />;
  if (stage === 'register') return <Register onRegistered={(n) => { setName(n); setStage('learning'); }} />;
  return <LearningScreen learnerName={name} onSessionExpired={() => setStage('gate')} />;
}
