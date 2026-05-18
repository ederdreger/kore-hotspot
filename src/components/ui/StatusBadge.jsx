import { cn } from '@/lib/utils';

const statusConfig = {
  active: { label: 'Ativo', class: 'bg-success/10 text-success border-success/30' },
  inactive: { label: 'Inativo', class: 'bg-muted text-muted-foreground border-border' },
  suspended: { label: 'Suspenso', class: 'bg-warning/10 text-warning border-warning/30' },
  trial: { label: 'Trial', class: 'bg-info/10 text-info border-info/30' },
  new: { label: 'Novo', class: 'bg-primary/10 text-primary border-primary/30' },
  contacted: { label: 'Contatado', class: 'bg-info/10 text-info border-info/30' },
  converted: { label: 'Convertido', class: 'bg-success/10 text-success border-success/30' },
  lost: { label: 'Perdido', class: 'bg-destructive/10 text-destructive border-destructive/30' },
  available: { label: 'Disponível', class: 'bg-success/10 text-success border-success/30' },
  used: { label: 'Usado', class: 'bg-muted text-muted-foreground border-border' },
  expired: { label: 'Expirado', class: 'bg-destructive/10 text-destructive border-destructive/30' },
  draft: { label: 'Rascunho', class: 'bg-muted text-muted-foreground border-border' },
  scheduled: { label: 'Agendada', class: 'bg-info/10 text-info border-info/30' },
  running: { label: 'Rodando', class: 'bg-primary/10 text-primary border-primary/30' },
  completed: { label: 'Concluída', class: 'bg-success/10 text-success border-success/30' },
  paused: { label: 'Pausada', class: 'bg-warning/10 text-warning border-warning/30' },
  success: { label: 'Sucesso', class: 'bg-success/10 text-success border-success/30' },
  error: { label: 'Erro', class: 'bg-destructive/10 text-destructive border-destructive/30' },
  warning: { label: 'Aviso', class: 'bg-warning/10 text-warning border-warning/30' },
  info: { label: 'Info', class: 'bg-info/10 text-info border-info/30' },
  online: { label: 'Online', class: 'bg-success/10 text-success border-success/30' },
  offline: { label: 'Offline', class: 'bg-muted text-muted-foreground border-border' },
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || { label: status, class: 'bg-muted text-muted-foreground border-border' };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border", config.class)}>
      {config.label}
    </span>
  );
}