import React from "react";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center bg-[#07111d] px-4">
      <style>{`
        @keyframes korePacket { 0% { transform: translateX(-20vw); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateX(120vw); opacity: 0; } }
        @keyframes korePulse { 0%, 100% { transform: scale(.72); opacity: .35; } 50% { transform: scale(1.18); opacity: 1; } }
        .kore-packet { animation: korePacket 9s linear infinite; }
        .kore-node { animation: korePulse 3.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .kore-packet, .kore-node { animation: none; } }
      `}</style>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {[18, 38, 62, 82].map((top, index) => (
          <div key={top} className="absolute left-0 right-0 h-px bg-cyan-400/20" style={{ top: `${top}%`, transform: `rotate(${index % 2 ? -3 : 3}deg)` }} />
        ))}
        {[12, 30, 50, 70, 88].map((left, index) => (
          <div key={left} className="kore-node absolute w-3 h-3 border-2 border-cyan-300 bg-[#07111d]" style={{ left: `${left}%`, top: `${22 + (index % 3) * 24}%`, animationDelay: `${index * .45}s` }} />
        ))}
        {[24, 48, 72].map((top, index) => (
          <div key={top} className={`kore-packet absolute left-0 w-2 h-2 ${index === 1 ? 'bg-red-500' : 'bg-cyan-300'}`} style={{ top: `${top}%`, animationDelay: `${index * -2.8}s` }} />
        ))}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-[#0b1b2b]" />
      </div>
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-lg bg-primary mb-4 shadow-lg shadow-cyan-500/20">
            <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
          {subtitle && <p className="text-slate-300 mt-2">{subtitle}</p>}
        </div>
        <div className="bg-card/95 rounded-lg shadow-2xl border border-border p-8 backdrop-blur-sm">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
