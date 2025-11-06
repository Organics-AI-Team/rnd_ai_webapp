/**
 * Separated Search Tools
 * Two distinct tools for different purposes:
 * 1. search_fda_database - Search comprehensive FDA database
 * 2. check_stock_availability - Check materials we have in stock
 */

import { z } from 'zod';
import { getUnifiedSearchService } from '@/ai/services/rag/unified-search-service';

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
    query: z.string().describe('คำค้นหาวัตถุดิบ ภาษาไทยหรืออังกฤษ เช่น "vitamin C", "ความชุ่มชื้น", "ลดริ้วรอย", "anti-aging"'),

    benefit: z.string().optional().describe('ค้นหาตามประโยชน์เฉพาะเจาะจง เช่น "ความชุ่มชื้น", "ลดสิว", "ต้านอนุมูลอิสระ"'),

    limit: z.number().optional().default(5).describe('จำนวนผลลัพธ์ที่ต้องการ (1-10)'),

    offset: z.number().optional().default(0).describe('ข้ามผลลัพธ์จำนวนนี้ (สำหรับแสดงผลหน้าถัดไป)'),

    exclude_codes: z.array(z.string()).optional().describe('รหัสวัตถุดิบที่ต้องการยกเว้น เช่น ["RM000943", "RM001127"]'),

    category: z.string().optional().describe('หมวดหมู่วัตถุดิบ เช่น "peptides", "antioxidants", "moisturizers"')
  }),

  handler: async (params: {
    query: string;
    benefit?: string;
    limit?: number;
    offset?: number;
    exclude_codes?: string[];
    category?: string;
  }) => {
    console.log('🔧 [search-fda-database] Called with:', params);

    try {
      const searchService = getUnifiedSearchService();

      // Build search query for FDA database only
      let searchQuery = params.query;
      if (params.benefit) {
        searchQuery = `ingredients for ${params.benefit}`;
      }

      // Search for more results to handle pagination and exclusion
      const requestedLimit = params.limit || 5;
      const offset = params.offset || 0;
      const excludeCodes = params.exclude_codes || [];

      // Fetch more results than needed to account for exclusions
      const fetchLimit = Math.min(requestedLimit + offset + excludeCodes.length + 10, 50);

      const results = await searchService.unified_search(searchQuery, {
        collection: 'all_fda', // Only search FDA database
        topK: fetchLimit,
        similarityThreshold: 0.5,
        max_results: fetchLimit,
        include_availability_context: false // Don't show stock context
      });

      // Apply exclusion and pagination filters
      const filteredResults = results.filter(result => {
        const materialCode = result.document?.rm_code || result.document?.material_code;
        return !excludeCodes.includes(materialCode);
      });

      // Apply pagination
      const paginatedResults = filteredResults.slice(offset, offset + requestedLimit);

      console.log(`🔍 [search-fda-database] Pagination: ${filteredResults.length} total after exclusion, showing ${paginatedResults.length} from offset ${offset}`);
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
        total_found: filteredResults.length,
        returned: formatted.length,
        offset: offset,
        limit: requestedLimit,
        excluded_count: excludeCodes.length,
        database: 'FDA Database (31,179 รายการ)',
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
  description: `ตรวจสอบวัตถุดิบที่มีอยู่ในสต็อก (3,111 รายการ)

  ใช้เมื่อผู้ใช้ถาม:
  - "มี...ไหม?" (do we have...?)
  - "...มีอยู่ในสต็อกไหม" (...is it in stock?)
  - "สารที่เรามี" (materials that we have)
  - "สารที่มีอยู่ใน stock" (materials that are in stock)
  - "ซื้อได้ทันที" (can order immediately)
  - "วัตถุดิบที่มีพร้อมส่ง" (ready-to-ship ingredients)
  - "ที่ไม่มี SAM" (not SAM - use exclude_patterns ["SAM"])
  - "อีก 5 อัน" (another 5 - use offset parameter)

  จะค้นหาเฉพาะวัตถุดิบที่มีอยู่ในคลัง
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
      const searchService = getUnifiedSearchService();

      // Pagination and exclusion parameters
      const requestedLimit = params.limit || 5;
      const offset = params.offset || 0;
      const excludeCodes = params.exclude_codes || [];
      const excludePatterns = params.exclude_patterns || [];

      // Fetch more results to account for exclusions and pagination
      const fetchLimit = Math.min(requestedLimit + offset + excludeCodes.length + excludePatterns.length + 10, 50);

      // Search only in stock collection
      const results = await searchService.unified_search(params.query, {
        collection: 'in_stock', // Only search stock
        topK: fetchLimit,
        similarityThreshold: 0.5,
        max_results: fetchLimit,
        include_availability_context: true // Show stock context
      });

      // Filter out malformed material codes and apply exclusions
      const cleanResults = results.filter(r => {
        const code = r.document?.rm_code;
        const tradeName = r.document?.trade_name || '';

        // Filter malformed codes
        const isValidCode = code && !(/^[A-Z]+[ก-๙]/.test(code)) && !/^[ก-๙]/.test(code) && !/\s/.test(code);

        // Apply code exclusions
        const notExcludedCode = !excludeCodes.includes(code);

        // Apply pattern exclusions (for things like "SAM", "สมุนไพร")
        const notExcludedPattern = !excludePatterns.some(pattern =>
          tradeName.toLowerCase().includes(pattern.toLowerCase()) ||
          code.toLowerCase().includes(pattern.toLowerCase())
        );

        return isValidCode && notExcludedCode && notExcludedPattern;
      });

      // Apply pagination
      const paginatedResults = cleanResults.slice(offset, offset + requestedLimit);

      console.log(`🔍 [check-stock-availability] Pagination: ${cleanResults.length} total after filtering, showing ${paginatedResults.length} from offset ${offset}`);

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
        if (materials.length === 0) return 'ไม่พบวัตถุดิบที่ต้องการในสต็อก';

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
        total_found: cleanResults.length,
        returned: formatted.length,
        offset: offset,
        limit: requestedLimit,
        excluded_count: excludeCodes.length + excludePatterns.length,
        excluded_patterns: excludePatterns,
        database: 'สต็อกวัตถุดิบ (3,111 รายการ)',
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
        table_display: 'เกิดข้อผิดพลาดในการตรวจสอบสต็อก: ' + error.message
      };
    }
  }
};

/**
 * Export both separated tools
 */
export const separatedSearchTools = {
  search_fda_database: searchFDADataBaseTool,
  check_stock_availability: checkStockAvailabilityTool
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
  }
];