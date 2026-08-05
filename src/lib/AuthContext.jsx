import React, { createContext, useState, useContext, useEffect } from 'react';
import { spedynet } from '@/api/spedynetClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings] = useState(null);

  useEffect(() => {
    localStorage.removeItem('kore_admin_session');
    checkUserAuth();
  }, []);

  const getToken = () => null;

  const checkUserAuth = async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      const res = await spedynet.functions.invoke('adminAuth', { action: 'validate' });
      setUser(res.data.user);
      setIsAuthenticated(true);
    } catch (error) {
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
    setUser(null);
    setIsAuthenticated(false);
    await spedynet.functions.invoke('adminAuth', { action: 'logout' }).catch(() => null);
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
