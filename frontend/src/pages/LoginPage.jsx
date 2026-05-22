import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authStore } from '../auth/authStore';

// ── Change Password Modal ──────────────────────────────────────────────────────
function ChangePasswordModal({ onSuccess }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPwd !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (newPwd.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await authStore.changePassword(oldPwd, newPwd);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <span style={styles.modalIcon}>🔒</span>
          <h2 style={styles.modalTitle}>Change Password Required</h2>
          <p style={styles.modalSub}>You must set a new password before continuing.</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Current Password</label>
            <input
              type="password"
              value={oldPwd}
              onChange={e => setOldPwd(e.target.value)}
              required
              autoFocus
              style={styles.input}
              placeholder="Current password"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>New Password</label>
            <input
              type="password"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              required
              style={styles.input}
              placeholder="Min 8 characters"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Confirm New Password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              style={styles.input}
              placeholder="Repeat new password"
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
            {loading ? 'Changing…' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main Login Page ────────────────────────────────────────────────────────────
export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showChangePwd, setShowChangePwd] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authStore.login(username, password);
      if (result.require_password_change) {
        setShowChangePwd(true);
      } else {
        window.location.href = '/';
      }
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  if (showChangePwd) {
    return (
      <ChangePasswordModal onSuccess={() => window.location.href = '/'} />
    );
  }

  return (
    <div style={styles.page}>
      {/* Animated background orbs */}
      <div style={styles.orb1} />
      <div style={styles.orb2} />
      <div style={styles.orb3} />

      <div style={styles.card}>
        {/* Logo & brand */}
        <div style={styles.brand}>
          <div style={styles.logoBox}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="url(#grad)" />
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <path d="M8 22 L16 10 L24 22" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M11 18 H21" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 style={styles.brandName}>QuantFlow Studio</h1>
          <p style={styles.brandSub}>Quant Pipeline & Analytics Platform</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              style={styles.input}
              placeholder="platform_admin"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={styles.input}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={styles.error} role="alert">
              <span>⚠️</span> {error}
            </div>
          )}

          <button
            type="submit"
            id="login-btn"
            style={{ ...styles.btn, opacity: loading ? 0.75 : 1 }}
            disabled={loading}
          >
            {loading ? (
              <span style={styles.spinner}>⟳ Signing in…</span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <p style={styles.footer}>
          Bitex Data Platform · Enterprise Edition
        </p>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = {
  page: {
    minHeight:       '100vh',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    background:      'linear-gradient(135deg, #0f0c29 0%, #1a1040 50%, #0d0d1a 100%)',
    position:        'relative',
    overflow:        'hidden',
    fontFamily:      "'Inter', 'Segoe UI', system-ui, sans-serif",
  },
  orb1: {
    position: 'absolute', width: 500, height: 500, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)',
    top: '-150px', left: '-100px', pointerEvents: 'none',
  },
  orb2: {
    position: 'absolute', width: 400, height: 400, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)',
    bottom: '-100px', right: '-50px', pointerEvents: 'none',
  },
  orb3: {
    position: 'absolute', width: 300, height: 300, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(59,130,246,0.10) 0%, transparent 70%)',
    top: '60%', left: '30%', pointerEvents: 'none',
  },
  card: {
    position:     'relative',
    zIndex:       1,
    background:   'rgba(15, 12, 41, 0.85)',
    backdropFilter: 'blur(24px)',
    border:       '1px solid rgba(99,102,241,0.2)',
    borderRadius: '20px',
    padding:      '40px 44px 32px',
    width:         '100%',
    maxWidth:      '420px',
    boxShadow:    '0 0 60px rgba(99,102,241,0.12), 0 24px 48px rgba(0,0,0,0.4)',
  },
  brand: {
    textAlign:    'center',
    marginBottom: '32px',
  },
  logoBox: {
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom:   '12px',
  },
  brandName: {
    margin:     '0 0 4px',
    fontSize:   '26px',
    fontWeight: 700,
    background: 'linear-gradient(135deg, #a78bfa, #6366f1)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor:  'transparent',
    letterSpacing: '-0.5px',
  },
  brandSub: {
    margin:    0,
    color:     'rgba(148,163,184,0.8)',
    fontSize:  '13px',
    fontWeight: 400,
  },
  form: {
    display:       'flex',
    flexDirection: 'column',
    gap:           '20px',
  },
  field: {
    display:       'flex',
    flexDirection: 'column',
    gap:           '6px',
  },
  label: {
    fontSize:   '13px',
    fontWeight: 500,
    color:      'rgba(203,213,225,0.9)',
    letterSpacing: '0.3px',
  },
  input: {
    background:   'rgba(255,255,255,0.05)',
    border:       '1px solid rgba(99,102,241,0.25)',
    borderRadius: '10px',
    padding:      '12px 14px',
    color:        '#e2e8f0',
    fontSize:     '15px',
    outline:      'none',
    transition:   'border-color 0.2s, box-shadow 0.2s',
  },
  error: {
    background:   'rgba(239,68,68,0.12)',
    border:       '1px solid rgba(239,68,68,0.3)',
    borderRadius: '8px',
    padding:      '10px 14px',
    color:        '#fca5a5',
    fontSize:     '13px',
    display:      'flex',
    gap:          '8px',
    alignItems:   'center',
  },
  btn: {
    background:    'linear-gradient(135deg, #6366f1, #8b5cf6)',
    border:        'none',
    borderRadius:  '10px',
    padding:       '14px',
    color:         '#fff',
    fontSize:      '15px',
    fontWeight:    600,
    cursor:        'pointer',
    marginTop:     '4px',
    transition:    'transform 0.15s, box-shadow 0.15s',
    boxShadow:     '0 4px 20px rgba(99,102,241,0.35)',
    letterSpacing: '0.3px',
  },
  spinner: { display: 'inline-block', animation: 'spin 1s linear infinite' },
  footer: {
    textAlign:  'center',
    marginTop:  '24px',
    fontSize:   '11px',
    color:      'rgba(100,116,139,0.7)',
    letterSpacing: '0.5px',
  },
  // Modal
  overlay: {
    position: 'fixed', inset: 0, zIndex: 100,
    background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  modal: {
    background: 'rgba(15,12,41,0.95)',
    border:     '1px solid rgba(99,102,241,0.3)',
    borderRadius: '16px',
    padding:    '36px 40px',
    width:      '100%', maxWidth: '400px',
    boxShadow:  '0 0 60px rgba(99,102,241,0.2)',
  },
  modalHeader: { textAlign: 'center', marginBottom: '24px' },
  modalIcon:  { fontSize: '36px', display: 'block', marginBottom: '12px' },
  modalTitle: { margin: '0 0 8px', color: '#e2e8f0', fontSize: '20px', fontWeight: 700 },
  modalSub:   { margin: 0, color: 'rgba(148,163,184,0.8)', fontSize: '13px' },
};
