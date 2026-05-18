import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import AppLayout from '@/components/layout/AppLayout';

// Pages
import Dashboard from '@/pages/Dashboard';
import Clients from '@/pages/Clients';
import Prospects from '@/pages/Prospects';
import Plans from '@/pages/Plans';
import Vouchers from '@/pages/Vouchers';
import Campaigns from '@/pages/Campaigns';
import Logs from '@/pages/Logs';
import Settings from '@/pages/Settings';
import CaptivePortal from '@/pages/CaptivePortal';
import RadiusMonitor from '@/pages/RadiusMonitor';
import APMonitor from '@/pages/APMonitor';
import HotspotPlans from '@/pages/HotspotPlans';
import HotspotLogin from '@/pages/HotspotLogin';
import UsersPage from '@/pages/Users';
import Login from '@/pages/Login';

// AuthenticatedApp: All admin routes are protected by ProtectedRoute
const AuthenticatedApp = () => {
  return (
    <Routes>
      {/* Captive Portal — standalone (no layout) */}
      <Route path="/captive-portal" element={<CaptivePortal />} />

      {/* Admin App with Layout — all routes protected */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/prospects" element={<Prospects />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/hotspot-plans" element={<HotspotPlans />} />
          <Route path="/vouchers" element={<Vouchers />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/radius" element={<RadiusMonitor />} />
          <Route path="/ap-monitor" element={<APMonitor />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/users" element={<UsersPage />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            {/* Rotas públicas de autenticação */}
            <Route path="/login" element={<Login />} />
            {/* Captive Portal e Hotspot Login — standalone */}
            <Route path="/hotspot-login" element={<HotspotLogin />} />
            <Route path="/captive-portal" element={<CaptivePortal />} />
            {/* Rotas do admin — com autenticação */}
            <Route path="/*" element={<AuthenticatedApp />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;