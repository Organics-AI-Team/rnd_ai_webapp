import { config } from "dotenv";
import { resolve } from "path";
import { MongoClient } from "mongodb";
import { hash } from "bcryptjs";

// Load .env.local
config({ path: resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/supplement_management";

async function seedAdmin() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("supplement_management");
    const usersCollection = db.collection("user");

    const adminEmail = process.env.ADMIN_EMAIL || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin";

    // Check if admin user already exists
    const existingAdmin = await usersCollection.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log("Admin user already exists");
      console.log("Email:", adminEmail);
      return;
    }

    // Hash the password
    const hashedPassword = await hash(adminPassword, 10);

    // Create admin user
    const adminUser = {
      id: "admin-001",
      email: adminEmail,
      name: "Administrator",
      emailVerified: true,
      image: null,
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await usersCollection.insertOne(adminUser);

    // Create password entry in account collection
    const accountsCollection = db.collection("account");
    await accountsCollection.insertOne({
      id: "admin-account-001",
      userId: "admin-001",
      accountId: adminEmail,
      providerId: "credential",
      password: hashedPassword,
      email: adminEmail,  // BetterAuth needs this field
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("✅ Admin user created successfully");
    console.log("Email:", adminEmail);
    console.log("Password:", adminPassword);

  } catch (error) {
    console.error("❌ Error seeding admin user:", error);
  } finally {
    await client.close();
  }
}

seedAdmin();
