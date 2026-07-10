import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { spedynet } from '@/api/spedynetClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wifi, Lock, User, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function ClientPortalLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if(!username || !password) {
      toast.error('Preencha todos os campos');
      return;
    }
    setLoading(true);
    try {
      const res = await spedynet.functions.invoke('clientAuth', { username, password });
      if (res.data.success) {
        localStorage.setItem('portal_client_id', res.data.client.id);
        toast.success('Login realizado com sucesso!');
        navigate('/portal');
      } else {
        toast.error('Credenciais inválidas');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Usuário ou senha incorretos.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center border border-primary/30 glow-cyan">
            <Wifi className="w-8 h-8 text-primary" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-foreground">
          Portal do Cliente
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Acesse para gerenciar seu plano de internet
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-card/80 backdrop-blur-xl py-8 px-4 shadow-2xl sm:rounded-2xl sm:px-10 border border-border">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <Label className="text-sm font-medium text-foreground">Usuário Hotspot ou CPF</Label>
              <div className="mt-2 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
                <Input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10 bg-input/50 h-11"
                  placeholder="Seu usuário ou CPF"
                />
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium text-foreground">Senha</Label>
              <div className="mt-2 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-muted-foreground" />
                </div>
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 bg-input/50 h-11"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <Button type="submit" className="w-full text-base font-semibold py-6 shadow-[0_0_15px_rgba(0,229,255,0.4)]" disabled={loading}>
              {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Acessar Portal'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}