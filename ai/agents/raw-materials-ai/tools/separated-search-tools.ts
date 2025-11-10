/**
 * Separated Search Tools
 * Direct MongoDB search across ALL relevant fields
 *
 * Updated: 2025-11-08 - Changed from vector search to direct MongoDB queries
 *
 * Search tools:
 * 1. search_fda_database - Search comprehensive FDA database (31,179 items)
 * 2. check_stock_availability - Check materials in stock (3,111 items)
 * 3. get_material_profile - Get detailed material profiles
 * 4. search_materials_by_usecase - Search by product type
 *
 * All searches query these fields:
 * - INCI_name (ingredient name)
 * - Function (primary functionality, e.g., "ANTI-SEBUM, ANTIOXIDANT")
 * - benefits (Thai/English benefits, e.g., "ลดสิว", "ความชุ่มชื้น")
 * - usecase (product types, e.g., "เซรั่ม", "ครีม")
 * - Chem_IUPAC_Name_Description (chemical description)
 * - trade_name (product name)
 */

import { z } from 'zod';
import { getUnifiedSearchService } from '@/ai/services/rag/unified-search-service';

/**
 * Normalize array-like fields coming from MongoDB
 */
const parseTextArray = (field: any): string[] => {
  if (!field) return [];

  if (Array.isArray(field)) {
    return field
      .map(item => (typeof item === 'string' ? item.trim() : String(item).trim()))
      .filter(item => item.length > 0);
  }

  if (typeof field === 'string') {
    const cleaned = field
      .replace(/[\[\]'"]/g, ' ')
      .split(/[,|\n]/)
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0);

    if (cleaned.length > 0) {
      return cleaned;
    }
    return [field.trim()].filter(Boolean);
  }

  return [String(field).trim()].filter(Boolean);
};

/**
 * Deduplicate list values while preserving order
 */
const dedupeList = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = item.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(item);
    }
  }

  return result;
};

/**
 * Format list for compact table display
 */
const formatListForTable = (items: string[], maxItems = 3): string => {
  if (items.length === 0) return 'ไม่มีข้อมูล';

  const trimmed = items.slice(0, maxItems);
  const display = trimmed.join(', ');

  if (items.length > maxItems) {
    return `${display}, ...`;
  }

  return display;
};

/**
 * Check if list has an item containing target term (case-insensitive)
 */
const listContainsTerm = (items: string[], term: string): boolean => {
  if (!term) return true;
  const lower = term.toLowerCase();
  return items.some(item => item.toLowerCase().includes(lower));
};

/**
 * Tool 1: Search FDA Database (for comprehensive ingredient listing)
 * Use when user wants general information about ingredients
 */
