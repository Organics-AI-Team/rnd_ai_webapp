import { Badge } from "./badge";

interface StatusBadgeProps {
  status: string;
  statusConfig?: Record<string, { label: string; className: string }>;
}

const defaultStatusConfig = {
  // Order statuses
  pending: { label: "รอดำเนินการ", className: "bg-yellow-100 text-yellow-800" },
  processing: { label: "กำลังดำเนินการ", className: "bg-blue-100 text-blue-800" },
  completed: { label: "เสร็จสิ้น", className: "bg-green-100 text-green-800" },
  cancelled: { label: "ยกเลิก", className: "bg-red-100 text-red-800" },

  // Formula statuses
  draft: { label: "ฉบับร่าง", className: "bg-gray-100 text-gray-800" },
  testing: { label: "ทดสอบ", className: "bg-yellow-100 text-yellow-800" },
  approved: { label: "อนุมัติ", className: "bg-green-100 text-green-800" },
  rejected: { label: "ปฏิเสธ", className: "bg-red-100 text-red-800" },

  // User roles
  admin: { label: "ผู้ดูแลระบบ", className: "bg-blue-100 text-blue-800" },
  shipper: { label: "พนักงานจัดส่ง", className: "bg-green-100 text-green-800" },
  member: { label: "พนักงานจัดซื้อ", className: "bg-purple-100 text-purple-800" },

  // General statuses
  active: { label: "ใช้งานอยู่", className: "bg-green-100 text-green-800" },
  inactive: { label: "ไม่ใช้งาน", className: "bg-gray-100 text-gray-800" },
  archived: { label: "เก็บถาวร", className: "bg-gray-100 text-gray-800" },
};

export function StatusBadge({
  status,
  statusConfig = defaultStatusConfig
}: StatusBadgeProps) {
  const statusInfo = statusConfig[status] || {
    label: status,
    className: "bg-gray-100 text-gray-800"
  };

  return (
    <Badge variant="secondary" className={statusInfo.className}>
      {statusInfo.label}
    </Badge>
  );
}