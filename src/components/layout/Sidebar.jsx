import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, UserSearch, Zap, Ticket, Megaphone,
  Settings, ScrollText, Wifi, ChevronRight, X, Radio, Signal, UserCog
} from 'lucide-react';

import { Server } from 'lucide-react';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Clientes', icon: Users, path: '/clients' },
  { label: 'Equipamentos', icon: Server, path: '/mikrotiks' },
  { label: 'Planos', icon: Zap, path: '/plans' },
  { label: 'Vouchers', icon: Ticket, path: '/vouchers' },
  { label: 'Campanhas', icon: Megaphone, path: '/campaigns' },
  { label: 'RADIUS Monitor', icon: Radio, path: '/radius' },
  { label: 'Monitor de APs', icon: Signal, path: '/ap-monitor' },
  { label: 'Logs', icon: ScrollText, path: '/logs' },
  { label: 'Usuários', icon: UserCog, path: '/users' },
  { label: 'Configurações', icon: Settings, path: '/settings' },
];

export default function Sidebar({ open, onClose }) {
  const location = useLocation();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside className={cn(
        "fixed top-0 left-0 h-full w-64 z-50 flex flex-col",
        "bg-card border-r border-border transition-transform duration-300",
        "lg:translate-x-0 lg:static lg:z-auto",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-cyan">
              <Wifi className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">Kore</p>
              <p className="text-xs text-primary font-mono tracking-widest">HOTSPOT</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
                  active
                    ? "bg-primary/10 text-primary border border-primary/20 glow-cyan"
                    : item.highlight && !active
                    ? "text-primary/80 hover:text-primary hover:bg-primary/5 border border-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                <item.icon className={cn("w-4 h-4", active && "text-primary")} />
                <span>{item.label}</span>
                {active && <ChevronRight className="w-3 h-3 ml-auto text-primary" />}
              </Link>
            );
          })}
        </nav>

        {/* Captive Portal Link */}
        <div className="px-3 py-4 border-t border-border">
          <Link
            to="/captive-portal"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all border border-dashed border-border hover:border-primary/30"
          >
            <Wifi className="w-4 h-4" />
            <span>Captive Portal</span>
          </Link>
        </div>

        <div className="px-6 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground font-mono">v1.0.0 — Kore-HotSpot</p>
        </div>
      </aside>
    </>
  );
}