import { MongoClient } from "mongodb";

// Get MongoDB URI with fallback for build time
// During build, MONGODB_URI might not be set yet (it's injected at runtime)
const uri = process.env.MONGODB_URI;

// Only throw error at runtime when actually trying to connect
// This allows the build to succeed without MONGODB_URI
if (!uri) {
  console.warn('Warning: MONGODB_URI is not set. Database connections will fail.');
}

const options = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

// Only create connection if URI is available
if (uri) {
  if (process.env.NODE_ENV === "development") {
    let globalWithMongo = global as typeof globalThis & {
      _mongoClientPromise?: Promise<MongoClient>;
    };

    if (!globalWithMongo._mongoClientPromise) {
      client = new MongoClient(uri, options);
      globalWithMongo._mongoClientPromise = client.connect();
    }
    clientPromise = globalWithMongo._mongoClientPromise;
  } else {
    client = new MongoClient(uri, options);
    clientPromise = client.connect();
  }
} else {
  // Create a rejected promise that will fail if actually used
  // This allows build to complete but will error at runtime if DB is accessed
  clientPromise = Promise.reject(
    new Error('MONGODB_URI environment variable is not set')
  );
}

export default clientPromise;
