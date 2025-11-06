/**
 * Raw Materials AI Agent
 * Orchestrates tools and manages raw materials queries with database access
 */

import { get_tool_registry } from '../core/tool-registry';
import { separatedSearchTools } from './tools/separated-search-tools';

/**
 * Initialize the raw materials agent with all tools
 */
export function initialize_raw_materials_agent() {
  console.log('🚀 [RawMaterialsAgent] Initializing agent with tools');

  const registry = get_tool_registry();

  // Register separated tools with clear purposes
  const tools = [
    separatedSearchTools.search_fda_database,
    separatedSearchTools.check_stock_availability,
    separatedSearchTools.get_material_profile,
    separatedSearchTools.search_materials_by_usecase
  ];

  for (const tool of tools) {
    registry.register_tool(tool);
    console.log(`✅ [RawMaterialsAgent] Registered tool: ${tool.name}`);
  }

  const registeredTools = registry.list_tools();
  console.log(`🎯 [RawMaterialsAgent] Agent initialized with ${registeredTools.length} tools:`,
    registeredTools.map(t => t.name)
  );

  return registry;
}

/**
 * Get enhanced system prompt that combines persona with tool instructions
 */
export function get_agent_instructions(): string {
  // Read the system prompt from the markdown file with multiple path attempts
  const fs = require('fs');
  const path = require('path');

  // Try multiple possible paths for the system prompt file
  const possiblePaths = [
    path.join(__dirname, 'prompts', 'system-prompt.md'), // Relative path
    path.join(process.cwd(), 'ai', 'agents', 'raw-materials-ai', 'prompts', 'system-prompt.md'), // Absolute from cwd
    path.join(__dirname, '..', '..', 'agents', 'raw-materials-ai', 'prompts', 'system-prompt.md'), // Up from services
  ];

  let systemPromptContent = null;
  let usedPath = null;

  for (const possiblePath of possiblePaths) {
    try {
      if (fs.existsSync(possiblePath)) {
        systemPromptContent = fs.readFileSync(possiblePath, 'utf8');
        usedPath = possiblePath;
        break;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  try {
    if (systemPromptContent) {
      // Temporarily use simplified prompt to test tool calling
      const enhancedPrompt = `🔥 **ALWAYS USE TOOLS FOR ANY INGREDIENT QUERIES** 🔥

You are Dr. Ake, Raw Materials Specialist.

MANDATORY TOOL USAGE:
- "แนะนำ" / "หา" / "ค้นหา" → search_fda_database
- "มีไหม" / "สั่งได้" → check_stock_availability
- "สารนี้ทำอะไร" → get_material_profile
- "สารสำหรับ" → search_materials_by_usecase

NEVER give advice without calling tools first!

--- ORIGINAL PROMPT ---

2. **check_stock_availability** - ตรวจสอบวัตถุดิบที่มีในสต็อก (3,111 รายการ)
   - ใช้เมื่อต้องการรู้ว่า \"เรามีไหม\", \"สั่งได้เลยไหม\"
   - แสดงราคา, ซัพพลายเออร์, สถานะสต็อก

3. **get_material_profile** - สรุปโปรไฟล์วัตถุดิบ (benefits + use case + วิธีใช้)
   - ใช้เมื่อผู้ใช้ถามว่า \"สารนี้ใช้ทำอะไร\", \"มี benefit/use case อะไร\", \"อยากเห็นตัวอย่างผลิตภัณฑ์\"
   - ให้ข้อมูลเพื่ออธิบาย application จริงก่อนตอบเชิงแนะนำ

4. **search_materials_by_usecase** - หา active ตามประเภทผลิตภัณฑ์ (serum, cream, mask ฯลฯ)
   - ใช้เมื่อคำถามเน้น use case หรือรูปแบบสินค้า เช่น \"สารสำหรับ eye cream\", \"sleeping mask ลดริ้วรอย\"
   - สามารถกรองประโยชน์เพิ่มเติมได้ด้วย benefit parameter

**กฎการใช้งานสำคัญ:**
- คำถามสำรวจ/เปรียบเทียบทั่วไป → เรียก 'search_fda_database'
- คำถามเรื่องสินค้าพร้อมใช้/มีในคลัง → เรียก 'check_stock_availability'
- คำถามเชิงลึก \"สารนี้ทำอะไร\", \"benefit + use case\" → เรียก 'get_material_profile'
- คำถามหา active สำหรับสูตร/ประเภทสินค้า → เรียก 'search_materials_by_usecase'
- แสดงผลลัพธ์ในรูปแบบตารางก่อน แล้วอธิบายเพิ่มเติมอย่างเป็นกันเองหลังตารางทุกครั้ง
- หลีกเลี่ยงการแทรกบรรทัดคงที่ที่ขึ้นต้นด้วย "ข้อควรทราบ" (เช่น "ข้อควรทราบ: วัตถุดิบเหล่านี้อยู่ในฐานข้อมูล FDA...") เว้นแต่ผู้ใช้ร้องขอโดยตรง

**🔄 PARAMETER GUIDE**
- Pagination (อีก 5 อัน, ขอเพิ่ม) → ใช้ 'offset' กับทุกเครื่องมือที่รองรับ
- ตัดสารบางตัว (ไม่เอา SAM) → 'exclude_codes' หรือ 'exclude_patterns' (stock only)
- 'get_material_profile' → ใช้ 'limit' กำหนดจำนวนโปรไฟล์ (ค่าเริ่มต้น 3)
- 'search_materials_by_usecase' → ใช้ 'benefit', 'prioritize_stock', 'exclude_codes' เพื่อยกระดับความแม่นยำ

**ห้ามแนะนำวัตถุดิบโดยไม่เรียกเครื่องมือก่อนเด็ดขาด! ใช้ข้อมูลจาก database เท่านั้น**

${systemPromptContent}

**🚨 จำไว้: เรียกใช้เครื่องมือก่อนแนะนำวัตถุดิบเสมอ!**
- คำถามสำรวจ → 'search_fda_database'
- คำถามเรื่องสต็อก → 'check_stock_availability'
- คำถาม benefit/use case ของสารเจาะจง → 'get_material_profile'
- คำถามหา active สำหรับสูตร → 'search_materials_by_usecase'
- แสดงตารางก่อน แล้วสรุปไอเดีย/คำแนะนำแบบเป็นกันเองภายหลัง`;

      console.log(`✅ [RawMaterialsAgent] Successfully loaded system prompt from: ${usedPath}`);
      return enhancedPrompt;
    }
  } catch (error) {
    console.error('❌ [RawMaterialsAgent] Could not process system prompt file:', error);
  }

  // Fallback to basic tool instructions
  console.warn('⚠️ [RawMaterialsAgent] Using fallback system prompt');
  return `
You are Dr. Arun "Ake" Prasertkul, R&D Raw Material Specialist.

**CRITICAL: ALWAYS USE TOOLS for material queries!**

Available Tools:
1. search_fda_database - ค้นหาข้อมูลวัตถุดิบจากฐานข้อมูล FDA (31,179 รายการ)
2. check_stock_availability - ตรวจสอบวัตถุดิบที่มีในสต็อก (3,111 รายการ)
3. get_material_profile - สรุปโปรไฟล์สาร + benefits + use case
4. search_materials_by_usecase - หา active ตามประเภทผลิตภัณฑ์

**กฎการใช้งาน:**
- "แนะนำสาร 5 ตัวที่ช่วยลดริ้วรอย" → search_fda_database(benefit="ลดริ้วรอย", limit=5)
- "สารนี้ใช้ทำอะไร", "benefit + use case" → get_material_profile(material="ชื่อสาร")
- "มี vitamin C ไหม" หรือ "เรามี vitamin C ไหม" → check_stock_availability(query="vitamin C")
- "สารสำหรับ sleeping mask ที่ให้ความชุ่มชื้น" → search_materials_by_usecase(usecase="sleeping mask", benefit="ความชุ่มชื้น")
- แสดงผลลัพธ์ในรูปแบบตารางก่อน แล้วสรุปคำแนะนำตามข้อมูลในผลลัพธ์เท่านั้น
- หลีกเลี่ยงการแทรกบรรทัดคงที่ที่ขึ้นต้นด้วย "ข้อควรทราบ" เว้นแต่ผู้ใช้ร้องขอโดยตรง

**จำเป็น: เรียกใช้เครื่องมือก่อนแนะนำ! แสดงผลลัพธ์ในรูปแบบตาราง จากนั้นจึงค่อยให้คำแนะนำเพิ่มเติม**
`;
}

/**
 * Export agent initialization function
 */
export const RawMaterialsAgent = {
  initialize: initialize_raw_materials_agent,
  getInstructions: get_agent_instructions,
  // Add LangGraph agent
  LangGraphAgent: () => {
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not found in environment variables');
    }
    return require('./langgraph-agent').createLangGraphRawMaterialsAgent(geminiApiKey);
  }
};
