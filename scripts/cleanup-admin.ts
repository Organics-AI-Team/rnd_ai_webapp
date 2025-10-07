import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/supplement_management";

async function cleanupAdmin() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("supplement_management");

    // Delete old admin user
    await db.collection("user").deleteMany({ id: "admin-001" });
    await db.collection("account").deleteMany({ userId: "admin-001" });

    console.log("✅ Cleaned up old admin user");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await client.close();
  }
}

cleanupAdmin();
