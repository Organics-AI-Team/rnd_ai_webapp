import { config } from "dotenv";
import { resolve } from "path";
import { compare } from "bcryptjs";

// Load .env.local
config({ path: resolve(process.cwd(), ".env.local") });

const storedHash = "$2b$10$3ZqbtCEQ8XtzgwOGXeOaXOdjHZgiCl/WpGf2z1qkSCcFbN2CbpELO";
const passwordToTest = process.env.ADMIN_PASSWORD || "admin";

async function verifyPassword() {
  const result = await compare(passwordToTest, storedHash);
  if (result) {
    console.log("✅ Password verification successful");
  } else {
    console.log("❌ Password verification failed");
  }
}

verifyPassword();
