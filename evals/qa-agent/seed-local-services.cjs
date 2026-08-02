#!/usr/bin/env node
/*
 * Seed the isolated local QA backing services.
 *
 * The guards below deliberately refuse to modify anything except the QA-only
 * MongoDB/Qdrant endpoints declared in local-services.compose.yml.
 */
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const QA_MONGO_URI = 'mongodb://127.0.0.1:27027';
const QA_QDRANT_URL = 'http://127.0.0.1:6335';
const COLLECTION = 'raw_materials_myskin';

function load_local_env() {
  const file_path = path.resolve(__dirname, '..', '..', '.env.local');
  if (!fs.existsSync(file_path)) return;

  for (const line of fs.readFileSync(file_path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].replace(/^(?:"|')|(?:"|')$/g, '');
    process.env[match[1]] = value;
  }
}

function assert_qa_endpoints() {
  if (process.env.QA_MONGO_URI && process.env.QA_MONGO_URI !== QA_MONGO_URI) {
    throw new Error('QA_MONGO_URI must be mongodb://127.0.0.1:27027.');
  }
  if (process.env.QA_QDRANT_URL && process.env.QA_QDRANT_URL !== QA_QDRANT_URL) {
    throw new Error('QA_QDRANT_URL must be http://127.0.0.1:6335.');
  }
}

const materials = [
  {
    rm_code: 'RM-QA-001',
    trade_name: 'Niacinamide QA',
    inci_name: 'Niacinamide',
    supplier: 'QA Materials',
    category: 'active skin conditioning brightening barrier support',
    benefits: 'Niacinamide supports skin barrier care, visible pore appearance, oil balance, and an even-looking complexion. Suitable for oily skin serum formulation. ไนอะซินาไมด์ช่วยเสริมเกราะป้องกันผิวและควบคุมความมัน',
    details: 'QA reference material for a niacinamide serum for oily skin.',
    rm_cost: 520,
    usage_min_pct: 2,
    usage_max_pct: 10,
  },
  {
    rm_code: 'RM-QA-002',
    trade_name: 'Glycerin QA',
    inci_name: 'Glycerin',
    supplier: 'QA Materials',
    category: 'humectant water phase hydrating base',
    benefits: 'Glycerin is a humectant that helps attract water and support hydration in skincare. กลีเซอรีนเป็น humectant ช่วยดึงความชุ่มชื้นเข้าสู่ผิว',
    details: 'Water-phase humectant for serum formulation.',
    rm_cost: 95,
    usage_min_pct: 1,
    usage_max_pct: 10,
  },
  {
    rm_code: 'RM-QA-003',
    trade_name: 'CCT QA',
    inci_name: 'Caprylic/Capric Triglyceride',
    supplier: 'QA Materials',
    category: 'emollient oil ester lipid phase',
    benefits: 'Lightweight emollient oil for a non-greasy serum or cream formulation.',
    details: 'Oil-phase emollient for cosmetic formulation.',
    rm_cost: 210,
    usage_min_pct: 1,
    usage_max_pct: 10,
  },
  {
    rm_code: 'RM-QA-004',
    trade_name: 'Olivem QA',
    inci_name: 'Cetearyl Olivate (and) Sorbitan Olivate',
    supplier: 'QA Materials',
    category: 'emulsifier co-emulsifier surfactant',
    benefits: 'Emulsifier for stable cosmetic emulsions and serum-cream formulations.',
    details: 'Emulsifier phase support for formulation.',
    rm_cost: 395,
    usage_min_pct: 2,
    usage_max_pct: 8,
  },
  {
    rm_code: 'RM-QA-005',
    trade_name: 'PE QA',
    inci_name: 'Phenoxyethanol',
    supplier: 'QA Materials',
    category: 'preservative antimicrobial',
    benefits: 'Broad-spectrum preservative support for water-containing cosmetic formulations.',
    details: 'Preservative phase ingredient.',
    rm_cost: 310,
    usage_min_pct: 0.5,
    usage_max_pct: 1,
  },
  {
    rm_code: 'RM-QA-006',
    trade_name: 'Citric Acid QA',
    inci_name: 'Citric Acid',
    supplier: 'QA Materials',
    category: 'pH adjuster buffer',
    benefits: 'pH adjustment and buffering for cosmetic formulations.',
    details: 'pH adjuster phase ingredient.',
    rm_cost: 80,
    usage_min_pct: 0.05,
    usage_max_pct: 0.5,
  },
  {
    rm_code: 'RM-QA-007',
    trade_name: 'Zinc PCA QA',
    inci_name: 'Zinc PCA',
    supplier: 'QA Materials',
    category: 'active sebum control oily skin',
    benefits: 'Active ingredient that supports oily-skin and sebum-control serum concepts.',
    details: 'Active phase material for oily skin formulations.',
    rm_cost: 780,
    usage_min_pct: 0.1,
    usage_max_pct: 1,
  },
];

function material_text(material) {
  return [
    material.rm_code,
    material.trade_name,
    material.inci_name,
    material.category,
    material.benefits,
    material.details,
    'cosmetic ingredient formulation QA reference',
  ].join(' | ');
}

async function create_embeddings() {
  const api_key = process.env.GEMINI_API_KEY;
  if (!api_key) throw new Error('GEMINI_API_KEY is required to seed QA vectors.');

  const model = new GoogleGenerativeAI(api_key).getGenerativeModel({ model: 'gemini-embedding-001' });
  const response = await model.batchEmbedContents({
    requests: materials.map((material) => ({
      content: { role: 'user', parts: [{ text: material_text(material) }] },
    })),
  });
  const vectors = response.embeddings.map((embedding) => embedding.values);
  if (vectors.length !== materials.length || !vectors.every((vector) => vector.length === 3072)) {
    throw new Error('Unexpected Gemini embedding shape; expected one 3072-dimension vector per QA material.');
  }
  return vectors;
}

async function seed_mongo() {
  const client = new MongoClient(QA_MONGO_URI);
  await client.connect();
  try {
    const raw_materials = client.db('raw_materials');
    const rnd_ai = client.db('rnd_ai');
    await raw_materials.collection('raw_materials_real_stock').deleteMany({ qa_seed: true });
    await raw_materials.collection('raw_materials_real_stock').insertOne({
      qa_seed: true,
      rm_code: 'RM-100',
      trade_name: 'QA Niacinamide Stock',
      INCI_name: 'Niacinamide',
      supplier: 'QA Materials',
      rm_cost: 520,
      stock_status: 'in_stock',
    });
    await rnd_ai.collection('raw_materials_myskin').deleteMany({ qa_seed: true });
    await rnd_ai.collection('raw_materials_myskin').insertMany(materials.map((material) => ({ ...material, qa_seed: true })));
  } finally {
    await client.close();
  }
}

async function seed_qdrant(vectors) {
  const qdrant = new QdrantClient({ url: QA_QDRANT_URL });
  await qdrant.deleteCollection(COLLECTION).catch((error) => {
    if (error?.status !== 404) throw error;
  });
  await qdrant.createCollection(COLLECTION, {
    vectors: { size: 3072, distance: 'Cosine' },
    on_disk_payload: true,
  });
  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: materials.map((material, index) => ({
      id: index + 1,
      vector: vectors[index],
      payload: material,
    })),
  });
}

async function main() {
  assert_qa_endpoints();
  load_local_env();
  const vectors = await create_embeddings();
  await Promise.all([seed_mongo(), seed_qdrant(vectors)]);
  console.info(JSON.stringify({
    seeded: true,
    mongo: 'mongodb://127.0.0.1:27027',
    qdrant: 'http://127.0.0.1:6335',
    materials: materials.length,
    stock_records: 1,
    vector_dimensions: vectors[0].length,
  }));
}

main().catch((error) => {
  console.error(`[qa-seed] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
