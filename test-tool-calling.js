/**
 * Test script to verify tool calling fixes
 */

async function testRawMaterialsAgent() {
  console.log('🧪 Testing Raw Materials Agent with tool calling...');

  try {
    const response = await fetch('http://localhost:3000/api/ai/raw-materials-agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'แนะนำ สาร 5 ตัวที่ช่วยลดสิว พร้อม rm code',
        userId: 'test-user-123'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Test successful!');
    console.log('Response:', JSON.stringify(result, null, 2));

    // Check if tools were called
    if (result.response && result.response.includes('table_display') || result.response.includes('| # |')) {
      console.log('🎉 SUCCESS: Tools were called and results formatted as table!');
    } else if (result.response && result.response.includes('แน่นอนค่ะ')) {
      console.log('⚠️ WARNING: AI gave generic response without calling tools');
    } else {
      console.log('❓ UNKNOWN: Could not determine if tools were called');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run test
testRawMaterialsAgent();