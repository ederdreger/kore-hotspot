import {
  LayoutDashboard, Users, UserSearch, Zap, Ticket, Megaphone,
  Settings, ScrollText, Radio, Signal, UserCog, Network, Server, Building2
} from 'lucide-react';

export const APP_MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { key: 'providers', label: 'Provedores', icon: Building2, path: '/providers' },
  { key: 'clients', label: 'Clientes', icon: Users, path: '/clients' },
  { key: 'prospects', label: 'Prospectos', icon: UserSearch, path: '/prospects' },
  { key: 'mikrotiks', label: 'Equipamentos', icon: Server, path: '/mikrotiks' },
  { key: 'vpn', label: 'VPN L2TP', icon: Network, path: '/vpn' },
  { key: 'plans', label: 'Planos', icon: Zap, path: '/plans' },
  { key: 'vouchers', label: 'Vouchers', icon: Ticket, path: '/vouchers' },
  { key: 'campaigns', label: 'Campanhas', icon: Megaphone, path: '/campaigns' },
  { key: 'radius', label: 'RADIUS Monitor', icon: Radio, path: '/radius' },
  { key: 'ap-monitor', label: 'Monitor de APs', icon: Signal, path: '/ap-monitor' },
  { key: 'logs', label: 'Logs', icon: ScrollText, path: '/logs' },
  { key: 'users', label: 'Usuarios', icon: UserCog, path: '/users' },
  { key: 'settings', label: 'Configuracoes', icon: Settings, path: '/settings' },
];

export function userCanAccess(user, moduleKey) {
  if (!moduleKey) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes('*') || permissions.includes(moduleKey);
}

export function moduleKeyFromPath(pathname = '') {
  const match = APP_MODULES
    .filter(module => pathname === module.path || pathname.startsWith(`${module.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.key || null;
}
