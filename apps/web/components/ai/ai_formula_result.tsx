'use client';

import React from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Surface, SurfaceHeader } from '@/components/ui/surface';

interface FormulaIngredient {
  phase?: string;
  phase_label?: string;
  rm_code?: string;
  inci_name?: string;
  trade_name?: string;
  function?: string;
  function_desc?: string;
  percentage?: number;
  amount_grams?: number;
}

interface FormulaResultProps {
  formula: {
    formula_name?: string;
    formula_code?: string;
    formula_id?: string;
    product_type?: string;
    target_benefits?: string[];
    batch_size_grams?: number;
    total_percentage?: number;
    estimated_cost_thb?: number;
    ingredients?: FormulaIngredient[];
    warnings?: Array<{ severity?: string; message?: string } | string>;
  };
  citations?: Array<{
    source: string;
    rm_code?: string;
    inci_name?: string;
    trade_name?: string;
    score?: number;
  }>;
  quickActions?: Array<{ label: string; prompt?: string; href?: string }>;
  language?: 'th' | 'en';
  onQuickAction?: (prompt: string) => void;
}

function fmtNumber(value: unknown, digits = 2): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '-';
}

function text(value: unknown, fallback = '-'): string {
  const str = String(value ?? '').trim();
  return str || fallback;
}

export function AIFormulaResult({
  formula,
  citations = [],
  quickActions = [],
  language = 'th',
  onQuickAction,
}: FormulaResultProps) {
  const isThai = language !== 'en';
  const ingredients = Array.isArray(formula.ingredients) ? formula.ingredients.slice(0, 30) : [];
  const warnings = Array.isArray(formula.warnings) ? formula.warnings : [];

  return (
    <Surface variant="default" className="mt-4 overflow-hidden">
      <SurfaceHeader className="px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">
              {text(formula.formula_name, isThai ? 'สูตร draft จาก AI' : 'AI draft formula')}
            </div>
            <div className="mt-1 text-xs text-muted">
              {formula.formula_code && <span>{formula.formula_code} · </span>}
              {text(formula.product_type, isThai ? 'ไม่ระบุประเภท' : 'unspecified type')}
              {formula.batch_size_grams ? ` · ${formula.batch_size_grams} g` : ''}
            </div>
          </div>
          <div className="text-right text-xs text-muted">
            <div>{isThai ? 'รวม' : 'Total'} {fmtNumber(formula.total_percentage ?? 100)}%</div>
            {formula.estimated_cost_thb != null && (
              <div>{fmtNumber(formula.estimated_cost_thb)} THB</div>
            )}
          </div>
        </div>
        {Array.isArray(formula.target_benefits) && formula.target_benefits.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {formula.target_benefits.slice(0, 8).map((benefit) => (
              <span
                key={benefit}
                className="rounded-full border border-border bg-subtle px-2 py-0.5 text-xs font-medium text-muted"
              >
                {benefit}
              </span>
            ))}
          </div>
        )}
      </SurfaceHeader>

      {ingredients.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-border bg-subtle text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{isThai ? 'Phase' : 'Phase'}</th>
                <th className="px-3 py-2 font-medium">RM</th>
                <th className="px-3 py-2 font-medium">INCI / Trade</th>
                <th className="px-3 py-2 font-medium">{isThai ? 'หน้าที่' : 'Function'}</th>
                <th className="px-3 py-2 text-right font-medium">%</th>
                <th className="px-3 py-2 text-right font-medium">g</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ingredients.map((ing, index) => (
                <tr key={`${ing.rm_code || ing.inci_name || index}-${index}`} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{text(ing.phase || ing.phase_label)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-muted">{text(ing.rm_code)}</td>
                  <td className="min-w-48 px-4 py-3 text-ink">
                    <div>{text(ing.inci_name || ing.trade_name)}</div>
                    {ing.inci_name && ing.trade_name && ing.inci_name !== ing.trade_name && (
                      <div className="text-muted">{ing.trade_name}</div>
                    )}
                  </td>
                  <td className="min-w-36 px-4 py-3 text-muted">{text(ing.function || ing.function_desc)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink">
                    {fmtNumber(ing.percentage)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted">
                    {fmtNumber(ing.amount_grams)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50/55 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-700">
            <AlertTriangle size={12} />
            {isThai ? 'จุดที่ต้องตรวจสอบ' : 'Review items'}
          </div>
          <ul className="space-y-0.5 text-[11px] text-amber-800">
            {warnings.slice(0, 6).map((warning, index) => (
              <li key={index}>- {typeof warning === 'string' ? warning : warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      {(quickActions.length > 0 || citations.length > 0) && (
        <div className="border-t border-border px-4 py-3">
          {quickActions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {quickActions.map((action, index) => action.href ? (
                <a
                  key={`${action.label}-${index}`}
                  href={action.href}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-border-strong bg-surface px-3 text-xs font-medium text-ink hover:bg-subtle"
                >
                  {action.label}
                  <ExternalLink size={11} />
                </a>
              ) : (
                <Button
                  key={`${action.label}-${index}`}
                  type="button"
                  onClick={() => action.prompt && onQuickAction?.(action.prompt)}
                  variant="outline"
                  size="sm"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}

          {citations.length > 0 && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer select-none hover:text-ink">
                {isThai ? 'แหล่งข้อมูล' : 'Sources'} ({citations.length})
              </summary>
              <div className="mt-1 space-y-0.5 text-ink">
                {citations.slice(0, 8).map((citation, index) => (
                  <div key={`${citation.source}-${citation.rm_code || index}`}>
                    {index + 1}. {citation.source}
                    {citation.rm_code ? ` · ${citation.rm_code}` : ''}
                    {citation.inci_name ? ` · ${citation.inci_name}` : ''}
                    {citation.score != null ? ` · ${(citation.score * 100).toFixed(0)}%` : ''}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Surface>
  );
}