export const searchFDADataBaseTool = {
  name: 'search_fda_database',
  description: `ค้นหาข้อมูลวัตถุดิบจากฐานข้อมูล FDA ทั้งหมด (31,179 รายการ)

  ใช้เมื่อผู้ใช้ถาม:
  - "แนะนำสารที่ช่วย..." (recommend ingredients for...)
  - "หาวัตถุดิบ..." (find ingredients...)
  - "มีสารอะไรบ้างที่ช่วย..." (what ingredients help with...)
  - "Vitamin C ช่วยอะไร" (what does Vitamin C help with)
  - "สารแบบไหนดีต่อ..." (which ingredients are good for...)
  - "ขออีก 5 สาร" (another 5 ingredients - use offset parameter)
  - "ที่ไม่ใช่ SAM" (not SAM - use exclude_codes with previous results)

  จะค้นหาเฉพาะในฐานข้อมูล FDA เพื่อข้อมูลครบถ้วน
  รองรับ pagination และการยกเว้นผลลัพธ์ที่แสดงแล้ว`,

  parameters: z.object({
    query: z.string().describe('คำค้นหาวัตถุดิบ ภาษาไทยหรืออังกฤษ เช่น "vitamin C", "ความชุ่มชื้น", "ลดริ้วรอย", "anti-aging". รองรับ: รหัสเดี่ยว "RM001234", ช่วง "RM001000-RM002000" หรือ "RM001000 to RM002000", รูปแบบ "RM00*"'),

    benefit: z.string().optional().describe('ค้นหาตามประโยชน์เฉพาะเจาะจง เช่น "ความชุ่มชื้น", "ลดสิว", "ต้านอนุมูลอิสระ"'),

    limit: z.number().optional().default(5).describe('จำนวนผลลัพธ์ที่ต้องการ (1-10)'),

    offset: z.number().optional().default(0).describe('ข้ามผลลัพธ์จำนวนนี้ (สำหรับแสดงผลหน้าถัดไป)'),

    exclude_codes: z.array(z.string()).optional().describe('รหัสวัตถุดิบที่ต้องการยกเว้น เช่น ["RM000943", "RM001127"]'),

    category: z.string().optional().describe('หมวดหมู่วัตถุดิบ เช่น "peptides", "antioxidants", "moisturizers"'),

    code_range_start: z.string().optional().describe('รหัสเริ่มต้นของช่วง เช่น "RM001000" (ใช้คู่กับ code_range_end)'),

    code_range_end: z.string().optional().describe('รหัสสิ้นสุดของช่วง เช่น "RM002000" (ใช้คู่กับ code_range_start)')
  }),

  handler: async (params: {
    query: string;
    benefit?: string;
    limit?: number;
    offset?: number;
    exclude_codes?: string[];
    category?: string;
    code_range_start?: string;
    code_range_end?: string;
  }) => {
    console.log('🔧 [search-fda-database] Called with:', params);

    try {
      // Direct MongoDB search instead of vector search
      const mongoClientPromise = require('@/lib/mongodb').default;
      const client = await mongoClientPromise;
      const db = client.db('rnd_ai');
      const collection = db.collection('raw_materials_console');

      // Build search query for FDA database
      let searchQuery = params.query;
      if (params.benefit) {
        searchQuery = params.benefit; // Use benefit directly for searching
      }

      const requestedLimit = params.limit || 5;
      const offset = params.offset || 0;
      const excludeCodes = params.exclude_codes || [];

      // 🆕 Parse range from query if present
      // Supports: "RM001000-RM002000", "RM001000 to RM002000", "RM001000 - RM002000"
      let codeRangeStart = params.code_range_start;
      let codeRangeEnd = params.code_range_end;

      const rangeMatch = searchQuery.match(/(RM\d+)\s*(?:-|to)\s*(RM\d+)/i);
      if (rangeMatch) {
        codeRangeStart = rangeMatch[1];
        codeRangeEnd = rangeMatch[2];
        console.log(`🔍 [search-fda-database] Detected range: ${codeRangeStart} to ${codeRangeEnd}`);
      }

      // 🆕 Parse wildcard pattern: "RM00*" or "RM00xxxx"
      let wildcardPattern = null;
      if (searchQuery.includes('*') || searchQuery.toLowerCase().includes('x')) {
        // Convert wildcard to regex: "RM00*" → "^RM00"
        wildcardPattern = searchQuery.replace(/\*/g, '').replace(/x+/gi, '');
        console.log(`🔍 [search-fda-database] Detected wildcard pattern: ${wildcardPattern}`);
      }

      // Build MongoDB query
      const mongoQuery: any = {};

      // 🆕 Priority 1: Code range search
      if (codeRangeStart && codeRangeEnd) {
        mongoQuery.rm_code = {
          $gte: codeRangeStart,
          $lte: codeRangeEnd
        };
        console.log(`🔍 [search-fda-database] Range query: ${codeRangeStart} to ${codeRangeEnd}`);
      }
      // 🆕 Priority 2: Wildcard pattern search
      else if (wildcardPattern) {
        mongoQuery.rm_code = new RegExp(`^${wildcardPattern}`, 'i');
        console.log(`🔍 [search-fda-database] Wildcard query: ${wildcardPattern}`);
      }
      // Priority 3: Regular text search across ALL possible columns
      else {
        const searchRegex = new RegExp(searchQuery, 'i');
        mongoQuery.$or = [
          // Core identification fields
          { rm_code: searchRegex },
          { trade_name: searchRegex },
          { INCI_name: searchRegex },          // Uppercase variant (older documents)
          { inci_name: searchRegex },          // Lowercase variant (newer documents)
          // Supplier information
          { supplier: searchRegex },
          // Functional descriptions
          { Function: searchRegex },
          { Chem_IUPAC_Name_Description: searchRegex },
          // Benefits fields (both live and cached)
          { benefits: searchRegex },
          { benefits_cached: searchRegex },
          // Use case fields (both live and cached)
          { usecase: searchRegex },
          { usecase_cached: searchRegex }
        ];
        console.log(`🔍 [search-fda-database] Searching across 11 columns for: "${searchQuery}"`);
      }

      // Exclude specified codes
      if (excludeCodes.length > 0) {
        mongoQuery.rm_code = mongoQuery.rm_code
          ? { ...mongoQuery.rm_code, $nin: excludeCodes }
          : { $nin: excludeCodes };
      }

      console.log('🔍 [search-fda-database] MongoDB query:', JSON.stringify(mongoQuery));

      // Execute MongoDB query with pagination
      const totalCount = await collection.countDocuments(mongoQuery);
      const results = await collection
        .find(mongoQuery)
        .skip(offset)
        .limit(requestedLimit)
        .toArray();

      console.log(`🔍 [search-fda-database] Found ${totalCount} total, returning ${results.length} from offset ${offset}`);

      // Convert MongoDB results to expected format
      const paginatedResults = results.map((doc: any) => ({
        document: doc,
        score: 0.95 // High score since it's a direct match
      }));
      const formatted = paginatedResults.map((result, index) => {
        const doc = result.document;

        // Handle console collection fields
        const material_code = doc.rm_code || 'N/A';
        const inci_name = doc.INCI_name || doc.inci_name || 'N/A';
        const function_name = doc.Function || doc.function || 'N/A';
        const benefits = Array.isArray(doc.benefits)
          ? doc.benefits.join(', ')
          : (typeof doc.benefits === 'string' ? doc.benefits : 'No benefits information');
        const usecase = Array.isArray(doc.usecase)
          ? doc.usecase.join(', ')
          : (typeof doc.usecase === 'string' ? doc.usecase : 'No use case information');

        // FDA database doesn't have trade_name or supplier fields
        const name = 'ไม่ระบุชื่อการค้า';
        const supplier = 'ต้องติดต่อซัพพลายเออร์';
        const status = '📚 FDA Database';

        return {
          rank: offset + index + 1,
          material_code: material_code,
          name: name,
          inci_name: inci_name,
          function: function_name,
          benefits: benefits,
          usecase: usecase,
          supplier: supplier,
          status: status,
          availability: 'fda_only',
          match_score: (result.score * 100).toFixed(0) + '%'
        };
      });

      // Format as Thai table
      const format_thai_table = (materials: any[]) => {
        if (materials.length === 0) return 'ไม่พบวัตถุดิบในฐานข้อมูล FDA';

        let table = '\n| # | รหัสวัตถุดิบ | ชื่อ INCI | หน้าที่ทำงาน | ประโยชน์ | คะแนน |\n' +
          '|---|---------------|----------|--------------|----------|--------|';

        for (const mat of materials) {
          // Truncate long fields for table display
          const inci_short = mat.inci_name.length > 30 ? mat.inci_name.substring(0, 30) + '...' : mat.inci_name;
          const func_short = mat.function.length > 25 ? mat.function.substring(0, 25) + '...' : mat.function;
          const benefits_short = mat.benefits.length > 40 ? mat.benefits.substring(0, 40) + '...' : mat.benefits;

          table += `| ${mat.rank} | ${mat.material_code} | ${inci_short} | ${func_short} | ${benefits_short} | ${mat.match_score} |\n`;
        }

        return table;
      };

      return {
        success: true,
        query: searchQuery,
        total_found: totalCount,
        returned: formatted.length,
        offset: offset,
        limit: requestedLimit,
        excluded_count: excludeCodes.length,
        database: 'FDA Database (31,179 รายการ) - Direct MongoDB Search',
        materials: formatted,
        table_display: format_thai_table(formatted),
        instruction_to_ai: 'แสดงผลลัพธ์โดยใช้ table_display เท่านั้น ตอบเป็นภาษาไทยทั้งหมด แสดงตาราง markdown ให้ผู้ใช้เห็นโดยตรง'
      };

    } catch (error: any) {
      console.error('❌ [search-fda-database] Error:', error);
      return {
        success: false,
        error: error.message,
        materials: [],
        table_display: 'เกิดข้อผิดพลาดในการค้นหา: ' + error.message
      };
    }
  }
};

