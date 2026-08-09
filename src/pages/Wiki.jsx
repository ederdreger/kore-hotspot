import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, Clipboard, ExternalLink,
  Menu, Moon, Search, ShieldCheck, Sun, X
} from 'lucide-react';
import { wikiSections, searchableWikiText } from '@/data/wikiContent';

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-slate-950 text-slate-100">
      <button onClick={copy} className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10">
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Clipboard className="h-3 w-3" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
      <pre className="overflow-x-auto p-4 pr-20 text-xs leading-6"><code>{children}</code></pre>
    </div>
  );
}

function Article({ article, index }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs font-bold text-primary">{index + 1}</span>
        <h3 className="pt-0.5 text-base font-semibold text-foreground">{article.title}</h3>
      </div>
      <div className="space-y-4 pl-0 md:pl-10">
        {article.body && <p className="text-sm leading-7 text-muted-foreground">{article.body}</p>}
        {article.steps && (
          <ol className="space-y-3">
            {article.steps.map((step, stepIndex) => (
              <li key={step} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-bold text-primary">{stepIndex + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
        {article.bullets && (
          <ul className="space-y-2.5">
            {article.bullets.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                <Check className="mt-1 h-4 w-4 shrink-0 text-success" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
        {article.table && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-secondary/70 text-foreground">
                <tr>{article.table.headers.map(header => <th key={header} className="px-4 py-3 font-semibold">{header}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {article.table.rows.map(row => (
                  <tr key={row.join('-')} className="text-muted-foreground">{row.map(cell => <td key={cell} className="px-4 py-3">{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {article.code && <CodeBlock>{article.code}</CodeBlock>}
        {article.note && (
          <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm leading-6 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>{article.note}</span>
          </div>
        )}
      </div>
    </article>
  );
}

export default function Wiki() {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('kore_theme') || 'dark');
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  const sections = useMemo(() => normalizedQuery
    ? wikiSections.filter(section => searchableWikiText(section).includes(normalizedQuery))
    : wikiSections, [normalizedQuery]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('kore_theme', next);
    document.documentElement.classList.toggle('light', next === 'light');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 md:px-6">
          <button onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary lg:hidden" aria-label="Abrir índice"><Menu className="h-5 w-5" /></button>
          <Link to="/" className="flex items-center gap-2 font-black tracking-tight">
            <BookOpen className="h-5 w-5 text-primary" />
            <span><span className="text-red-500">Kore</span><span className="text-blue-500">-Wiki</span></span>
          </Link>
          <div className="relative ml-auto hidden w-full max-w-lg sm:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar instalação, MikroTik, voucher..." className="h-10 w-full rounded-xl border border-border bg-input pl-10 pr-4 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10" />
          </div>
          <button onClick={toggleTheme} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" title="Alternar tema">{theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}</button>
          <Link to="/" className="hidden items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:border-primary/30 hover:text-primary md:flex"><ArrowLeft className="h-4 w-4" /> Painel</Link>
        </div>
        <div className="border-t border-border px-4 py-3 sm:hidden">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar na Wiki" className="h-10 w-full rounded-xl border border-border bg-input pl-10 pr-4 text-sm outline-none" /></div>
        </div>
      </header>

      {menuOpen && <button className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Fechar índice" />}
      <div className="mx-auto flex max-w-[1500px]">
        <aside className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-card p-5 pt-4 transition-transform lg:sticky lg:top-16 lg:z-auto lg:h-[calc(100vh-4rem)] lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="mb-4 flex items-center justify-between lg:hidden"><span className="font-semibold">Índice da Wiki</span><button onClick={() => setMenuOpen(false)}><X className="h-4 w-4" /></button></div>
          <p className="mb-3 px-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Documentação</p>
          <nav className="h-[calc(100%-5rem)] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {wikiSections.map((section, index) => (
              <a key={section.id} href={`#${section.id}`} onClick={() => setMenuOpen(false)} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
                <span className="font-mono text-[10px] text-primary/70">{String(index + 1).padStart(2, '0')}</span>
                <span>{section.title}</span>
                <ChevronRight className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ))}
          </nav>
          <div className="absolute bottom-4 left-5 right-5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">Wiki correspondente à versão <span className="font-mono text-primary">v{__APP_VERSION__}</span></div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-8 md:px-8 lg:px-10">
          <section className="relative mb-10 overflow-hidden rounded-3xl border border-primary/20 bg-card p-7 md:p-10">
            <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"><ShieldCheck className="h-3.5 w-3.5" /> Guia oficial de operação</div>
              <h1 className="text-3xl font-black tracking-tight md:text-5xl">Documentação Kore-HotSpot</h1>
              <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">Do primeiro DNS à adoção UniFi: procedimentos reproduzíveis para instalar, configurar, operar e recuperar todo o ambiente sem depender de ajustes improvisados.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#instalacao" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Começar instalação <ChevronRight className="h-4 w-4" /></a>
                <a href="https://github.com/ederdreger/kore-hotspot/releases" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">Ver releases <ExternalLink className="h-4 w-4" /></a>
              </div>
            </div>
          </section>

          {sections.length ? (
            <div className="space-y-12">
              {sections.map((section, sectionIndex) => (
                <section key={section.id} id={section.id} className="scroll-mt-24">
                  <div className="mb-5 flex items-start gap-4">
                    <span className="mt-1 font-mono text-xs font-bold text-primary">{String(wikiSections.indexOf(section) + 1).padStart(2, '0')}</span>
                    <div><h2 className="text-2xl font-bold tracking-tight">{section.title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{section.description}</p></div>
                  </div>
                  <div className="space-y-4">{section.articles.map((article, articleIndex) => <Article key={`${sectionIndex}-${article.title}`} article={article} index={articleIndex} />)}</div>
                </section>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center"><Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h2 className="font-semibold">Nenhum tópico encontrado</h2><p className="mt-1 text-sm text-muted-foreground">Tente pesquisar por outro termo.</p></div>
          )}

          <footer className="mt-14 border-t border-border py-8 text-center text-xs text-muted-foreground">Kore-HotSpot v{__APP_VERSION__} · Documentação operacional integrada</footer>
        </main>
      </div>
    </div>
  );
}
