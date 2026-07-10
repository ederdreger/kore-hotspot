import React from 'react';
import { Button } from '@/components/ui/button';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Application render error', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="bg-card border border-border rounded-xl p-6 max-w-lg w-full">
          <h2 className="text-lg font-semibold text-foreground mb-2">Erro ao carregar esta tela</h2>
          <p className="text-sm text-muted-foreground mb-4">
            A navegação foi preservada. Atualize a tela ou volte para outro menu.
          </p>
          <pre className="bg-secondary/50 border border-border rounded-lg p-3 text-xs text-destructive whitespace-pre-wrap mb-4">
            {this.state.error?.message || 'Erro desconhecido'}
          </pre>
          <Button onClick={() => this.setState({ hasError: false, error: null })}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }
}