/**
 * Tool 2: Check Stock Availability (for what we have)
 * Use when user asks about materials we actually have in stock
 */
export const checkStockAvailabilityTool = {
  name: 'check_stock_availability',
  description: `ค้นหาวัตถุดิบจากฐานข้อมูลหลัก (31,179 รายการ)

  ใช้เมื่อผู้ใช้ถาม:
  - "มี...ไหม?" (do we have...?)
  - "หาวัตถุดิบ..." (find ingredients...)
  - "สารที่เรามี" (materials that we have)
  - "มีสารอะไรบ้างที่ช่วย..." (what ingredients help with...)
  - "แนะนำสาร..." (recommend ingredients...)
  - "ที่ไม่มี SAM" (not SAM - use exclude_patterns ["SAM"])
  - "อีก 5 อัน" (another 5 - use offset parameter)

  จะค้นหาจากฐานข้อมูล raw_materials_console
  รองรับการกรองผลลัพธ์และ pagination`,

  parameters: z.object({
    query: z.string().describe('คำค้นหาวัตถุดิบที่ต้องการตรวจสอบ เช่น "vitamin C", "niacinamide", "peptide", "moisturizer"'),

    category: z.string().optional().describe('หมวดหมู่วัตถุดิบที่ต้องการ เช่น "peptides", "antioxidants", "moisturizers"'),

    limit: z.number().optional().default(5).describe('จำนวนผลลัพธ์ที่ต้องการ (1-10)'),

    offset: z.number().optional().default(0).describe('ข้ามผลลัพธ์จำนวนนี้ (สำหรับแสดงผลหน้าถัดไป)'),

    exclude_codes: z.array(z.string()).optional().describe('รหัสวัตถุดิบที่ต้องการยกเว้น เช่น ["RM000943", "RM001127"]'),

    exclude_patterns: z.array(z.string()).optional().describe('รูปแบบชื่อที่ต้องการยกเว้น เช่น ["SAM", "สมุนไพร"]')
  }),

  handler: async (params: {
    query: string;
    category?: string;
    limit?: number;
    offset?: number;
    exclude_codes?: string[];
    exclude_patterns?: string[];
  }) => {
    console.log('🔧 [check-stock-availability] Called with:', params);

    try {
      // Direct MongoDB search
      const mongoClientPromise = require('@/lib/mongodb').default;
      const client = await mongoClientPromise;
      const db = client.db('rnd_ai');
      const collection = db.collection('raw_materials_console');

      const requestedLimit = params.limit || 5;
      const offset = params.offset || 0;
      const excludeCodes = params.exclude_codes || [];
      const excludePatterns = params.exclude_patterns || [];

      // Build MongoDB query
      const searchRegex = new RegExp(params.query, 'i');

      const mongoQuery: any = {
        $or: [
          { INCI_name: searchRegex },
          { Function: searchRegex },
          { benefits: searchRegex },
          { usecase: searchRegex },
          { Chem_IUPAC_Name_Description: searchRegex },
          { trade_name: searchRegex }
        ]
      };

      // Exclude specified codes
      if (excludeCodes.length > 0) {
        mongoQuery.rm_code = { $nin: excludeCodes };
      }

      // Exclude patterns from trade_name
      if (excludePatterns.length > 0) {
        const patternConditions = excludePatterns.map(pattern => ({
          trade_name: { $not: new RegExp(pattern, 'i') }
        }));
        mongoQuery.$and = patternConditions;
      }

      console.log('🔍 [check-stock-availability] MongoDB query:', JSON.stringify(mongoQuery));

      // Execute MongoDB query
      const totalCount = await collection.countDocuments(mongoQuery);
      const results = await collection
        .find(mongoQuery)
        .skip(offset)
        .limit(requestedLimit)
        .toArray();

      console.log(`🔍 [check-stock-availability] Found ${totalCount} total, returning ${results.length} from offset ${offset}`);

      // Convert to expected format
      const paginatedResults = results.map((doc: any) => ({
        document: doc,
        score: 0.95
      }));

      // Format results for stock materials
      const formatted = paginatedResults.map((result, index) => {
        const doc = result.document;

        const material_code = doc.rm_code || 'N/A';
        const trade_name = doc.trade_name || 'ไม่ระบุ';
        const inci_name = doc.inci_name || 'ไม่ระบุ';
        const supplier = doc.supplier || 'ไม่ระบุ';
        const company = doc.company_name || 'ไม่ระบุ';
        const cost = doc.rm_cost || 0;
        const benefits = doc.benefits || 'ไม่มีข้อมูลประโยชน์';

        return {
          rank: offset + index + 1,
          material_code: material_code,
          trade_name: trade_name,
          inci_name: inci_name,
          supplier: supplier,
          company: company,
          cost_per_kg: cost ? `฿${cost}/kg` : 'ราคาติดต่อ',
          benefits: benefits,
          availability: 'in_stock',
          status: '✅ มีในสต็อก',
          match_score: (result.score * 100).toFixed(0) + '%'
        };
      });

      // Format as Thai table
      const format_stock_table = (materials: any[]) => {
        if (materials.length === 0) return 'ไม่พบวัตถุดิบที่ต้องการ';

        let table = '\n| # | รหัสวัตถุดิบ | ชื่อการค้า | INCI Name | ซัพพลายเออร์ | ราคา/กก. | สถานะ | คะแนน |\n' +
          '|---|---------------|--------------|------------|----------------|-------------|--------|---------|';

        for (const mat of materials) {
          table += `| ${mat.rank} | ${mat.material_code} | ${mat.trade_name} | ${mat.inci_name} | ${mat.supplier} | ${mat.cost_per_kg} | ${mat.status} | ${mat.match_score} |\n`;
        }

        return table;
      };

      return {
        success: true,
        query: params.query,
        total_found: totalCount,
        returned: formatted.length,
        offset: offset,
        limit: requestedLimit,
        excluded_count: excludeCodes.length + excludePatterns.length,
        excluded_patterns: excludePatterns,
        database: 'raw_materials_console (31,179 รายการ) - Direct MongoDB Search',
        materials: formatted,
        table_display: format_stock_table(formatted),
        instruction_to_ai: 'แสดงผลลัพธ์โดยใช้ table_display เท่านั้น ตอบเป็นภาษาไทยทั้งหมด แสดงตาราง markdown ให้ผู้ใช้เห็นโดยตรง'
      };

    } catch (error: any) {
      console.error('❌ [check-stock-availability] Error:', error);
      return {
        success: false,
        error: error.message,
        materials: [],
        table_display: 'เกิดข้อผิดพลาดในการค้นหา: ' + error.message
      };
    }
  }
};

