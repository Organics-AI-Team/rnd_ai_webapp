/**
 * Seed a starter catalog of real cosmetic raw materials into the tenant
 * `products` collection so the formula builder has ingredients to pick.
 * Idempotent by (tenantId, productCode). Safe to re-run.
 */
import client_promise from "@rnd-ai/shared-database";

const TENANT_ID = process.argv.find(a => a.startsWith("--tenant="))?.slice(9) ?? "";
const ACTOR = process.argv.find(a => a.startsWith("--actor="))?.slice(8) ?? "";
if (!TENANT_ID || !ACTOR) { console.error("need --tenant= and --actor="); process.exit(1); }

const now = new Date();
const M = (
  code: string, name: string, inci: string, cas: string, desc: string,
  price: number, supplier: string, benefits: string[], usecase: string[],
) => ({
  tenantId: TENANT_ID, actorProfileId: ACTOR, ownerProfileId: ACTOR,
  productCode: code, productName: name, INCI_name: inci, cas_no: cas,
  description: desc, price, supplier, benefits, usecase,
  stockQuantity: 1000, lowStockThreshold: 50, isActive: true,
  createdAt: now, updatedAt: now,
});

const catalog = [
  M("RM000001","Niacinamide","Niacinamide","98-92-0","Vitamin B3; brightening & barrier support",850,"DSM",["brightening","barrier repair","oil control"],["serum","cream","toner"]),
  M("RM000002","Hyaluronic Acid (LMW)","Sodium Hyaluronate","9067-32-7","Low-MW hyaluronic acid humectant",4200,"Bloomage",["hydration","plumping"],["serum","essence"]),
  M("RM000003","Vitamin C (SAP)","Sodium Ascorbyl Phosphate","66170-10-3","Stable vitamin C derivative",1800,"DSM",["brightening","antioxidant"],["serum","cream"]),
  M("RM000004","Retinol 50C","Retinol","68-26-8","Encapsulated retinol 50%",9500,"BASF",["anti-aging","cell turnover"],["serum","night cream"]),
  M("RM000005","Panthenol","Panthenol","81-13-0","Provitamin B5; soothing humectant",620,"DSM",["soothing","hydration"],["serum","lotion","toner"]),
  M("RM000006","Allantoin","Allantoin","97-59-6","Soothing, keratolytic",450,"Merck",["soothing","healing"],["cream","lotion"]),
  M("RM000007","Glycerin USP","Glycerin","56-81-5","Humectant, vegetable-derived",120,"Emery",["hydration"],["all"]),
  M("RM000008","Centella Extract","Centella Asiatica Extract","84696-21-9","Cica; calming & repair",1350,"Biospectrum",["soothing","barrier repair"],["serum","cream"]),
  M("RM000009","Salicylic Acid","Salicylic Acid","69-72-7","BHA exfoliant",380,"Alfa Aesar",["exfoliation","oil control","anti-acne"],["toner","serum"]),
  M("RM000010","Alpha Arbutin","Alpha-Arbutin","84380-01-8","Tyrosinase inhibitor; brightening",5200,"Pentapharm",["brightening","spot correction"],["serum"]),
  M("RM000011","Tocopheryl Acetate","Tocopheryl Acetate","7695-91-2","Vitamin E; antioxidant",720,"BASF",["antioxidant","conditioning"],["cream","oil"]),
  M("RM000012","Squalane (Olive)","Squalane","111-01-3","Lightweight emollient",980,"Kishimoto",["moisturizing","conditioning"],["oil","cream"]),
  M("RM000013","Ceramide NP","Ceramide NP","100403-19-8","Barrier lipid",8800,"Evonik",["barrier repair","hydration"],["cream","serum"]),
  M("RM000014","Adenosine","Adenosine","58-61-7","Anti-wrinkle active",6400,"Pharmazell",["anti-aging","firming"],["serum","cream"]),
  M("RM000015","Zinc PCA","Zinc PCA","15454-75-8","Sebum-regulating",890,"Ajinomoto",["oil control","anti-acne"],["toner","serum"]),
  M("RM000016","Xanthan Gum","Xanthan Gum","11138-66-2","Natural thickener",340,"CP Kelco",["texture"],["gel","cream"]),
  M("RM000017","Carbomer 940","Carbomer","9007-20-9","Gel-forming rheology modifier",520,"Lubrizol",["texture"],["gel","serum"]),
  M("RM000018","Phenoxyethanol","Phenoxyethanol","122-99-6","Broad-spectrum preservative",280,"Ashland",["preservative"],["all"]),
  M("RM000019","Cetyl Alcohol","Cetyl Alcohol","36653-82-4","Emollient co-emulsifier",210,"KLK",["texture","conditioning"],["cream","lotion"]),
  M("RM000020","Glyceryl Stearate SE","Glyceryl Stearate SE","11099-07-3","Self-emulsifier",260,"Croda",["emulsification"],["cream","lotion"]),
  M("RM000021","Niacinamide + Zinc Blend","Niacinamide","98-92-0","Blemish blend",1100,"In-house",["oil control","brightening"],["serum"]),
  M("RM000022","Bakuchiol","Bakuchiol","10309-37-2","Retinol alternative",15200,"Sytheon",["anti-aging"],["serum","cream"]),
  M("RM000023","Aloe Vera 200x","Aloe Barbadensis Leaf Extract","85507-69-3","Soothing botanical",320,"Terry Labs",["soothing","hydration"],["gel","toner"]),
  M("RM000024","Green Tea Extract","Camellia Sinensis Leaf Extract","84650-60-2","Polyphenol antioxidant",760,"Bioland",["antioxidant","soothing"],["serum","toner"]),
];

(async () => {
  const c = await client_promise; const db = c.db();
  const col = db.collection("products");
  let inserted = 0, skipped = 0;
  for (const m of catalog) {
    const r = await col.updateOne(
      { tenantId: TENANT_ID, productCode: m.productCode },
      { $setOnInsert: m },
      { upsert: true },
    );
    if (r.upsertedCount) inserted++; else skipped++;
  }
  const total = await col.countDocuments({ tenantId: TENANT_ID });
  console.log(`seed:products — inserted=${inserted} skipped=${skipped} tenant_total=${total}`);
  await c.close();
})();
