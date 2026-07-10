import React, { createContext, useState, useContext, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';

const AuthContext = createContext();
const TOKEN_KEY = 'kore_admin_session';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings] = useState(null);

  useEffect(() => {
    checkUserAuth();
  }, []);

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  const checkUserAuth = async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      const token = getToken();
      if (!token) {
        setIsAuthenticated(false);
        setUser(null);
        return;
      }
      const res = await spedynet.functions.invoke('adminAuth', { action: 'validate', token });
      setUser(res.data.user);
      setIsAuthenticated(true);
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      setIsAuthenticated(false);
      setAuthError({ type: 'auth_required', message: 'Authentication required' });
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  const login = async (email, password) => {
    const res = await spedynet.functions.invoke('adminAuth', { action: 'login', email, password });
    localStorage.setItem(TOKEN_KEY, res.data.token);
    setUser(res.data.user);
    setIsAuthenticated(true);
    setAuthError(null);
    return res.data.user;
  };

  const checkAppState = checkUserAuth;

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  const logout = async (shouldRedirect = true) => {
    const token = getToken();
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setIsAuthenticated(false);
    if (token) await spedynet.functions.invoke('adminAuth', { action: 'logout', token }).catch(() => null);
    if (shouldRedirect) window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      login,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState,
      getToken
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};