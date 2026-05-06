import { Db } from "mongodb";

interface LogProductActivityParams {
  db: Db;
  productId: string;
  productCode: string;
  productName: string;
  action: "create" | "update" | "add_stock" | "reduce_stock" | "delete";
  quantityChange?: number;
  previousStock?: number;
  newStock?: number;
  userId: string;
  userName?: string;
  organizationId: string;
  refId?: string;
  notes?: string;
}

export async function logProductActivity({
  db,
  productId,
  productCode,
  productName,
  action,
  quantityChange,
  previousStock,
  newStock,
  userId,
  userName,
  organizationId,
  refId,
  notes,
}: LogProductActivityParams) {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const date = `${day}/${month}/${year}`;

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const time = `${hours}:${minutes}`;

  await db.collection("product_logs").insertOne({
    date,
    time,
    productId,
    productCode,
    productName,
    action,
    quantityChange: quantityChange || null,
    previousStock: previousStock !== undefined ? previousStock : null,
    newStock: newStock !== undefined ? newStock : null,
    userId,
    userName: userName || "",
    organizationId,
    refId: refId || "",
    notes: notes || "",
    createdAt: now,
  });
}
