import { useState } from 'react';
import { LogOut, Zap, ChevronDown, ChevronUp, Unlock, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/ui/StatusBadge';
import RadiusProfileModal from './RadiusProfileModal';

function formatBytes(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function QuotaBar({ used, total }) {
  if (!total) return <span className="text-xs text-muted-foreground font-mono">ilimitado</span>;
  const pct = Math.min((used / 1024 / total) * 100, 100);
  const color = pct >= 100 ? 'bg-destructive' : pct >= 75 ? 'bg-warning' : 'bg-success';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">{pct.toFixed(0)}%</span>
    </div>
  );
}

function RateIndicator({ down, up }) {
  return (
    <div className="text-right">
      <p className="text-xs font-mono text-primary">↓ {down} M</p>
      <p className="text-[10px] font-mono text-success">↑ {up} M</p>
    </div>
  );
}

const STATUS_LABELS = {
  active: 'Ativo',
  quota_exceeded: 'Bloqueado',
  warning: 'Alerta',
};

export default function RadiusSessionsTable({ sessions, loading, onDisconnect, onApplyProfile, onUnblock }) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortField, setSortField] = useState('downloadRate');
  const [sortDir, setSortDir] = useState('desc');
  const [profileModal, setProfileModal] = useState(null); // session for profile modal

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const filtered = sessions
    .filter(s => {
      const q = search.toLowerCase();
      const matchSearch = !q || s.username.includes(q) || s.framedIp.includes(q) || s.fullName.toLowerCase().includes(q);
      const matchStatus = filterStatus === 'all' || s.status === filterStatus;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      const mult = sortDir === 'asc' ? 1 : -1;
      if (typeof a[sortField] === 'number') return (a[sortField] - b[sortField]) * mult;
      return String(a[sortField]).localeCompare(String(b[sortField])) * mult;
    });

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />;
  };

  const colHeader = (label, field) => (
    <button onClick={() => handleSort(field)} className="flex items-center gap-1 hover:text-foreground transition-colors">
      {label} <SortIcon field={field} />
    </button>
  );

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-secondary/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="bg-card border border-border rounded-xl">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground flex-1">Sessões de Accounting</h3>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Usuário, IP..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
              {['all', 'active', 'quota_exceeded', 'warning'].map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${filterStatus === s ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {s === 'all' ? 'Todos' : STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {[
                  ['Usuário', 'username'],
                  ['IP / MAC', 'framedIp'],
                  ['Plano', 'planName'],
                  ['Sessão', 'sessionTime'],
                  ['Transferido', 'downloadMb'],
                  ['Taxa atual', 'downloadRate'],
                  ['Quota', null],
                  ['Status', 'status'],
                  ['Ações', null],
                ].map(([label, field], i) => (
                  <th key={i} className="text-left px-4 py-3 text-muted-foreground font-medium">
                    {field ? colHeader(label, field) : label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-muted-foreground">
                    Nenhuma sessão encontrada
                  </td>
                </tr>
              )}
              {filtered.map(session => (
                <tr key={session.id} className={`hover:bg-secondary/30 transition-colors ${session.status === 'quota_exceeded' ? 'bg-destructive/5' : session.status === 'warning' ? 'bg-warning/5' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-mono font-medium text-foreground">{session.username}</p>
                    <p className="text-[10px] text-muted-foreground">{session.fullName}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-info">{session.framedIp}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{session.macAddress}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-md bg-secondary text-foreground font-medium">{session.planName}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{session.sessionTime}</td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-foreground">↓ {formatBytes(session.downloadMb)}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">↑ {formatBytes(session.uploadMb)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <RateIndicator down={session.downloadRate} up={session.uploadRate} />
                  </td>
                  <td className="px-4 py-3">
                    <QuotaBar used={session.downloadMb + session.uploadMb} total={session.quotaGb} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={session.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {session.status === 'quota_exceeded' && (
                        <button
                          onClick={() => onUnblock(session)}
                          title="Resetar quota"
                          className="p-1.5 rounded-md text-success hover:bg-success/10 transition-colors"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setProfileModal(session)}
                        title="Aplicar perfil de emergência"
                        className="p-1.5 rounded-md text-warning hover:bg-warning/10 transition-colors"
                      >
                        <Zap className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDisconnect(session)}
                        title="Desconectar sessão"
                        className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">{filtered.length} de {sessions.length} sessões exibidas</p>
        </div>
      </div>

      {profileModal && (
        <RadiusProfileModal
          session={profileModal}
          onApply={(profile) => { onApplyProfile(profileModal, profile); setProfileModal(null); }}
          onClose={() => setProfileModal(null)}
        />
      )}
    </>
  );
}