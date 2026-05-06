/**
 * Search Materials Tools
 * AI-callable tools for searching raw materials from both collections
 */

import { z } from 'zod';
import { getUnifiedSearchService } from '@/ai/services/rag/unified-search-service';

/**
 * Tool 1: Search Materials (Unified)
 * Searches both collections with intelligent routing
 */
export const searchMaterialsTool = {
  name: 'search_materials',
  description: `Search for raw materials/ingredients from inventory database.

  Use this when user asks:
  - "หาสารที่มีประโยชน์เรื่อง..." (find materials with benefits for...)
  - "ค้นหาวัตถุดิบ..." (search for ingredients...)
  - "มีอะไรบ้างที่ช่วย..." (what helps with...)
  - "แนะนำสารสำหรับ..." (recommend materials for...)

  The search automatically routes to:
  - In-stock materials (if query mentions "in stock", "มีในสต็อก")
  - FDA database (if query mentions "all", "ทั้งหมด")
  - Both collections (default - prioritizes in-stock)`,

  parameters: z.object({
    query: z.string().describe('Search query in Thai or English. Examples: "moisturizing", "ช่วยความชุ่มชื้น", "anti-aging", "Vitamin C"'),

    limit: z.number().optional().default(5).describe('Number of results to return (1-20)'),

    collection: z.enum(['in_stock', 'all_fda', 'both']).optional().describe(
      'Which collection to search:\n' +
      '- in_stock: Only materials currently in warehouse\n' +
      '- all_fda: All FDA-registered materials (may need ordering)\n' +
      '- both: Search both (default - smart prioritization)'
    ),

    filter_by: z.object({
      benefit: z.string().optional().describe('Filter by benefit/property (e.g., "moisturizing", "anti-aging")'),
      supplier: z.string().optional().describe('Filter by supplier name'),
      max_cost: z.number().optional().describe('Maximum cost per kg (in Baht)')
    }).optional()
  }),

  handler: async (params: {
    query: string;
    limit?: number;
    collection?: 'in_stock' | 'all_fda' | 'both';
    filter_by?: {
      benefit?: string;
      supplier?: string;
      max_cost?: number;
    };
  }) => {
    console.log('🔧 [search-materials-tool] Called with:', params);

    /**
     * Helper: Format results as markdown table
     */
    const format_results_as_table = (results: any[]): string => {
      if (results.length === 0) return 'No results found.';

      let table = '\n| # | Material Code | Trade Name | INCI Name | Supplier | Cost/kg | Status | Match |\n';
      table += '|---|---------------|------------|-----------|----------|---------|--------|-------|\n';

      for (const result of results) {
        table += `| ${result.rank} | ${result.material_code} | ${result.trade_name} | ${result.inci_name} | ${result.supplier} | ${result.cost_per_kg} | ${result.status} | ${result.match_score} |\n`;
      }

      return table;
    };

    try {
      const searchService = getUnifiedSearchService();

      // Perform unified search
      const results = await searchService.unified_search(params.query, {
        collection: params.collection || 'both',
        topK: params.limit || 5,
        similarityThreshold: 0.5,
        max_results: params.limit || 5,
        include_availability_context: true
      });

      // Apply additional filters if specified
      let filtered_results = results;

      if (params.filter_by) {
        filtered_results = results.filter(result => {
          const doc = result.document;

          // Filter by benefit
          if (params.filter_by?.benefit) {
            const benefit_match = doc.benefits?.toLowerCase().includes(params.filter_by.benefit.toLowerCase());
            if (!benefit_match) return false;
          }

          // Filter by supplier
          if (params.filter_by?.supplier) {
            const supplier_match = doc.supplier?.toLowerCase().includes(params.filter_by.supplier.toLowerCase());
            if (!supplier_match) return false;
          }

          // Filter by max cost
          if (params.filter_by?.max_cost) {
            const cost = parseFloat(doc.rm_cost || '0');
            if (cost > params.filter_by.max_cost) return false;
          }

          return true;
        });
      }

      // Get statistics
      const stats = searchService.get_collection_stats(filtered_results);

      // Format results with full data for table display
      const formatted_results = filtered_results.slice(0, params.limit || 5).map((result, index) => {
        const doc = result.document;

        // Handle field mapping between different collections
        const material_code = doc.rm_code || 'N/A';
        const trade_name = doc.trade_name || doc.name || 'N/A';
        const inci_name = doc.inci_name || doc.INCI_name || 'N/A';
        const supplier = doc.supplier || 'N/A';
        const company = doc.company_name || 'N/A';
        const cost = doc.rm_cost || 0;
        const benefits = Array.isArray(doc.benefits)
          ? doc.benefits.join(', ')
          : (typeof doc.benefits === 'string' ? doc.benefits : 'No benefits information');

        return {
          rank: index + 1,
          material_code: material_code,
          trade_name: trade_name,
          inci_name: inci_name,
          supplier: supplier,
          company: company,
          cost_per_kg: cost ? `฿${cost}` : 'Contact supplier',
          benefits: benefits,
          availability: result.availability,
          status: result.availability === 'in_stock' ? '✅ In Stock' : '📚 FDA Database',
          match_score: (result.score * 100).toFixed(1) + '%',
          match_type: result.match_type,
          // Additional data for comprehensive display
          cas_no: doc.cas_no || 'N/A',
          einecs_no: doc.einecs_no || 'N/A',
          category: doc.category || doc.Function || 'N/A'
        };
      });

      // Format as markdown table for AI to display
      const table_markdown = format_results_as_table(formatted_results);

      return {
        success: true,
        total_found: results.length,
        returned: formatted_results.length,
        statistics: {
          in_stock: stats.in_stock,
          fda_only: stats.fda_only,
          in_stock_percentage: stats.in_stock_percentage.toFixed(1) + '%'
        },
        search_mode: params.collection || 'both',
        results: formatted_results,
        table_display: table_markdown,
        instruction_to_ai: 'แสดงผลลัพธ์โดยใช้ table_display เท่านั้น ตอบเป็นภาษาไทยทั้งหมด แสดงตาราง markdown ให้ผู้ใช้เห็นโดยตรง'
      };

    } catch (error: any) {
      console.error('❌ [search-materials-tool] Error:', error);
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  }
};

/**
 * Tool 2: Check Material Availability
 * Check if specific material is in stock
 */
export const checkAvailabilityTool = {
  name: 'check_material_availability',
  description: `Check if a specific material/ingredient is available in stock.

  Use this when user asks:
  - "มี [material] ไหม?" (Do we have [material]?)
  - "มี [material] อยู่ในสต็อกไหม?" (Is [material] in stock?)
  - "สั่ง [material] ได้ไหม?" (Can we order [material]?)`,

  parameters: z.object({
    material_name_or_code: z.string().describe('Material name, INCI name, or RM code. Examples: "Vitamin C", "RM000123", "Niacinamide"')
  }),

  handler: async (params: { material_name_or_code: string }) => {
    console.log('🔧 [check-availability-tool] Called with:', params);

    try {
      const searchService = getUnifiedSearchService();

      // Check availability
      const availability = await searchService.check_availability(params.material_name_or_code);

      if (availability.in_stock && availability.details) {
        const doc = availability.details.document;
        return {
          success: true,
          in_stock: true,
          message: `✅ Yes! ${params.material_name_or_code} is in stock`,
          material: {
            material_code: doc.rm_code,
            trade_name: doc.trade_name,
            inci_name: doc.inci_name,
            supplier: doc.supplier,
            cost: doc.rm_cost ? `฿${doc.rm_cost}/kg` : 'N/A',
            status: '✅ Available immediately',
            benefits: doc.benefits?.substring(0, 150)
          }
        };
      } else {
        const alternatives = availability.alternatives?.slice(0, 3).map(alt => ({
          material_code: alt.document.rm_code,
          trade_name: alt.document.trade_name,
          inci_name: alt.document.inci_name,
          status: alt.availability === 'in_stock' ? '✅ In stock' : '📚 FDA database',
          match_score: alt.score.toFixed(3)
        }));

        return {
          success: true,
          in_stock: false,
          message: `❌ ${params.material_name_or_code} is not currently in stock`,
          alternatives: alternatives || [],
          suggestion: alternatives && alternatives.length > 0
            ? 'However, we found similar materials in our database'
            : 'We can help source this material from FDA-registered suppliers (2-4 weeks lead time)'
        };
      }

    } catch (error: any) {
      console.error('❌ [check-availability-tool] Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

/**
 * Tool 3: Find Materials by Benefit
 * Specialized search for materials with specific benefits/properties
 */
export const findMaterialsByBenefitTool = {
  name: 'find_materials_by_benefit',
  description: `Find materials with specific benefits or properties for skin/hair care.

  Use this when user asks:
  - "หาสาร 5 ตัวที่มีประโยชน์เรื่อง [benefit]" (find 5 materials with [benefit])
  - "วัตถุดิบที่ช่วยเรื่อง [problem]" (materials that help with [problem])
  - "สารที่ดีต่อ [skin/hair concern]" (materials good for [concern])

  Benefits can be in Thai or English.`,

  parameters: z.object({
    benefit: z.string().describe('Benefit or property to search for. Examples: "ผิว" (skin), "ความชุ่มชื้น" (moisturizing), "anti-aging", "whitening", "ลดริ้วรอย", "สิว" (acne)'),

    count: z.number().optional().default(5).describe('Number of materials to return'),

    prioritize_stock: z.boolean().optional().default(false).describe('Whether to prioritize in-stock materials'),

    additional_filters: z.object({
      max_cost: z.number().optional().describe('Maximum cost per kg in Baht'),
      avoid_allergens: z.boolean().optional().describe('Avoid common allergens'),
      natural_only: z.boolean().optional().describe('Natural ingredients only')
    }).optional()
  }),

  handler: async (params: {
    benefit: string;
    count?: number;
    prioritize_stock?: boolean;
    additional_filters?: {
      max_cost?: number;
      avoid_allergens?: boolean;
      natural_only?: boolean;
    };
  }) => {
    console.log('🔧 [find-by-benefit-tool] Called with:', params);

    try {
      const searchService = getUnifiedSearchService();

      // Build search query
      const search_query = `materials with benefits for ${params.benefit}`;

      // Perform search
      const results = await searchService.unified_search(search_query, {
        collection: params.prioritize_stock ? 'both' : 'all_fda',
        topK: params.count || 5,
        similarityThreshold: 0.4, // Lower threshold for benefit-based search
        max_results: params.count || 5,
        include_availability_context: true
      });

      // Apply additional filters
      let filtered_results = results;

      if (params.additional_filters?.max_cost) {
        filtered_results = filtered_results.filter(r => {
          const cost = parseFloat(r.document.rm_cost || '0');
          return cost <= (params.additional_filters?.max_cost || Infinity);
        });
      }

      // Format results with table support
      const formatted = filtered_results.slice(0, params.count || 5).map((result, index) => {
        const doc = result.document;

        // Handle field mapping between different collections
        const material_code = doc.rm_code || 'N/A';
        const name = doc.trade_name || doc.name || 'N/A';
        const inci = doc.inci_name || doc.INCI_name || 'N/A';
        const supplier = doc.supplier || 'N/A';
        const cost = doc.rm_cost || 0;

        // Handle benefits field properly
        let benefits = 'No information';
        let key_benefits = 'N/A';

        if (Array.isArray(doc.benefits)) {
          benefits = doc.benefits.join(', ');
          key_benefits = doc.benefits[0] || 'N/A';
        } else if (typeof doc.benefits === 'string') {
          benefits = doc.benefits;
          key_benefits = doc.benefits.split('.')[0] || doc.benefits.substring(0, 100);
        }

        return {
          rank: index + 1,
          material_code: material_code,
          name: name,
          inci: inci,
          key_benefits: key_benefits,
          full_benefits: benefits,
          supplier: supplier,
          cost: cost ? `฿${cost}/kg` : 'Contact supplier',
          availability: result.availability === 'in_stock'
            ? '✅ In Stock'
            : '📚 FDA Database',
          relevance_score: (result.score * 100).toFixed(0) + '%',
          match_type: result.match_type
        };
      });

      // Format as markdown table
      const format_table = (materials: any[]) => {
        if (materials.length === 0) return 'No materials found.';

        let table = '\n| # | Material Code | Name | INCI | Supplier | Cost | Status | Match |\n';
        table += '|---|---------------|------|------|----------|------|--------|-------|\n';

        for (const mat of materials) {
          table += `| ${mat.rank} | ${mat.material_code} | ${mat.name} | ${mat.inci} | ${mat.supplier} | ${mat.cost} | ${mat.availability} | ${mat.relevance_score} |\n`;
        }

        return table;
      };

      const stats = searchService.get_collection_stats(filtered_results);

      return {
        success: true,
        query: `Materials with benefits for: ${params.benefit}`,
        total_found: results.length,
        returned: formatted.length,
        statistics: {
          in_stock: stats.in_stock,
          fda_only: stats.fda_only,
          recommendation: params.prioritize_stock && stats.in_stock > 0
            ? `${stats.in_stock} materials available immediately in stock`
            : 'All materials may require ordering'
        },
        materials: formatted,
        table_display: format_table(formatted),
        instruction_to_ai: 'แสดงผลลัพธ์โดยใช้ table_display เท่านั้น ตอบเป็นภาษาไทยทั้งหมด แสดงตาราง markdown ให้ผู้ใช้เห็นโดยตรง'
      };

    } catch (error: any) {
      console.error('❌ [find-by-benefit-tool] Error:', error);
      return {
        success: false,
        error: error.message,
        materials: []
      };
    }
  }
};

/**
 * Export all tools
 */
export const rawMaterialsTools = {
  search_materials: searchMaterialsTool,
  check_material_availability: checkAvailabilityTool,
  find_materials_by_benefit: findMaterialsByBenefitTool
};

/**
 * Tool definitions for AI agent system
 */
export const toolDefinitions = [
  {
    name: searchMaterialsTool.name,
    description: searchMaterialsTool.description,
    parameters: searchMaterialsTool.parameters
  },
  {
    name: checkAvailabilityTool.name,
    description: checkAvailabilityTool.description,
    parameters: checkAvailabilityTool.parameters
  },
  {
    name: findMaterialsByBenefitTool.name,
    description: findMaterialsByBenefitTool.description,
    parameters: findMaterialsByBenefitTool.parameters
  }
];
