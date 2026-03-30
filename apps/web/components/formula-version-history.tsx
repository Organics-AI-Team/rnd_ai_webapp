"use client";

/**
 * FormulaVersionHistory — Timeline component showing the immutable version
 * audit trail for a formula. Each entry displays version number, change type,
 * who made the change (AI vs User), and when.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { trpc } from "@/lib/trpc-client";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  User,
  CheckCircle,
  PenLine,
  Plus,
  ArrowRight,
  History,
  RefreshCw,
} from "lucide-react";

/**
 * Props for FormulaVersionHistory.
 *
 * @param formula_id - The formula to display version logs for
 */
interface FormulaVersionHistoryProps {
  formula_id: string;
}

/**
 * Maps change type to display label and icon.
 *
 * @param change_type - The FormulaChangeType enum value
 * @returns Object with label, icon component, and color class
 */
function get_change_type_display(change_type: string) {
  console.log("[formula-version-history] get_change_type_display", { change_type });

  const display_map: Record<string, { label: string; icon: any; color: string }> = {
    created: { label: "Created", icon: Plus, color: "text-emerald-500" },
    revised: { label: "Revised", icon: RefreshCw, color: "text-violet-500" },
    edited: { label: "Edited", icon: PenLine, color: "text-blue-500" },
    confirmed: { label: "Confirmed", icon: CheckCircle, color: "text-emerald-600" },
    status_changed: { label: "Status Changed", icon: ArrowRight, color: "text-amber-500" },
  };

  return display_map[change_type] || { label: change_type, icon: History, color: "text-gray-400" };
}

/**
 * Renders the version history timeline for a formula.
 * Fetches logs from the formulaVersionLogs.list endpoint.
 *
 * @param props - FormulaVersionHistoryProps
 * @returns JSX element with timeline UI
 */
export function FormulaVersionHistory({ formula_id }: FormulaVersionHistoryProps) {
  console.log("[formula-version-history] render", { formula_id });

  const { data: logs, isLoading } = trpc.formulaVersionLogs.list.useQuery(
    { formulaId: formula_id },
    { enabled: !!formula_id }
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <div className="animate-spin rounded-full h-3 w-3 border border-gray-300 border-t-gray-600" />
        <span className="text-[11px] text-gray-400">Loading version history...</span>
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="text-center py-4">
        <History className="h-5 w-5 text-gray-200 mx-auto mb-1" />
        <p className="text-[11px] text-gray-400">No version history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <div className="flex items-center gap-1.5 mb-2">
        <History className="h-3.5 w-3.5 text-gray-400" />
        <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">
          Version History ({logs.length})
        </p>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gray-100" />

        <div className="space-y-1">
          {logs.map((log: any, idx: number) => {
            const display = get_change_type_display(log.changeType);
            const IconComponent = display.icon;
            const is_ai = log.updatedBySource === "ai";
            const version_label = log.version > 0 ? `v${String(log.version).padStart(2, "0")}` : "draft";
            const created_at = new Date(log.createdAt).toLocaleString("th-TH", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div key={log._id} className="relative flex items-start gap-2.5 pl-0">
                {/* Timeline dot */}
                <div className={`relative z-10 flex-shrink-0 w-[23px] h-[23px] rounded-full flex items-center justify-center ${
                  log.changeType === "confirmed" ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-gray-50 ring-1 ring-gray-200"
                }`}>
                  <IconComponent className={`h-3 w-3 ${display.color}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Version badge */}
                    <span className={`text-[10px] font-mono font-medium ${
                      log.changeType === "confirmed" ? "text-emerald-600" : "text-gray-400"
                    }`}>
                      {version_label}
                    </span>

                    {/* Change type */}
                    <span className={`text-[11px] font-medium ${display.color}`}>
                      {display.label}
                    </span>

                    {/* AI / User badge */}
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 font-normal ${
                        is_ai
                          ? "text-violet-500 border-violet-200/80 bg-violet-50/50"
                          : "text-blue-500 border-blue-200/80 bg-blue-50/50"
                      }`}
                    >
                      {is_ai ? (
                        <><Sparkles className="h-2.5 w-2.5 mr-0.5" /> AI</>
                      ) : (
                        <><User className="h-2.5 w-2.5 mr-0.5" /> User</>
                      )}
                    </Badge>
                  </div>

                  {/* Remarks */}
                  {log.remarks && (
                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{log.remarks}</p>
                  )}

                  {/* Timestamp + user */}
                  <p className="text-[10px] text-gray-300 mt-0.5">
                    {created_at} · {log.updatedByName}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
