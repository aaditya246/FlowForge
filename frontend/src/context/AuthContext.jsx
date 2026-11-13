import { createContext, useContext, useEffect, useState } from 'react';
import * as authService from '../services/authService';
import { getToken, setToken, clearToken } from '../utils/tokenStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    authService
      .getCurrentUser()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password, { remember = true } = {}) {
    const { user: loggedInUser, token } = await authService.login(email, password);
    setToken(token, remember);
    setUser(loggedInUser);
    return loggedInUser;
  }

  async function register(payload) {
    const { user: newUser, token } = await authService.register(payload);
    setToken(token, true);
    setUser(newUser);
    return newUser;
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
