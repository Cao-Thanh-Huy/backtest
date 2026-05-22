/**
 * authStore.js — Native auth store (replaces keycloak.js)
 *
 * Handles JWT login/logout via backend /api/auth/* endpoints.
 * Tokens stored in localStorage under 'de_platform_token'.
 * No external IdP dependency.
 */

const TOKEN_KEY = 'de_platform_token';
const USER_KEY  = 'de_platform_user';

/**
 * Decode a JWT payload without verification (client-side only for display).
 */
function _decodeTokenPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/**
 * Check if a token is expired (client-side heuristic).
 */
function _isTokenExpired(token) {
  const payload = _decodeTokenPayload(token);
  if (!payload?.exp) return true;
  return Date.now() >= payload.exp * 1000;
}

export const authStore = {
  // ── Read ────────────────────────────────────────────────────────────────────

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  isAuthenticated() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    return !_isTokenExpired(token);
  },

  // ── Write ────────────────────────────────────────────────────────────────────

  /**
   * Login with username / password.
   * Returns: { access_token, require_password_change?, user }
   */
  async login(username, password) {
    const resp = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || 'Invalid username or password.');
    }

    const data = await resp.json();
    localStorage.setItem(TOKEN_KEY, data.access_token);

    // Fetch enriched user profile (permissions, roles, isAdmin)
    const meResp = await fetch('/api/iam/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const me = meResp.ok ? await meResp.json() : _decodeTokenPayload(data.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(me));

    return { ...data, user: me };
  },

  /**
   * Change password for the current user.
   */
  async changePassword(oldPassword, newPassword) {
    const token = this.getToken();
    const resp = await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to change password.');
    }
    return resp.json();
  },

  /**
   * Logout — clear stored credentials and redirect to /login.
   */
  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/login';
  },

  /**
   * Update stored user profile (called after permission changes).
   */
  async refreshUser() {
    const token = this.getToken();
    if (!token || _isTokenExpired(token)) {
      this.logout();
      return null;
    }
    try {
      const resp = await fetch('/api/iam/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const me = await resp.json();
        localStorage.setItem(USER_KEY, JSON.stringify(me));
        return me;
      }
    } catch {
      // network error — keep existing user
    }
    return this.getUser();
  },
};

export default authStore;
