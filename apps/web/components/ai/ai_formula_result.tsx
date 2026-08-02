'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, FilePlus2, Loader2 } from 'lucide-react';
import type { GeneratedFormula } from '@/lib/ai/formula-conversion';

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
  formula: GeneratedFormula;
  citations?: Array<{
    source: string;
    url?: string;
    rm_code?: string;
    inci_name?: string;
    trade_name?: string;
    score?: number;
  }>;
  quickActions?: Array<{ label: string; prompt?: string; href?: string }>;
  language?: 'th' | 'en';
  onQuickAction?: (prompt: string) => void;
  /** Saves this preview as an editable formula draft. */
  onConvertToFormula?: () => Promise<{ id: string; formulaCode?: string } | null>;
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
  onConvertToFormula,
}: FormulaResultProps) {
  const isThai = language !== 'en';
  const ingredients = Array.isArray(formula.ingredients) ? formula.ingredients.slice(0, 30) : [];
  const warnings = Array.isArray(formula.warnings) ? formula.warnings : [];
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFormula, setSavedFormula] = useState<{ id: string; formulaCode?: string } | null>(
    formula.formula_id ? { id: formula.formula_id, formulaCode: formula.formula_code } : null,
  );

  useEffect(() => {
    if (formula.formula_id) {
      setSavedFormula({ id: formula.formula_id, formulaCode: formula.formula_code });
    }
  }, [formula.formula_code, formula.formula_id]);

  const save_as_formula = async () => {
    if (!onConvertToFormula || isSaving || savedFormula) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await onConvertToFormula();
      if (!result) throw new Error(isThai ? 'ไม่สามารถบันทึกสูตรได้' : 'Unable to save this formula.');
      setSavedFormula(result);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : (isThai ? 'ไม่สามารถบันทึกสูตรได้' : 'Unable to save this formula.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-emerald-100/90 bg-white/90 shadow-[0_12px_32px_rgba(16,185,129,0.10)] backdrop-blur-sm">
      <div className="border-b border-emerald-100/80 bg-gradient-to-br from-emerald-50 via-white to-green-50 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-emerald-950">
              {text(formula.formula_name, isThai ? 'สูตร draft จาก AI' : 'AI draft formula')}
            </div>
            <div className="mt-0.5 text-[11px] text-emerald-700/70">
              {formula.formula_code && <span>{formula.formula_code} · </span>}
              {text(formula.product_type, isThai ? 'ไม่ระบุประเภท' : 'unspecified type')}
              {formula.batch_size_grams ? ` · ${formula.batch_size_grams} g` : ''}
            </div>
          </div>
          <div className="text-right text-[11px] text-emerald-800/70">
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
                className="rounded-full border border-emerald-200 bg-white/80 px-2 py-0.5 text-[10px] text-emerald-700"
              >
                {benefit}
              </span>
            ))}
          </div>
        )}
      </div>

      {ingredients.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[11px]">
            <thead className="border-b border-emerald-100 bg-emerald-50/50 text-emerald-800/60">
              <tr>
                <th className="px-3 py-2 font-medium">{isThai ? 'Phase' : 'Phase'}</th>
                <th className="px-3 py-2 font-medium">RM</th>
                <th className="px-3 py-2 font-medium">INCI / Trade</th>
                <th className="px-3 py-2 font-medium">{isThai ? 'หน้าที่' : 'Function'}</th>
                <th className="px-3 py-2 text-right font-medium">%</th>
                <th className="px-3 py-2 text-right font-medium">g</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-50">
              {ingredients.map((ing, index) => (
                <tr key={`${ing.rm_code || ing.inci_name || index}-${index}`} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-emerald-800/70">{text(ing.phase || ing.phase_label)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-emerald-800/70">{text(ing.rm_code)}</td>
                  <td className="min-w-48 px-3 py-2 text-emerald-950">
                    <div>{text(ing.inci_name || ing.trade_name)}</div>
                    {ing.inci_name && ing.trade_name && ing.inci_name !== ing.trade_name && (
                      <div className="text-emerald-700/55">{ing.trade_name}</div>
                    )}
                  </td>
                  <td className="min-w-36 px-3 py-2 text-emerald-800/70">{text(ing.function || ing.function_desc)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-950">
                    {fmtNumber(ing.percentage)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-800/70">
                    {fmtNumber(ing.amount_grams)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="border-t border-emerald-100 bg-amber-50/50 px-3 py-2">
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

      {(onConvertToFormula || savedFormula || quickActions.length > 0 || citations.length > 0) && (
        <div className="border-t border-emerald-100 px-3 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {savedFormula ? (
              <a
                href={`/formulas/create?edit=${savedFormula.id}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-emerald-600 to-green-600 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-[0_6px_14px_rgba(5,150,105,0.22)] transition-transform hover:-translate-y-0.5"
              >
                <Check size={13} />
                {isThai ? `บันทึกเป็น Draft${savedFormula.formulaCode ? ` · ${savedFormula.formulaCode}` : ''}` : `Saved draft${savedFormula.formulaCode ? ` · ${savedFormula.formulaCode}` : ''}`}
                <ExternalLink size={11} />
              </a>
            ) : onConvertToFormula && (
              <button
                type="button"
                onClick={save_as_formula}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-emerald-600 to-green-600 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-[0_6px_14px_rgba(5,150,105,0.22)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? <Loader2 size={13} className="animate-spin" /> : <FilePlus2 size={13} />}
                {isSaving ? (isThai ? 'กำลังสร้าง Draft...' : 'Creating draft...') : (isThai ? 'สร้างเป็นสูตร Draft' : 'Convert to formula draft')}
              </button>
            )}
            <span className="text-[10px] text-emerald-800/60">
              {isThai ? 'ตรวจสอบและแก้ไขได้ก่อนยืนยันสูตร' : 'Review and edit before confirming the formula.'}
            </span>
          </div>
          {saveError && <p role="alert" className="mb-2 text-[11px] text-red-600">{saveError}</p>}
          {quickActions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {quickActions.map((action, index) => action.href ? (
                <a
                  key={`${action.label}-${index}`}
                  href={action.href}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-100 bg-emerald-50/40 px-2 py-1 text-[11px] text-emerald-800 hover:bg-emerald-100/60"
                >
                  {action.label}
                  <ExternalLink size={11} />
                </a>
              ) : (
                <button
                  key={`${action.label}-${index}`}
                  type="button"
                  onClick={() => action.prompt && onQuickAction?.(action.prompt)}
                  className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-2 py-1 text-[11px] text-emerald-800 hover:bg-emerald-100/60"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {citations.length > 0 && (
            <details className="mt-2 text-[11px] text-emerald-800/55">
              <summary className="cursor-pointer select-none hover:text-emerald-800">
                {isThai ? 'แหล่งข้อมูล' : 'Sources'} ({citations.length})
              </summary>
              <div className="mt-1 space-y-0.5 text-emerald-800/70">
                {citations.slice(0, 8).map((citation, index) => (
                  <div key={`${citation.source}-${citation.url || citation.rm_code || index}`}>
                    {index + 1}. {citation.url ? (
                      <a href={citation.url} target="_blank" rel="noreferrer" className="underline hover:text-emerald-900">
                        {citation.source}
                      </a>
                    ) : citation.source}
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
    </div>
  );
}
