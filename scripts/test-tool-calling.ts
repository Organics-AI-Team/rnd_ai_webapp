/**
 * Test Tool Calling with Raw Materials Agent
 * Tests the orchestrator and tool execution
 */

import { config } from 'dotenv';
import { RawMaterialsAgent } from '../ai/agents/raw-materials-ai/agent';
import { GeminiToolService } from '../ai/services/providers/gemini-tool-service';

// Load environment variables
config({ path: '.env.local' });

const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

/**
 * Test queries that should trigger different tools
 */
const TEST_QUERIES = [
  {
    name: 'Find materials by benefit (Thai)',
    query: 'หาสาร 5 ตัวที่มีประโยชน์เรื่อง ผิว',
    expectedTool: 'find_materials_by_benefit'
  },
  {
    name: 'Check availability (Thai)',
    query: 'มี Vitamin C ไหม?',
    expectedTool: 'check_material_availability'
  },
  {
    name: 'General search',
    query: 'ค้นหาวัตถุดิบที่ช่วยความชุ่มชื้น',
    expectedTool: 'search_materials'
  },
  {
    name: 'Find materials by benefit (English)',
    query: 'Find 5 materials with anti-aging benefits',
    expectedTool: 'find_materials_by_benefit'
  },
  {
    name: 'Check availability (English)',
    query: 'Do we have Niacinamide in stock?',
    expectedTool: 'check_material_availability'
  }
];

async function test_tool_calling() {
  console.log('🧪 ========================================');
  console.log('🧪 TESTING RAW MATERIALS AGENT TOOL CALLING');
  console.log('🧪 ========================================\n');

  if (!GEMINI_API_KEY) {
    console.error('❌ NEXT_PUBLIC_GEMINI_API_KEY not found in environment');
    process.exit(1);
  }

  try {
    // Initialize agent with tools
    console.log('🚀 Initializing Raw Materials Agent...');
    const toolRegistry = RawMaterialsAgent.initialize();

    const registeredTools = toolRegistry.list_tools();
    console.log(`✅ Agent initialized with ${registeredTools.length} tools:`);
    registeredTools.forEach(tool => {
      console.log(`   - ${tool.name}: ${tool.description.split('\n')[0]}`);
    });
    console.log('');

    // Create Gemini tool service
    console.log('🤖 Creating Gemini Tool Service...');
    const service = new GeminiToolService(
      GEMINI_API_KEY,
      toolRegistry,
      {
        model: 'gemini-2.0-flash-exp',
        temperature: 0.7,
        maxTokens: 9000
      },
      'test-raw-materials-agent'
    );
    console.log('✅ Service created successfully\n');

    // Test each query
    for (const test of TEST_QUERIES) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📝 Test: ${test.name}`);
      console.log(`❓ Query: "${test.query}"`);
      console.log(`🎯 Expected Tool: ${test.expectedTool}`);
      console.log('');

      try {
        const startTime = Date.now();

        const response = await service.generateResponse({
          prompt: test.query,
          userId: 'test-user',
          context: {
            category: 'raw-materials'
          }
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log('✅ Response received:');
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`📄 Response (first 500 chars):`);
        console.log(response.response.substring(0, 500));
        if (response.response.length > 500) {
          console.log('...(truncated)');
        }
        console.log('');

      } catch (error: any) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
      }

      console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ALL TESTS COMPLETED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('🔥 Fatal error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run tests
test_tool_calling().catch(error => {
  console.error('🔥 Unhandled error:', error);
  process.exit(1);
});
