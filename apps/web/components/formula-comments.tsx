"use client";

/**
 * FormulaComments — Comment thread component for formula detail view.
 * Displays comments with type badges, supports creating new comments
 * with a type selector, and provides an "Ask AI to Revise" action.
 *
 * @author AI Management System
 * @date 2026-03-30
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Send,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
  StickyNote,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormulaCommentsProps {
  /** MongoDB ObjectId string of the formula */
  formula_id: string;
  /** Current user's name for display */
  user_name?: string;
}

/** Comment type metadata for display */
const COMMENT_TYPE_CONFIG: Record<string, {
  label: string;
  icon: typeof MessageSquare;
  badge_class: string;
}> = {
  feedback: {
    label: "Feedback",
    icon: MessageSquare,
    badge_class: "bg-gray-50 text-gray-600 border-gray-200",
  },
  suggestion: {
    label: "Suggestion",
    icon: Lightbulb,
    badge_class: "bg-blue-50 text-blue-700 border-blue-200",
  },
  approval: {
    label: "Approval",
    icon: ThumbsUp,
    badge_class: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  rejection: {
    label: "Rejection",
    icon: ThumbsDown,
    badge_class: "bg-red-50 text-red-700 border-red-200",
  },
  revision_note: {
    label: "AI Revision",
    icon: Sparkles,
    badge_class: "bg-purple-50 text-purple-700 border-purple-200",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render a comment thread for a formula with create/delete capabilities.
 *
 * @param formula_id - The formula to show comments for
 * @param user_name  - Display name for the current user
 * @returns JSX element with comment list and input form
 */
export function FormulaComments({ formula_id, user_name }: FormulaCommentsProps) {
  const [new_comment, set_new_comment] = useState("");
  const [comment_type, set_comment_type] = useState<string>("feedback");
  const [is_submitting, set_is_submitting] = useState(false);

  const utils = trpc.useUtils();

  // --- Queries ---
  const { data: comments, isLoading: comments_loading } =
    trpc.formulaComments.list.useQuery({ formulaId: formula_id });

  const { data: comment_count } =
    trpc.formulaComments.count.useQuery({ formulaId: formula_id });

  // --- Mutations ---
  const create_comment = trpc.formulaComments.create.useMutation({
    onSuccess: () => {
      console.log("[FormulaComments] create_comment — success");
      set_new_comment("");
      set_comment_type("feedback");
      utils.formulaComments.list.invalidate({ formulaId: formula_id });
      utils.formulaComments.count.invalidate({ formulaId: formula_id });
    },
    onError: (error) => {
      console.error("[FormulaComments] create_comment — error", error.message);
    },
  });

  const delete_comment = trpc.formulaComments.delete.useMutation({
    onSuccess: () => {
      console.log("[FormulaComments] delete_comment — success");
      utils.formulaComments.list.invalidate({ formulaId: formula_id });
      utils.formulaComments.count.invalidate({ formulaId: formula_id });
    },
  });

  /**
   * Submit a new comment to the formula.
   */
  const handle_submit = async () => {
    if (!new_comment.trim()) return;
    console.log("[FormulaComments] handle_submit — start", { formula_id, comment_type });

    set_is_submitting(true);
    try {
      await create_comment.mutateAsync({
        formulaId: formula_id,
        content: new_comment.trim(),
        commentType: comment_type as any,
      });
    } finally {
      set_is_submitting(false);
    }
  };

  /**
   * Delete a comment with confirmation.
   *
   * @param comment_id - MongoDB ObjectId of the comment
   */
  const handle_delete = async (comment_id: string) => {
    if (!confirm("Delete this comment?")) return;
    console.log("[FormulaComments] handle_delete — start", { comment_id });
    await delete_comment.mutateAsync({ commentId: comment_id });
  };

  /**
   * Format a date for display.
   *
   * @param date - Date string or Date object
   * @returns Formatted date string
   */
  const format_date = (date: any): string => {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-3">
      {/* Header with count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-gray-500" />
          <p className="text-xs font-medium text-gray-700">
            Comments ({comment_count?.total || 0})
          </p>
        </div>
        {comment_count && comment_count.total > 0 && (
          <div className="flex gap-1">
            {Object.entries(comment_count.by_type || {}).map(([type, count]) => {
              const config = COMMENT_TYPE_CONFIG[type];
              if (!config) return null;
              return (
                <Badge key={type} variant="outline" className={`text-2xs ${config.badge_class}`}>
                  {config.label}: {count as number}
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {/* Comment List */}
      {comments_loading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-900 border-t-transparent mx-auto" />
        </div>
      ) : comments && comments.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {comments.map((comment: any) => {
            const type_config = COMMENT_TYPE_CONFIG[comment.commentType] || COMMENT_TYPE_CONFIG.feedback;
            const TypeIcon = type_config.icon;

            return (
              <div
                key={comment._id?.toString()}
                className="bg-gray-50 rounded-md p-2.5 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <TypeIcon className="h-3 w-3 text-gray-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-gray-700 truncate">
                      {comment.userName}
                    </span>
                    <Badge variant="outline" className={`text-2xs flex-shrink-0 ${type_config.badge_class}`}>
                      {type_config.label}
                    </Badge>
                    <span className="text-2xs text-gray-400 flex-shrink-0">
                      {format_date(comment.createdAt)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={() => handle_delete(comment._id?.toString())}
                  >
                    <Trash2 className="h-3 w-3 text-red-400" />
                  </Button>
                </div>
                <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">
                  {comment.content}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-3">
          <MessageSquare className="h-5 w-5 text-gray-300 mx-auto mb-1" />
          <p className="text-2xs text-gray-400">No comments yet</p>
        </div>
      )}

      {/* New Comment Form */}
      <div className="border rounded-md p-2.5 space-y-2">
        <div className="flex gap-2">
          <Select value={comment_type} onValueChange={set_comment_type}>
            <SelectTrigger className="w-32 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="feedback">Feedback</SelectItem>
              <SelectItem value="suggestion">Suggestion</SelectItem>
              <SelectItem value="approval">Approval</SelectItem>
              <SelectItem value="rejection">Rejection</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Textarea
          placeholder="Add a comment..."
          value={new_comment}
          onChange={(e) => set_new_comment(e.target.value)}
          className="min-h-[60px] text-xs resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handle_submit();
            }
          }}
        />
        <div className="flex justify-between items-center">
          <p className="text-2xs text-gray-400">⌘+Enter to submit</p>
          <Button
            size="sm"
            onClick={handle_submit}
            disabled={!new_comment.trim() || is_submitting}
            className="h-7 text-xs"
          >
            {is_submitting ? (
              <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent mr-1" />
            ) : (
              <Send className="h-3 w-3 mr-1" />
            )}
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
