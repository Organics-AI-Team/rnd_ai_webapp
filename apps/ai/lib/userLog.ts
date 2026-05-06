import { Db } from "mongodb";

interface LogActivityParams {
  db: Db;
  userId: string;
  userName?: string;
  activity: string;
  refId?: string;
  organizationId?: string;
}

export async function logActivity({
  db,
  userId,
  userName,
  activity,
  refId,
  organizationId,
}: LogActivityParams) {
  const now = new Date();

  // Format date as DD/MM/YYYY
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const date = `${day}/${month}/${year}`;

  // Format time as HH:mm
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const time = `${hours}:${minutes}`;

  await db.collection("user_logs").insertOne({
    date,
    time,
    userId,
    userName,
    activity,
    refId: refId || "",
    organizationId,
    createdAt: now,
  });
}
