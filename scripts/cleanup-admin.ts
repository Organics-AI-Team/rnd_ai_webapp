import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ewms";

async function cleanupAdmin() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("ewms");

    // Delete old legacy collections (no longer used)
    await db.collection("user").drop().catch(() => console.log("Collection 'user' doesn't exist"));
    await db.collection("account").drop().catch(() => console.log("Collection 'account' doesn't exist"));

    console.log("✅ Cleaned up legacy collections (user, account)");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await client.close();
  }
}

cleanupAdmin();
