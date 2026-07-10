import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { moduleKeyFromPath, userCanAccess } from '@/lib/modulePermissions';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const location = useLocation();
  const { user, isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked) {
    return fallback;
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    return unauthenticatedElement;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  const moduleKey = moduleKeyFromPath(location.pathname);
  if (moduleKey && !userCanAccess(user, moduleKey)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <h2 className="text-lg font-semibold text-foreground">Acesso nao permitido</h2>
          <p className="mt-2 text-sm text-muted-foreground">Seu usuario nao tem permissao para acessar este modulo.</p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
