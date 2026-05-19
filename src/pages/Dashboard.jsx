import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import StatCard from '@/components/ui/StatCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { Users, UserSearch, Zap, Ticket, Wifi, Activity, Clock, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import ConversionFunnelChart from '@/components/charts/ConversionFunnelChart';
import BandwidthByPlanChart from '@/components/charts/BandwidthByPlanChart';
import HotspotHeatmap from '@/components/charts/HotspotHeatmap';
import FinancialSummary from '@/components/charts/FinancialSummary';
import { useNavigate } from 'react-router-dom';

const trafficData = [];
const onlineUsers = [];

export default function Dashboard() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [plans, setPlans] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    base44.entities.Client.list('-created_date', 100).then(setClients).catch(() => {});
    base44.entities.Prospect.list('-created_date', 100).then(setProspects).catch(() => {});
    base44.entities.Plan.list().then(setPlans).catch(() => {});
    base44.entities.Voucher.list('-created_date', 50).then(setVouchers).catch(() => {});
    base44.entities.AuditLog.list('-created_date', 10).then(setLogs).catch(() => {});
  }, []);

  const activeClients = clients.filter(c => c.status === 'active').length;
  const trialClients = clients.filter(c => c.status === 'trial').length;
  const newProspects = prospects.filter(p => p.status === 'new').length;
  const availableVouchers = vouchers.filter(v => v.status === 'available').length;

  const planDist = plans.map((p, i) => ({
    name: p.name,
    value: clients.filter(c => c.plan_id === p.id).length,
    color: ['#00E5FF', '#00FF88', '#FFB800', '#A855F7', '#FF4444'][i % 5]
  })).filter(p => p.value > 0);

  const actionIcons = { success: CheckCircle, error: AlertCircle, warning: AlertCircle, info: Activity };

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Clientes Ativos" value={activeClients} subtitle={`${trialClients} em trial`} icon={Users} color="primary" trend="up" trendValue="+5%" onClick={() => navigate('/clients')} />
        <StatCard title="Prospectos" value={newProspects} subtitle="Novos este mês" icon={UserSearch} color="info" trend="up" trendValue="+12%" onClick={() => navigate('/prospects')} />
        <StatCard title="Online Agora" value={onlineUsers.length} subtitle="2 em trial" icon={Wifi} color="success" onClick={() => navigate('/radius')} />
        <StatCard title="Vouchers" value={availableVouchers} subtitle="Disponíveis" icon={Ticket} color="warning" onClick={() => navigate('/vouchers')} />
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Traffic Chart */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Tráfego de Rede</h3>
              <p className="text-xs text-muted-foreground">Últimas 24 horas (Mbps)</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" />Download</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success inline-block" />Upload</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={trafficData}>
              <defs>
                <linearGradient id="dl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(187 100% 50%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(187 100% 50%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ul" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 18%)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: 'hsl(220 24% 11%)', border: '1px solid hsl(220 18% 18%)', borderRadius: '8px', fontSize: '12px' }} />
              <Area type="monotone" dataKey="download" stroke="hsl(187 100% 50%)" strokeWidth={2} fill="url(#dl)" />
              <Area type="monotone" dataKey="upload" stroke="hsl(142 71% 45%)" strokeWidth={2} fill="url(#ul)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Plan Distribution */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Distribuição de Planos</h3>
          <p className="text-xs text-muted-foreground mb-4">Clientes por plano</p>
          {planDist.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={planDist} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={3}>
                    {planDist.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'hsl(220 24% 11%)', border: '1px solid hsl(220 18% 18%)', borderRadius: '8px', fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-3">
                {planDist.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} /><span className="text-muted-foreground">{p.name}</span></span>
                    <span className="font-mono font-medium text-foreground">{p.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Zap className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">Crie planos para ver a distribuição</p>
            </div>
          )}
        </div>
      </div>

      {/* Advanced Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ConversionFunnelChart prospects={prospects} clients={clients} />
        <BandwidthByPlanChart plans={plans} clients={clients} />
      </div>

      {/* Financial Summary Row */}
      <FinancialSummary clients={clients} plans={plans} />

      {/* Heatmap full width */}
      <HotspotHeatmap clients={clients} prospects={prospects} />

      {/* Online Users + Recent Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Online Users */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Usuários Online</h3>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 border border-success/20">
              <div className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
              <span className="text-xs text-success font-medium">{onlineUsers.length} online</span>
            </div>
          </div>
          {onlineUsers.length > 0 ? (
            <div className="space-y-2">
              {onlineUsers.map((u, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${u.status === 'trial' ? 'bg-warning animate-pulse' : 'bg-success animate-pulse'}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{u.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{u.ip}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <StatusBadge status={u.status} />
                    <p className="text-[10px] text-muted-foreground mt-0.5">{u.time}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Wifi className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">Nenhum usuário online no momento</p>
            </div>
          )}
        </div>

        {/* Recent Logs */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Atividade Recente</h3>
          {logs.length > 0 ? (
            <div className="space-y-2">
              {logs.map((log) => {
                const Icon = actionIcons[log.status] || Activity;
                const colorMap = { success: 'text-success', error: 'text-destructive', warning: 'text-warning', info: 'text-info' };
                return (
                  <div key={log.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-secondary/50">
                    <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${colorMap[log.status]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground">{log.message}</p>
                      <p className="text-[10px] text-muted-foreground">{log.entity_type} · {format(new Date(log.created_date), 'dd/MM HH:mm', { locale: ptBR })}</p>
                    </div>
                    <StatusBadge status={log.status} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Activity className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">Nenhuma atividade registrada</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}