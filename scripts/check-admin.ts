import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/supplement_management";

async function checkAdmin() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("supplement_management");

    const user = await db.collection("user").findOne({ id: "admin-001" });
    console.log("User:", JSON.stringify(user, null, 2));

    const account = await db.collection("account").findOne({ userId: "admin-001" });
    console.log("Account:", JSON.stringify(account, null, 2));

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await client.close();
  }
}

checkAdmin();
