import React from 'react';
import { Link } from 'react-router-dom';
import {
  BookMarked, ArrowLeft, BarChart3, FileSpreadsheet,
  TrendingUp, PieChart, Banknote, CheckCircle2,
} from 'lucide-react';

const PLANNED_FEATURES = [
  { icon: BarChart3,       label: 'Tableau de bord comptable',         desc: 'Vue synthétique P&L, trésorerie, ratios' },
  { icon: FileSpreadsheet, label: 'Grand livre & journaux',             desc: 'Écritures comptables, lettrage automatique' },
  { icon: TrendingUp,      label: 'Suivi de trésorerie',               desc: 'Flux entrants / sortants, soldes par compte' },
  { icon: PieChart,        label: 'Rapports & bilans',                  desc: 'Bilan, compte de résultat, TVA déclarative' },
  { icon: Banknote,        label: 'Rapprochement bancaire',            desc: 'Import relevés, correspondance automatique' },
  { icon: CheckCircle2,    label: 'Clôture de période',                desc: 'Clôture mensuelle / annuelle avec verrou' },
];

export default function ComptabiliteComingSoon() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-3">

      {/* Back */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour à l'accueil
      </Link>

      {/* Hero card */}
      <div className="
        bg-card border border-border/50 rounded-2xl p-8 text-center mb-5
        shadow-[0_4px_24px_rgba(0,0,0,0.07),0_1px_4px_rgba(0,0,0,0.04)]
        dark:shadow-[0_4px_24px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]
      ">
        {/* Icon */}
        <div className="
          inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5
          bg-gradient-to-br from-violet-500 to-violet-700
          shadow-[0_4px_16px_rgba(124,58,237,0.35)]
        ">
          <BookMarked className="h-8 w-8 text-white" />
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
            En développement
          </span>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3 tracking-tight">
          Module Comptabilité
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
          Le module de comptabilité générale est en cours de développement.
          Il s'intégrera nativement avec la Facturation pour automatiser
          les écritures et le suivi financier.
        </p>
      </div>

      {/* Planned features */}
      <div className="
        bg-card border border-border/50 rounded-xl overflow-hidden
        shadow-[0_1px_4px_rgba(0,0,0,0.05),0_2px_10px_rgba(0,0,0,0.04)]
        dark:shadow-[0_1px_4px_rgba(0,0,0,0.3),0_2px_10px_rgba(0,0,0,0.25)]
      ">
        <div className="px-5 py-3.5 border-b border-border/50 bg-secondary/40">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Fonctionnalités prévues
          </p>
        </div>
        <div className="divide-y divide-border/40">
          {PLANNED_FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-4 px-5 py-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center mt-0.5">
                <Icon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-center text-[11px] text-muted-foreground/60 mt-5">
        Disponible dans une prochaine version de Stocky · <span className="font-medium">QodWeb 2026</span>
      </p>
    </div>
  );
}
