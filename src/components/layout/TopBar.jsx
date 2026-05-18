import { Menu, Bell, Wifi, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useLocation } from 'react-router-dom';

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
  const label = routeLabels[location.pathname] || 'Kore-HotSpot';

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

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary border border-border">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-mono text-muted-foreground">MikroTik</span>
          <Badge className="h-4 text-[9px] bg-success/20 text-success border-success/30 px-1">OK</Badge>
        </div>
      </div>
    </header>
  );
}