/**
 * Tool 3: Material Profile (benefits + use cases + applications)
 * Use when user needs detailed use case guidance for a specific ingredient
 */
export const getMaterialProfileTool = {
  name: 'get_material_profile',
  description: `ดึงข้อมูลโปรไฟล์วัตถุดิบแบบละเอียดจากฐานข้อมูล raw_materials_console (INCI, ประโยชน์, Use Case)

  ใช้เมื่อผู้ใช้ถาม:
  - "สาร [ชื่อ] ใช้ทำอะไรได้บ้าง"
  - "INCI [ชื่อ] ใช้ในผลิตภัณฑ์ประเภทไหน"
  - "วัตถุดิบ [ชื่อ] มีประโยชน์อะไร และเหมาะกับอะไร"
  - "ยกตัวอย่างผลิตภัณฑ์ที่ใช้สารนี้"

  ค้นหาจากฐานข้อมูล raw_materials_console (31,179 รายการ)`,

  parameters: z.object({
    material: z.string().min(1).describe('ชื่อวัตถุดิบ, INCI หรือรหัส เช่น "Caffeoyl Hexapeptide-48", "RM001234"'),
    limit: z.number().min(1).max(5).optional().default(3).describe('จำนวนวัถุดิบที่จะสรุป (1-5)'),
    include_related: z.boolean().optional().default(true).describe('แสดงวัตถุดิบที่ใกล้เคียงเพิ่มเติมหรือไม่ (default: true)')
  }),

  handler: async (params: {
    material: string;
    limit?: number;
    include_related?: boolean;
  }) => {
    console.log('🔧 [get-material-profile] Called with:', params);

    try {
      const searchService = getUnifiedSearchService();
      const limit = params.limit ?? 3;

      // Always search raw_materials_console (all_fda) only
      const collectionForSearch: 'all_fda' = 'all_fda';

      const topK = Math.min(limit * 3, 15);
      const results = await searchService.unified_search(params.material, {
        collection: collectionForSearch,
        topK,
        similarityThreshold: 0.45,
        max_results: topK,
        include_availability_context: true
      });

      if (results.length === 0) {
        return {
          success: true,
          query: params.material,
          total_found: 0,
          returned: 0,
          profiles: [],
          table_display: 'ไม่พบข้อมูลวัตถุดิบตามคำค้นหา',
          instruction_to_ai: 'ไม่พบข้อมูลในฐานข้อมูล ให้ขอโทษผู้ใช้และแนะนำให้ตรวจสอบชื่อหรือรหัสใหม่'
        };
      }

      const profiles = results.slice(0, limit).map((result, index) => {
        const doc = result.document || {};

        const materialCode = doc.rm_code || doc.material_code || 'N/A';
        const tradeName = doc.trade_name || doc.name || doc.productName || 'ไม่ระบุ';
        const inciName = doc.inci_name || doc.INCI_name || 'ไม่ระบุ';
        const functionName = doc.Function || doc.function || doc.category || 'ไม่ระบุ';
        const supplier = doc.supplier || doc.company_name || 'ไม่ระบุ';
        const rawCost = doc.rm_cost || doc.price || '';
        const cost = rawCost ? `฿${rawCost}` : 'ราคาติดต่อ';
        const applicationNotes = doc.Chem_IUPAC_Name_Description || doc.description || '';

        const benefits = dedupeList(parseTextArray(doc.benefits || doc.benefits_cached));
        const useCases = dedupeList(parseTextArray(doc.usecase || doc.usecase_cached));

        const availability = result.availability === 'in_stock' ? '✅ มีในสต็อก' : '📚 FDA Database';
        const matchScore = (result.score * 100).toFixed(0) + '%';

        const benefitSummary = formatListForTable(benefits, 4);
        const useCaseSummary = formatListForTable(useCases, 4);

        const summary = useCases.length > 0
          ? `เหมาะกับผลิตภัณฑ์ประเภท ${useCaseSummary} พร้อมประโยชน์เด่น ${benefitSummary}`
          : `ประโยชน์เด่น ${benefitSummary}`;

        return {
          rank: index + 1,
          material_code: materialCode,
          trade_name: tradeName,
          inci_name: inciName,
          function: functionName,
          supplier,
          cost_per_kg: cost,
          benefits,
          use_cases: useCases,
          application_notes: applicationNotes,
          availability: result.availability,
          status: availability,
          match_score: matchScore,
          summary
        };
      });

      const table = (() => {
        let table = '\n| # | วัตถุดิบ | ใช้ในผลิตภัณฑ์ | ประโยชน์เด่น | สถานะ | คะแนน |\n' +
          '|---|-----------|------------------|-------------|--------|--------|';

        for (const profile of profiles) {
          const materialLabel = `${profile.trade_name !== 'ไม่ระบุ' ? profile.trade_name : profile.inci_name} (${profile.inci_name})`;
          table += `| ${profile.rank} | ${materialLabel} | ${formatListForTable(profile.use_cases, 3)} | ${formatListForTable(profile.benefits, 3)} | ${profile.status} | ${profile.match_score} |\n`;
        }

        return table;
      })();

      const allUseCases = dedupeList(profiles.flatMap(profile => profile.use_cases));
      const allBenefits = dedupeList(profiles.flatMap(profile => profile.benefits));

      const narrativeSummary = (() => {
        const useCaseText = allUseCases.length > 0 ? `ผลิตภัณฑ์กลุ่ม ${formatListForTable(allUseCases, 5)}` : 'หลายประเภท';
        const benefitText = allBenefits.length > 0 ? formatListForTable(allBenefits, 5) : 'หลากหลายประโยชน์';
        return `วัตถุดิบกลุ่มนี้เหมาะสำหรับ ${useCaseText} โดยให้คุณสมบัติเด่นด้าน ${benefitText}.`;
      })();

      return {
        success: true,
        query: params.material,
        total_found: results.length,
        returned: profiles.length,
        primary_material: profiles[0],
        related_materials: params.include_related === false ? [] : profiles.slice(1),
        profiles,
        table_display: table,
        narrative_summary: narrativeSummary,
        recommended_use_cases: allUseCases,
        recommended_benefits: allBenefits,
        instruction_to_ai: 'ให้แสดงตาราง table_display ก่อน แล้วสรุปผลเป็นภาษาไทยในเชิงแนะนำการใช้งานจริง พร้อมยกตัวอย่างผลิตภัณฑ์หรือรูปแบบสูตรที่เหมาะสมโดยอิงจาก use_cases'
      };
    } catch (error: any) {
      console.error('❌ [get-material-profile] Error:', error);
      return {
        success: false,
        error: error.message,
        profiles: [],
        table_display: 'เกิดข้อผิดพลาดในการดึงโปรไฟล์วัตถุดิบ: ' + error.message
      };
    }
  }
};

