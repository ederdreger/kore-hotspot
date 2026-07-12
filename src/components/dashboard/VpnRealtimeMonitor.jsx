import React, { useState, useEffect, useRef } from 'react';
import { spedynet } from '@/api/spedynetClient';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, Network, UserX, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function VpnRealtimeMonitor({ mikrotik }) {
  const { getToken } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(null);
  const [bandwidth, setBandwidth] = useState({ rx: 0, tx: 0 });
  const lastBytes = useRef({ rx: 0, tx: 0, time: 0 });

  const fetchData = async () => {
    try {
      const res = await spedynet.functions.invoke('vpnStatus', { token: getToken() });
      
      const d = res.data;
      if (d.connected) {
         setData(d);
         const now = Date.now();
         if (lastBytes.current.time > 0) {
            const timeDiff = (now - lastBytes.current.time) / 1000;
            const rxDiff = d.total_rx_bytes - lastBytes.current.rx;
            const txDiff = d.total_tx_bytes - lastBytes.current.tx;
            setBandwidth({
               rx: rxDiff > 0 ? (rxDiff * 8) / timeDiff : 0,
               tx: txDiff > 0 ? (txDiff * 8) / timeDiff : 0
            });
         }
         lastBytes.current = { rx: d.total_rx_bytes, tx: d.total_tx_bytes, time: now };
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!mikrotik) return;
    fetchData();
    const interval = setInterval(fetchData, 5000); // Atualiza a cada 5 segundos
    return () => clearInterval(interval);
  }, [mikrotik]);

  const handleDisconnect = async (username) => {
    setDisconnecting(username);
    try {
      await spedynet.functions.invoke('mikrotikStatus', {
        host: mikrotik.host,
        port: mikrotik.port,
        user: mikrotik.user,
        password: mikrotik.password,
        token: getToken(),
        action: 'disconnect_vpn',
        username_to_disconnect: username
      });
      toast.success(`${username} desconectado com sucesso`);
      fetchData();
    } catch (e) {
      toast.error('Erro ao desconectar usuário');
    } finally {
      setDisconnecting(null);
    }
  };

  const formatBps = (bps) => {
    if (bps > 1000000) return (bps / 1000000).toFixed(2) + ' Mbps';
    if (bps > 1000) return (bps / 1000).toFixed(2) + ' Kbps';
    return bps.toFixed(0) + ' bps';
  };

  if (!mikrotik) return null;

  return (
    <Card className="col-span-full shadow-sm border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Monitor VPN L2TP em Tempo Real ({mikrotik.name})
        </CardTitle>
        {data && (
          <div className="flex gap-4 text-xs font-mono bg-secondary/30 px-3 py-1.5 rounded-lg border border-border/50">
             <span className="text-success flex items-center gap-1">↓ {formatBps(bandwidth.rx)}</span>
             <span className="text-info flex items-center gap-1">↑ {formatBps(bandwidth.tx)}</span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-4 mb-4">
               <div className="bg-secondary/50 p-4 rounded-xl flex-1 border border-border/50">
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Conexões Ativas</p>
                  <p className="text-3xl font-bold text-foreground">{data?.vpn_connections?.length || 0}</p>
               </div>
               <div className="bg-secondary/50 p-4 rounded-xl flex-1 border border-border/50">
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">CPU Load</p>
                  <p className="text-3xl font-bold text-foreground">{data?.cpu_load || 0}%</p>
               </div>
            </div>
            
            <div className="rounded-xl border border-border overflow-hidden">
              {data?.vpn_connections?.length === 0 ? (
                 <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center">
                   <Network className="w-8 h-8 mb-2 opacity-20" />
                   Nenhum cliente VPN conectado no momento.
                 </div>
              ) : (
                 <table className="w-full text-sm text-left">
                   <thead className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
                     <tr>
                       <th className="px-4 py-3 font-medium">Usuário PPP</th>
                       <th className="px-4 py-3 font-medium">Endereço IP</th>
                       <th className="px-4 py-3 font-medium">Serviço</th>
                       <th className="px-4 py-3 font-medium">Uptime</th>
                       <th className="px-4 py-3 font-medium text-right">Ação</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-border">
                     {data?.vpn_connections?.map(c => (
                       <tr key={c.name} className="hover:bg-secondary/20 transition-colors">
                         <td className="px-4 py-3 font-semibold text-foreground">{c.name}</td>
                         <td className="px-4 py-3 font-mono text-xs text-primary">{c.address}</td>
                         <td className="px-4 py-3 text-xs">
                           <span className="bg-secondary px-2 py-0.5 rounded-full">{c.service || 'l2tp'}</span>
                         </td>
                         <td className="px-4 py-3 text-xs text-muted-foreground">{c.uptime}</td>
                         <td className="px-4 py-3 text-right">
                           <Button 
                             size="sm" 
                             variant="ghost" 
                             className="h-8 text-destructive hover:bg-destructive/10 gap-1.5"
                             disabled={disconnecting === c.name}
                             onClick={() => handleDisconnect(c.name)}
                           >
                             {disconnecting === c.name ? (
                               <><Loader2 className="w-3.5 h-3.5 animate-spin" /> ...</>
                             ) : (
                               <><UserX className="w-3.5 h-3.5" /> Desconectar</>
                             )}
                           </Button>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
