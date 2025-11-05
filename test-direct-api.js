/**
 * Direct API test script to bypass client-side bundling issues
 * Tests the AI tool calling functionality directly
 */

async function testDirectAPI() {
  console.log('🧪 Testing Direct API (bypassing client-side issues)...');

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
    console.log('✅ Direct API test successful!');
    console.log('Response:', JSON.stringify(result, null, 2));

    // Check if AI attempted to call tools
    if (result.response) {
      // Check for tool execution evidence
      const hasToolEvidence = result.response.includes('find_materials_by_benefit') ||
                           result.response.includes('Function result:') ||
                           result.response.includes('tool call');

      const hasError = result.response.includes('error') ||
                    result.response.includes('sorry') ||
                    result.response.includes('cannot process');

      if (hasToolEvidence) {
        console.log('🎉 SUCCESS: AI attempted tool calling!');
      } else if (hasError) {
        console.log('⚠️ WARNING: AI encountered error during tool execution');
      } else {
        console.log('📊 INFO: AI response received (checking content...)');
        console.log('Response length:', result.response.length);
        console.log('Response preview:', result.response.substring(0, 200) + '...');
      }
    }

  } catch (error) {
    console.error('❌ Direct API test failed:', error.message);
  }
}

// Run test
testDirectAPI();