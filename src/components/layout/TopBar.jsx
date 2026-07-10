import { useEffect, useState } from 'react';
import { Menu, Bell, Activity, LogOut, Sun, Moon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

const routeLabels = {
  '/': 'Dashboard',
  '/clients': 'Clientes',
  '/prospects': 'Prospectos',
  '/plans': 'Planos de Velocidade',
  '/hotspot-plans': 'Gestão de Planos Hotspot',
  '/vouchers': 'Vouchers & Trial',
  '/campaigns': 'Campanhas',
  '/logs': 'Logs de Auditoria',
  '/settings': 'Configurações',
  '/captive-portal': 'Captive Portal',
};

export default function TopBar({ onMenuClick }) {
  const location = useLocation();
  const { logout, user } = useAuth();
  const label = routeLabels[location.pathname] || 'Kore-HotSpot';
  const [theme, setTheme] = useState(() => localStorage.getItem('kore_theme') || 'dark');

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('kore_theme', theme);
  }, [theme]);

  return (
    <header className="h-14 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden text-muted-foreground hover:text-foreground transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-semibold text-foreground">{label}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Status badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 border border-success/20">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="text-xs text-success font-medium">Sistema Online</span>
        </div>

        <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-primary rounded-full" />
        </button>

        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          title={theme === 'light' ? 'Usar modo escuro' : 'Usar modo claro'}
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>

        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary border border-border">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-mono text-muted-foreground">{user?.email || 'Admin'}</span>
        </div>

        <button onClick={() => logout(true)} className="p-2 text-muted-foreground hover:text-destructive transition-colors" title="Sair">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
