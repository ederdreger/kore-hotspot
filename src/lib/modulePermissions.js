import {
  LayoutDashboard, Users, UserSearch, Zap, Ticket, Megaphone,
  Settings, ScrollText, Radio, Signal, UserCog, Network, Server, Building2
} from 'lucide-react';

export const APP_MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', iconClass: 'text-cyan-500', iconBgClass: 'bg-cyan-500/10' },
  { key: 'providers', label: 'Provedores', icon: Building2, path: '/providers', iconClass: 'text-violet-500', iconBgClass: 'bg-violet-500/10' },
  { key: 'clients', label: 'Clientes', icon: Users, path: '/clients', iconClass: 'text-blue-500', iconBgClass: 'bg-blue-500/10' },
  { key: 'prospects', label: 'Prospectos', icon: UserSearch, path: '/prospects', iconClass: 'text-fuchsia-500', iconBgClass: 'bg-fuchsia-500/10' },
  { key: 'mikrotiks', label: 'Equipamentos', icon: Server, path: '/mikrotiks', iconClass: 'text-orange-500', iconBgClass: 'bg-orange-500/10' },
  { key: 'vpn', label: 'VPN L2TP', icon: Network, path: '/vpn', iconClass: 'text-indigo-500', iconBgClass: 'bg-indigo-500/10' },
  { key: 'plans', label: 'Planos', icon: Zap, path: '/plans', iconClass: 'text-amber-500', iconBgClass: 'bg-amber-500/10' },
  { key: 'vouchers', label: 'Vouchers', icon: Ticket, path: '/vouchers', iconClass: 'text-emerald-500', iconBgClass: 'bg-emerald-500/10' },
  { key: 'campaigns', label: 'Campanhas', icon: Megaphone, path: '/campaigns', iconClass: 'text-rose-500', iconBgClass: 'bg-rose-500/10' },
  { key: 'radius', label: 'RADIUS Monitor', icon: Radio, path: '/radius', iconClass: 'text-sky-500', iconBgClass: 'bg-sky-500/10' },
  { key: 'ap-monitor', label: 'Monitor de APs', icon: Signal, path: '/ap-monitor', iconClass: 'text-teal-500', iconBgClass: 'bg-teal-500/10' },
  { key: 'logs', label: 'Logs', icon: ScrollText, path: '/logs', iconClass: 'text-slate-500', iconBgClass: 'bg-slate-500/10' },
  { key: 'users', label: 'Usuarios', icon: UserCog, path: '/users', iconClass: 'text-purple-500', iconBgClass: 'bg-purple-500/10' },
  { key: 'settings', label: 'Configuracoes', icon: Settings, path: '/settings', iconClass: 'text-zinc-500', iconBgClass: 'bg-zinc-500/10' },
];

export const SYSTEM_MODULES = ['providers'];
export const TENANT_ADMIN_PERMISSIONS = APP_MODULES
  .map(module => module.key)
  .filter(key => !SYSTEM_MODULES.includes(key));

export function isSystemAdmin(user) {
  return user?.role === 'super_admin' || user?.scope === 'system';
}

export function userCanAccess(user, moduleKey) {
  if (!moduleKey) return true;
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  if (SYSTEM_MODULES.includes(moduleKey)) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return (permissions.includes('*') && !SYSTEM_MODULES.includes(moduleKey)) || permissions.includes(moduleKey);
}

export function moduleKeyFromPath(pathname = '') {
  const match = APP_MODULES
    .filter(module => pathname === module.path || pathname.startsWith(`${module.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.key || null;
}
