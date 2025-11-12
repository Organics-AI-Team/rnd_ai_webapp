/**
 * Utility functions for generating auto-incrementing codes
 */

export interface CodeGenerationOptions {
  prefix: string;
  padding?: number;
  collectionName: string;
  codeField: string;
}

export async function generateNextCode(
  db: any,
  collectionName: string,
  codeField: string,
  prefix: string,
  padding: number = 6
): Promise<{ nextCode: string; maxNumber: number }> {
  try {
    // Get total count for baseline
    const totalCount = await db.collection(collectionName).countDocuments();

    // Find the latest item to get the highest number
    const latestItem = await db.collection(collectionName)
      .find({})
      .sort({ _id: -1 })
      .limit(1)
      .toArray();

    let maxNumber = totalCount;

    if (latestItem.length > 0 && latestItem[0][codeField]) {
      const match = latestItem[0][codeField].toString().match(/(\d+)/);
      if (match) {
        const codeNumber = parseInt(match[1], 10);
        maxNumber = Math.max(maxNumber, codeNumber);
      }
    }

    const nextCode = `${prefix}${String(maxNumber + 1).padStart(padding, '0')}`;

    return { nextCode, maxNumber: maxNumber + 1 };
  } catch (error) {
    console.error('Error generating next code:', error);
    throw new Error(`Failed to generate ${prefix} code`);
  }
}

export async function generateProductCode(db: any): Promise<string> {
  const { nextCode } = await generateNextCode(db, "products", "productCode", "PROD");
  return nextCode;
}

export async function generateFormulaCode(db: any): Promise<string> {
  const { nextCode } = await generateNextCode(db, "formulas", "formulaCode", "FORM");
  return nextCode;
}