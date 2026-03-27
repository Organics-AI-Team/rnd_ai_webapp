import { Badge } from "./badge";

interface StatusBadgeProps {
  status: string;
  statusConfig?: Record<string, { label: string; className: string }>;
}

const defaultStatusConfig = {
  pending: { label: "Pending", className: "bg-amber-50 text-amber-700 border-amber-200" },
  processing: { label: "Processing", className: "bg-blue-50 text-blue-700 border-blue-200" },
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelled", className: "bg-red-50 text-red-700 border-red-200" },
  draft: { label: "Draft", className: "bg-gray-50 text-gray-600 border-gray-200" },
  testing: { label: "Testing", className: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "Rejected", className: "bg-red-50 text-red-700 border-red-200" },
  admin: { label: "Admin", className: "bg-blue-50 text-blue-700 border-blue-200" },
  shipper: { label: "Shipper", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  member: { label: "Member", className: "bg-violet-50 text-violet-700 border-violet-200" },
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  inactive: { label: "Inactive", className: "bg-gray-50 text-gray-600 border-gray-200" },
  archived: { label: "Archived", className: "bg-gray-50 text-gray-600 border-gray-200" },
};

export function StatusBadge({
  status,
  statusConfig = defaultStatusConfig
}: StatusBadgeProps) {
  const statusInfo = statusConfig[status] || {
    label: status,
    className: "bg-gray-50 text-gray-600 border-gray-200"
  };

  return (
    <Badge variant="outline" className={statusInfo.className}>
      {statusInfo.label}
    </Badge>
  );
}
