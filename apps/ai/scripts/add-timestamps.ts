import clientPromise from "../lib/mongodb";

async function addTimestamps() {
  try {
    const client = await clientPromise;
    const db = client.db();

    const now = new Date();

    console.log("Adding timestamps to existing data...");

    // Update raw_materials_console (ingredients)
    const ingredientsResult = await db.collection("raw_materials_console").updateMany(
      {
        $or: [
          { createdAt: { $exists: false } },
          { updatedAt: { $exists: false } }
        ]
      },
      {
        $set: {
          createdAt: now,
          updatedAt: now,
        }
      }
    );

    console.log(`Updated ${ingredientsResult.modifiedCount} ingredients with timestamps`);

    // Update formulas
    const formulasResult = await db.collection("formulas").updateMany(
      {
        $or: [
          { createdAt: { $exists: false } },
          { updatedAt: { $exists: false } }
        ]
      },
      {
        $set: {
          createdAt: now,
          updatedAt: now,
        }
      }
    );

    console.log(`Updated ${formulasResult.modifiedCount} formulas with timestamps`);

    console.log("✅ All existing data has been updated with timestamps!");

    process.exit(0);
  } catch (error) {
    console.error("Error adding timestamps:", error);
    process.exit(1);
  }
}

addTimestamps();
