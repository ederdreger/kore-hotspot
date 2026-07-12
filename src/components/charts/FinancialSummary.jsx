import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { DollarSign, Clock, CalendarClock, TrendingUp } from 'lucide-react';
import { format, differenceInDays, addDays } from 'date-fns';

export default function FinancialSummary({ clients, plans }) {
  const { totalRevenue, planDist, upcomingExpirations } = useMemo(() => {
    let revenue = 0;
    const distMap = {};
    const expirations = [];
    const today = new Date();

    const planMap = {};
    plans.forEach(p => {
      planMap[p.id] = p;
    });

    clients.filter(c => c.status === 'active').forEach(c => {
      const plan = planMap[c.plan_id];
      if (plan) {
        // Calculate Revenue
        const price = Number(plan.price) || 0;
        revenue += price;

        // Plan Distribution
        if (!distMap[plan.name]) {
          distMap[plan.name] = { name: plan.name, value: 0, revenue: 0 };
        }
        distMap[plan.name].value += 1;
        distMap[plan.name].revenue += price;

        // Expirations (assuming provisioned_at + plan.validity_days)
        if (c.provisioned_at && plan.validity_days) {
          const expirationDate = addDays(new Date(c.provisioned_at), plan.validity_days);
          const daysLeft = differenceInDays(expirationDate, today);
          
          if (daysLeft >= 0 && daysLeft <= 7) { // Expires in 7 days or less
            expirations.push({
              id: c.id,
              name: c.name,
              planName: plan.name,
              expirationDate,
              daysLeft,
              revenue: price
            });
          }
        }
      }
    });

    // Format distribution for chart
    const colors = ['#00E5FF', '#00FF88', '#FFB800', '#A855F7', '#FF4444'];
    const dist = Object.values(distMap).sort((a, b) => b.value - a.value).map((item, index) => ({
      ...item,
      color: colors[index % colors.length]
    }));

    // Sort expirations
    expirations.sort((a, b) => a.daysLeft - b.daysLeft);

    return { totalRevenue: revenue, planDist: dist, upcomingExpirations: expirations };
  }, [clients, plans]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Revenue & Chart */}
      <div className="lg:col-span-1 bg-card border border-border rounded-xl p-5 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" /> Receita Mensal Estimada
          </h3>
        </div>
        
        <div className="mb-6">
          <p className="text-3xl font-bold text-foreground">{formatCurrency(totalRevenue)}</p>
          <p className="text-xs text-muted-foreground mt-1">Baseado em clientes ativos x valor do plano</p>
        </div>

        {planDist.length > 0 ? (
          <div className="flex-1 flex flex-col justify-between">
            <div className="h-40 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie 
                    data={planDist} 
                    cx="50%" cy="50%" 
                    innerRadius={45} outerRadius={65} 
                    dataKey="revenue" 
                    paddingAngle={3}
                  >
                    {planDist.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                  </Pie>
                  <RechartsTooltip 
                    formatter={(value) => formatCurrency(value)}
                    contentStyle={{ background: 'hsl(220 24% 11%)', border: '1px solid hsl(220 18% 18%)', borderRadius: '8px', fontSize: '12px' }} 
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <TrendingUp className="w-6 h-6 text-muted-foreground opacity-50" />
              </div>
            </div>
            <div className="space-y-2 mt-4 max-h-32 overflow-y-auto scrollbar-thin pr-2">
              {planDist.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
                    <span className="text-muted-foreground truncate max-w-[100px]" title={p.name}>{p.name}</span>
                  </span>
                  <div className="text-right">
                    <span className="font-mono font-medium text-foreground block">{formatCurrency(p.revenue)}</span>
                    <span className="text-[10px] text-muted-foreground">{p.value} clientes</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <DollarSign className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs text-center">Cadastre clientes com planos pagos<br/>para ver a distribuição</p>
          </div>
        )}
      </div>

      {/* Upcoming Expirations */}
      <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-warning" /> Próximos Vencimentos (7 dias)
          </h3>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/20">
            <span className="text-xs text-warning font-medium">{upcomingExpirations.length} vencendo</span>
          </div>
        </div>

        {upcomingExpirations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/30">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase">Cliente</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase">Plano</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase">Vencimento</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground uppercase">Valor</th>
                </tr>
              </thead>
              <tbody>
                {upcomingExpirations.map(c => (
                  <tr key={c.id} className="border-b border-border hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-2 font-medium text-foreground">{c.name}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{c.planName}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          c.daysLeft === 0 ? 'bg-destructive/20 text-destructive border border-destructive/30' : 
                          c.daysLeft <= 3 ? 'bg-warning/20 text-warning border border-warning/30' : 
                          'bg-primary/10 text-primary border border-primary/20'
                        }`}>
                          {c.daysLeft === 0 ? 'Hoje' : `Em ${c.daysLeft} dias`}
                        </span>
                        <span className="text-xs text-muted-foreground">{format(c.expirationDate, 'dd/MM/yyyy')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-medium text-foreground">{formatCurrency(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground bg-secondary/20 rounded-lg border border-dashed border-border">
            <Clock className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm font-medium">Nenhum vencimento próximo</p>
            <p className="text-xs mt-1 text-center max-w-xs">Nenhum cliente ativo possui vencimento configurado para os próximos 7 dias.</p>
          </div>
        )}
      </div>
    </div>
  );
}