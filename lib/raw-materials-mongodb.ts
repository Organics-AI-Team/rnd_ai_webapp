import { MongoClient } from "mongodb";

// Get MongoDB URI for raw materials real stock database
const uri = process.env.RAW_MATERIALS_REAL_STOCK_MONGODB_URI || process.env.MONGODB_URI;

if (!uri) {
  console.warn('Warning: RAW_MATERIALS_REAL_STOCK_MONGODB_URI or MONGODB_URI is not set. Raw materials real stock database connections will fail.');
}

const options = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

// Only create connection if URI is available
if (uri) {
  if (process.env.NODE_ENV === "development") {
    let globalWithMongo = global as typeof globalThis & {
      _rawMaterialsMongoClientPromise?: Promise<MongoClient>;
    };

    if (!globalWithMongo._rawMaterialsMongoClientPromise) {
      client = new MongoClient(uri, options);
      globalWithMongo._rawMaterialsMongoClientPromise = client.connect();
    }
    clientPromise = globalWithMongo._rawMaterialsMongoClientPromise;
  } else {
    client = new MongoClient(uri, options);
    clientPromise = client.connect();
  }
} else {
  // Create a rejected promise that will fail if actually used
  clientPromise = Promise.reject(
    new Error('RAW_MATERIALS_REAL_STOCK_MONGODB_URI environment variable is not set')
  );
}

export default clientPromise;