/**
 * Tool 4: Search materials by product use case
 * Use when user asks for ingredients suited to a product format (serum, cream, etc.)
 */
export const searchMaterialsByUsecaseTool = {
  name: 'search_materials_by_usecase',
  description: `ค้นหาวัตถุดิบตามประเภทผลิตภัณฑ์ (Use Case) จากฐานข้อมูล raw_materials_console

  ใช้เมื่อผู้ใช้ถาม:
  - "วัถุดิบสำหรับเซรั่มลดริ้วรอย"
  - "มีอะไรที่ใช้ทำ eye cream บ้าง"
  - "หา active สำหรับ sleeping mask"
  - "ต้องการสารสำหรับ sun care ที่ช่วย [benefit]"

  ค้นหาจากฐานข้อมูล raw_materials_console (31,179 รายการ)`,

  parameters: z.object({
    usecase: z.string().min(1).describe('ประเภทผลิตภัณฑ์หรือ Use Case เช่น "serum", "cream", "toner", "eye cream", "mask"'),
    benefit: z.string().optional().describe('ประโยชน์เพิ่มเติมที่ต้องการกรอง เช่น "ลดริ้วรอย", "ความชุ่มชื้น", "ปรับผิวสว่าง"'),
    limit: z.number().min(1).max(10).optional().default(5).describe('จำนวนผลลัพธ์ที่ต้องการ (1-10)'),
    offset: z.number().min(0).optional().default(0).describe('จำนวนผลลัพธ์ที่ต้องการข้าม (สำหรับหน้าถัดไป)'),
    exclude_codes: z.array(z.string()).optional().describe('รหัสวัตถุดิบที่ต้องการยกเว้น เช่น ["RM000123", "RM000456"]')
  }),

  handler: async (params: {
    usecase: string;
    benefit?: string;
    limit?: number;
    offset?: number;
    exclude_codes?: string[];
  }) => {
    console.log('🔧 [search-materials-by-usecase] Called with:', params);

    try {
      const searchService = getUnifiedSearchService();
      const limit = params.limit ?? 5;
      const offset = params.offset ?? 0;
      const excludeCodes = params.exclude_codes ?? [];

      // Always search raw_materials_console (all_fda) only
      const collectionForSearch: 'all_fda' = 'all_fda';

      const baseQuery = params.benefit
        ? `${params.usecase} ingredients for ${params.benefit}`
        : `ingredients for ${params.usecase}`;

      const fetchLimit = Math.min(limit + offset + excludeCodes.length + 10, 60);

      const results = await searchService.unified_search(baseQuery, {
        collection: collectionForSearch,
        topK: fetchLimit,
        similarityThreshold: 0.45,
        max_results: fetchLimit,
        include_availability_context: true
      });

      if (results.length === 0) {
        return {
          success: true,
          query: baseQuery,
          total_found: 0,
          returned: 0,
          materials: [],
          table_display: 'ไม่พบวัตถุดิบที่ตรงกับ use case ที่ระบุ',
          instruction_to_ai: 'แจ้งผู้ใช้ว่าไม่พบข้อมูล และเสนอให้ระบุคำค้นเป็นภาษาอังกฤษหรือกรองประโยชน์ให้กว้างขึ้น'
        };
      }

      const filtered = results.filter(result => {
        const doc = result.document || {};
        const code = doc.rm_code || doc.material_code;
        if (code && excludeCodes.includes(code)) {
          return false;
        }

        const useCases = dedupeList(parseTextArray(doc.usecase || doc.usecase_cached));
        const benefits = dedupeList(parseTextArray(doc.benefits || doc.benefits_cached));

        const matchesUseCase = listContainsTerm(useCases, params.usecase);
        const matchesBenefit = listContainsTerm(benefits, params.benefit || '');

        return matchesUseCase && matchesBenefit;
      });

      let working = filtered.length > 0 ? filtered : results;

      // No need to prioritize stock since we only search raw_materials_console
      const paginated = working.slice(offset, offset + limit);

      const formatted = paginated.map((result, index) => {
        const doc = result.document || {};
        const materialCode = doc.rm_code || doc.material_code || 'N/A';
        const tradeName = doc.trade_name || doc.name || doc.productName || doc.inci_name || doc.INCI_name || 'ไม่ระบุ';
        const inciName = doc.inci_name || doc.INCI_name || 'ไม่ระบุ';
        const supplier = doc.supplier || doc.company_name || 'ไม่ระบุ';
        const benefits = dedupeList(parseTextArray(doc.benefits || doc.benefits_cached));
        const useCases = dedupeList(parseTextArray(doc.usecase || doc.usecase_cached));

        return {
          rank: offset + index + 1,
          material_code: materialCode,
          trade_name: tradeName,
          inci_name: inciName,
          supplier,
          benefits,
          use_cases: useCases,
          availability: result.availability,
          status: result.availability === 'in_stock' ? '✅ มีในสต็อก' : '📚 FDA Database',
          match_score: (result.score * 100).toFixed(0) + '%'
        };
      });

      const table = (() => {
        let table = '\n| # | วัตถุดิบ | ใช้ในผลิตภัณฑ์ | ประโยชน์เด่น | สถานะ | คะแนน |\n' +
          '|---|-----------|------------------|-------------|--------|--------|';

        for (const material of formatted) {
          const materialLabel = `${material.trade_name} (${material.inci_name})`;
          table += `| ${material.rank} | ${materialLabel} | ${formatListForTable(material.use_cases, 3)} | ${formatListForTable(material.benefits, 3)} | ${material.status} | ${material.match_score} |\n`;
        }

        return table;
      })();

      const highlightUseCases = dedupeList(formatted.flatMap(mat => mat.use_cases));
      const highlightBenefits = dedupeList(formatted.flatMap(mat => mat.benefits));

      const recommendationSummary = (() => {
        const useCaseText = highlightUseCases.length > 0 ? formatListForTable(highlightUseCases, 5) : params.usecase;
        const benefitText = highlightBenefits.length > 0 ? formatListForTable(highlightBenefits, 5) : (params.benefit || 'หลายคุณสมบัติ');
        return `กลุ่มวัตถุดิบที่แนะนำเหมาะสำหรับผลิตภัณฑ์ประเภท ${useCaseText} และให้คุณสมบัติเด่นด้าน ${benefitText}. แนะนำให้จับคู่กับสารเสริมโครงสร้างสูตรและสารเพิ่มสัมผัสที่เข้ากันได้`;
      })();

      return {
        success: true,
        query: baseQuery,
        total_found: working.length,
        returned: formatted.length,
        offset,
        limit,
        materials: formatted,
        table_display: table,
        narrative_summary: recommendationSummary,
        recommended_use_cases: highlightUseCases,
        recommended_benefits: highlightBenefits,
        instruction_to_ai: 'ใช้ table_display เพื่อนำเสนอรายการ จากนั้นสรุปแนวทางการพัฒนาสูตรแบบเป็นกันเอง พร้อมระบุไอเดียการผสมผสานสารอื่น ๆ',
        filter_applied: filtered.length > 0,
        filtered_out_count: results.length - working.length
      };
    } catch (error: any) {
      console.error('❌ [search-materials-by-usecase] Error:', error);
      return {
        success: false,
        error: error.message,
        materials: [],
        table_display: 'เกิดข้อผิดพลาดในการค้นหา use case: ' + error.message
      };
    }
  }
};

/**
 * Export both separated tools
 */
export const separatedSearchTools = {
  search_fda_database: searchFDADataBaseTool,
  check_stock_availability: checkStockAvailabilityTool,
  get_material_profile: getMaterialProfileTool,
  search_materials_by_usecase: searchMaterialsByUsecaseTool
};

/**
 * Tool definitions for AI agent
 */
export const separatedToolDefinitions = [
  {
    name: searchFDADataBaseTool.name,
    description: searchFDADataBaseTool.description,
    parameters: searchFDADataBaseTool.parameters
  },
  {
    name: checkStockAvailabilityTool.name,
    description: checkStockAvailabilityTool.description,
    parameters: checkStockAvailabilityTool.parameters
  },
  {
    name: getMaterialProfileTool.name,
    description: getMaterialProfileTool.description,
    parameters: getMaterialProfileTool.parameters
  },
  {
    name: searchMaterialsByUsecaseTool.name,
    description: searchMaterialsByUsecaseTool.description,
    parameters: searchMaterialsByUsecaseTool.parameters
  }
];
