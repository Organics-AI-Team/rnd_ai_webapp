/**
 * Migration script to add rm_code to all documents in raw_meterials_console collection
 * that are missing this field.
 *
 * This script:
 * 1. Finds all documents without rm_code
 * 2. Assigns sequential RM codes starting from the highest existing code + 1
 * 3. Updates documents in batches for efficiency
 *
 * @author Claude Code
 * @date 2025-11-05
 */

import clientPromise from "../lib/mongodb";

/**
 * Main migration function to add rm_code to documents missing it
 */
async function addRmCodes() {
  console.log("🚀 Starting rm_code migration...\n");

  try {
    const client = await clientPromise;
    const db = client.db();

    // Step 1: Count total documents
    const totalCount = await db.collection("raw_meterials_console").countDocuments();
    console.log(`📊 Total documents in collection: ${totalCount}`);

    // Step 2: Count documents missing rm_code
    const missingFilter = {
      $or: [
        { rm_code: { $exists: false } },
        { rm_code: null },
        { rm_code: "" }
      ]
    };

    const missingCount = await db.collection("raw_meterials_console").countDocuments(missingFilter);
    console.log(`❌ Documents missing rm_code: ${missingCount}`);
    console.log(`✅ Documents with rm_code: ${totalCount - missingCount}\n`);

    if (missingCount === 0) {
      console.log("✨ All documents already have rm_code. Nothing to do!");
      process.exit(0);
    }

    // Step 3: Find the highest existing rm_code number
    let maxNumber = 0;

    const allDocuments = await db.collection("raw_meterials_console")
      .find({ rm_code: { $exists: true, $nin: [null, ""] } })
      .toArray();

    console.log(`🔍 Scanning ${allDocuments.length} existing rm_codes to find highest number...`);

    allDocuments.forEach((doc: any) => {
      if (doc.rm_code) {
        const match = doc.rm_code.toString().match(/(\d+)/);
        if (match) {
          const codeNumber = parseInt(match[1], 10);
          if (codeNumber > maxNumber) {
            maxNumber = codeNumber;
          }
        }
      }
    });

    console.log(`🎯 Highest existing rm_code number: ${maxNumber}`);
    console.log(`📝 Will start assigning from: RM${String(maxNumber + 1).padStart(6, '0')}\n`);

    // Step 4: Get all documents missing rm_code
    const documentsToUpdate = await db.collection("raw_meterials_console")
      .find(missingFilter)
      .toArray();

    console.log(`🔄 Processing ${documentsToUpdate.length} documents...\n`);

    // Step 5: Update documents with new rm_codes
    let updatedCount = 0;
    const batchSize = 100;

    for (let i = 0; i < documentsToUpdate.length; i++) {
      const doc = documentsToUpdate[i];
      const newRmCode = `RM${String(maxNumber + 1 + i).padStart(6, '0')}`;

      await db.collection("raw_meterials_console").updateOne(
        { _id: doc._id },
        {
          $set: {
            rm_code: newRmCode,
            updatedAt: new Date()
          }
        }
      );

      updatedCount++;

      // Log progress every batch
      if (updatedCount % batchSize === 0) {
        console.log(`  ✓ Updated ${updatedCount}/${documentsToUpdate.length} documents...`);
      }

      // Show sample of first 5 updates
      if (i < 5) {
        const tradeName = doc.trade_name || doc.INCI_name || doc.inci_name || 'N/A';
        console.log(`  → Assigned ${newRmCode} to "${tradeName.substring(0, 50)}${tradeName.length > 50 ? '...' : ''}"`);
      }
    }

    console.log(`\n✅ Successfully updated ${updatedCount} documents with rm_codes!`);

    // Step 6: Verify the update
    const stillMissingCount = await db.collection("raw_meterials_console").countDocuments(missingFilter);

    if (stillMissingCount === 0) {
      console.log("🎉 Migration completed successfully! All documents now have rm_codes.");
    } else {
      console.warn(`⚠️  Warning: ${stillMissingCount} documents still missing rm_code. Please check logs.`);
    }

    console.log(`\n📈 Final Statistics:`);
    console.log(`   - Total documents: ${totalCount}`);
    console.log(`   - Documents updated: ${updatedCount}`);
    console.log(`   - Highest rm_code number: RM${String(maxNumber + documentsToUpdate.length).padStart(6, '0')}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during migration:", error);
    process.exit(1);
  }
}

// Execute migration
addRmCodes();
