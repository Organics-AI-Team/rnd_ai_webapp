#!/usr/bin/env tsx

/**
 * Test current behavior and see if our routing changes work
 */

import { config } from 'dotenv';
import { getUnifiedSearchService } from '../ai/services/rag/unified-search-service';

// Load environment variables (same as dev server)
config({ path: '.env.local' });

async function testSearchBehavior() {
  console.log('🧪 TESTING CURRENT SEARCH BEHAVIOR\n');

  try {
    const searchService = getUnifiedSearchService();

    // Test 1: General query (should default to FDA only now)
    console.log('1. Testing general query: "moisturizing"');
    const generalResults = await searchService.unified_search("moisturizing", {
      topK: 3,
      include_availability_context: true
    });

    console.log(`   Found ${generalResults.length} results`);
    generalResults.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.document?.rm_code} - ${result.document?.trade_name || result.document?.name} (${result.availability})`);
    });

    // Test 2: Stock-specific query (should use stock only)
    console.log('\n2. Testing stock query: "สารที่เรามีช่วยให้ชุ่มชื้น"');
    const stockResults = await searchService.unified_search("สารที่เรามีช่วยให้ชุ่มชื้น", {
      topK: 3,
      include_availability_context: true
    });

    console.log(`   Found ${stockResults.length} results`);
    stockResults.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.document?.rm_code} - ${result.document?.trade_name || result.document?.name} (${result.availability})`);
    });

    // Test 3: Check for malformed codes
    console.log('\n3. Checking for malformed codes in results...');
    const allResults = [...generalResults, ...stockResults];
    const malformedCodes = allResults.filter(r => {
      const code = r.document?.rm_code;
      return code && (
        /^[A-Z]+[ก-๙]/.test(code) ||  // Starts with English then Thai
        /^[ก-๙]/.test(code) ||       // Starts with Thai
        /\s/.test(code)              // Contains spaces
      );
    });

    if (malformedCodes.length > 0) {
      console.log(`   ⚠️  Found ${malformedCodes.length} malformed codes:`);
      malformedCodes.forEach(r => {
        console.log(`     - ${r.document?.rm_code} -> ${r.document?.trade_name || r.document?.name}`);
      });
    } else {
      console.log('   ✅ No malformed codes found!');
    }

    // Test 4: Check for proper RM codes
    console.log('\n4. Checking for proper RM codes...');
    const properCodes = allResults.filter(r => {
      const code = r.document?.rm_code;
      return code && /^RM\d{6}$/.test(code);
    });

    if (properCodes.length > 0) {
      console.log(`   ✅ Found ${properCodes.length} proper RM codes:`);
      properCodes.slice(0, 3).forEach(r => {
        console.log(`     - ${r.document?.rm_code} -> ${r.document?.trade_name || r.document?.name}`);
      });
    } else {
      console.log('   ❌ No proper RM codes found!');
    }

  } catch (error: any) {
    console.error('❌ Error testing search behavior:', error.message);
  }
}

testSearchBehavior().catch(console.error);