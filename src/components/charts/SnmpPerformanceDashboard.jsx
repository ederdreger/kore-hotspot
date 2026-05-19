import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Server, Activity, ArrowDown, ArrowUp, Cpu, MemoryStick } from 'lucide-react';
import { format } from 'date-fns';

export default function SnmpPerformanceDashboard({ mikrotik }) {
  const { sessionToken } = useAuth();
  const [data, setData] = useState([]);
  const [current, setCurrent] = useState({ cpu: 0, memTotal: 0, memUsed: 0, rxMbps: 0, txMbps: 0, protocol: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mikrotik || !sessionToken) return;
    
    let isSubscribed = true;
    
    const fetchPerformance = async () => {
      try {
        const res = await base44.functions.invoke('mikrotikPerformance', {
          host: mikrotik.host,
          port: mikrotik.port,
          user: mikrotik.user,
          password: mikrotik.password,
          community: mikrotik.snmp_community || 'public',
          token: sessionToken
        });
        
        if (res.data?.success && isSubscribed) {
          const metrics = res.data.data;
          setCurrent(metrics);
          setError('');
          
          setData(prev => {
            const time = format(new Date(), 'HH:mm:ss');
            const newPoint = { 
              time, 
              download: parseFloat(metrics.rxMbps), 
              upload: parseFloat(metrics.txMbps),
              cpu: metrics.cpu
            };
            const newData = [...prev, newPoint];
            if (newData.length > 20) newData.shift();
            return newData;
          });
        } else if (res.data?.error) {
          if (isSubscribed) setError(res.data.error);
        }
      } catch (e) {
        if (isSubscribed) setError('Erro de conexão com SNMP/SSH');
      }
    };

    fetchPerformance();
    const interval = setInterval(fetchPerformance, 5000);
    
    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [mikrotik, sessionToken]);

  if (!mikrotik) return null;

  const memPercent = current.memTotal ? Math.round((current.memUsed / current.memTotal) * 100) : 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Performance do Equipamento (Tempo Real)
          </h3>
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Server className="w-3.5 h-3.5" />
            {mikrotik.name} ({mikrotik.host}) • Coleta via: {current.protocol || 'Carregando...'}
          </p>
        </div>
        {error && <span className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">{error}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 rounded-xl border border-border bg-secondary/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-2"><Cpu className="w-4 h-4" /> <span className="text-xs font-medium">Uso de CPU</span></div>
          <p className="text-2xl font-bold text-foreground">{current.cpu}%</p>
          <div className="w-full bg-secondary h-1.5 mt-2 rounded-full overflow-hidden">
            <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${current.cpu}%` }} />
          </div>
        </div>
        
        <div className="p-4 rounded-xl border border-border bg-secondary/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-2"><MemoryStick className="w-4 h-4" /> <span className="text-xs font-medium">Uso de Memória</span></div>
          <p className="text-2xl font-bold text-foreground">{memPercent}%</p>
          <div className="w-full bg-secondary h-1.5 mt-2 rounded-full overflow-hidden">
            <div className="bg-info h-full rounded-full transition-all" style={{ width: `${memPercent}%` }} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-secondary/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-2"><ArrowDown className="w-4 h-4 text-primary" /> <span className="text-xs font-medium">Download (Interface)</span></div>
          <p className="text-2xl font-bold text-foreground">{current.rxMbps} <span className="text-sm font-normal text-muted-foreground">Mbps</span></p>
        </div>

        <div className="p-4 rounded-xl border border-border bg-secondary/30">
          <div className="flex items-center gap-2 text-muted-foreground mb-2"><ArrowUp className="w-4 h-4 text-success" /> <span className="text-xs font-medium">Upload (Interface)</span></div>
          <p className="text-2xl font-bold text-foreground">{current.txMbps} <span className="text-sm font-normal text-muted-foreground">Mbps</span></p>
        </div>
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorDl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(187 100% 50%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(187 100% 50%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorUl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 18% 18%)" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(215 20% 55%)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'hsl(220 24% 11%)', border: '1px solid hsl(220 18% 18%)', borderRadius: '8px' }} />
            <Area type="monotone" dataKey="download" stroke="hsl(187 100% 50%)" strokeWidth={2} fill="url(#colorDl)" name="Download (Mbps)" />
            <Area type="monotone" dataKey="upload" stroke="hsl(142 71% 45%)" strokeWidth={2} fill="url(#colorUl)" name="Upload (Mbps)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}