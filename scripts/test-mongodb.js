/**
 * Test script to debug MongoDB connection and raw_materials_console data
 */

require('dotenv').config({ path: '.env.local' });
const { MongoClient } = require('mongodb');

async function testMongoDB() {
  try {
    console.log('Testing MongoDB connection...');
    console.log('MONGODB_URI exists:', process.env.MONGODB_URI ? 'Yes' : 'No');

    const uri = process.env.MONGODB_URI;
    const dbName = 'rnd_ai'; // Use the database name from the API route

    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB successfully');

    const db = client.db(dbName);
    console.log('Using database:', dbName);

    // List all collections
    const collections = await db.listCollections().toArray();
    console.log('\nAvailable collections:');
    if (collections.length === 0) {
      console.log('No collections found');
    } else {
      collections.forEach(collection => {
        console.log(`- ${collection.name}`);
      });
    }

    // Check for raw_materials_console specifically
    console.log('\nChecking raw_materials_console collection...');

    const rawMaterialsCollection = db.collection('raw_materials_console');
    const count = await rawMaterialsCollection.countDocuments();
    console.log(`Documents in raw_materials_console: ${count}`);

    if (count > 0) {
      // Get a sample document to understand the structure
      const sample = await rawMaterialsCollection.findOne();
      console.log('\nSample document structure:');
      console.log('Keys:', Object.keys(sample));

      // Show some key fields if they exist
      const fields = ['rm_code', 'trade_name', 'inci_name', 'supplier', 'benefits', 'details'];
      console.log('\nSample data:');
      fields.forEach(field => {
        if (sample[field]) {
          console.log(`${field}: ${sample[field]}`);
        }
      });

      // Check for alternative collection names if this one is empty
    } else {
      console.log('raw_materials_console is empty, checking alternative collections...');

      const alternativeNames = ['raw_materials', 'materials', 'ingredients', 'products'];

      for (const collectionName of alternativeNames) {
        try {
          const altCollection = db.collection(collectionName);
          const altCount = await altCollection.countDocuments();
          console.log(`${collectionName}: ${altCount} documents`);

          if (altCount > 0) {
            const sample = await altCollection.findOne();
            console.log(`  Sample keys in ${collectionName}:`, Object.keys(sample));
          }
        } catch (error) {
          console.log(`  ${collectionName}: Error - ${error.message}`);
        }
      }
    }

    await client.close();
    console.log('\n✓ MongoDB test completed');

  } catch (error) {
    console.error('MongoDB connection error:', error.message);
  }
}

testMongoDB().catch(console.error);