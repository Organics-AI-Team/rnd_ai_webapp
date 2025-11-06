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
    separatedSearchTools.check_stock_availability
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
      // Add critical tool usage reminder at the top
      const enhancedPrompt = `🔧 **CRITICAL TOOL USAGE INSTRUCTIONS** 🔧

You have TWO specific tools available. ALWAYS use them for ANY factual queries:

1. **search_fda_database** - ค้นหาข้อมูลวัตถุดิบจากฐานข้อมูล FDA (31,179 รายการ)
   - ใช้เมื่อต้องการค้นหาข้อมูลครบถ้วน
   - ค้นหาตามประโยชน์ หรือหมวดหมู่
   - แสดงข้อมูล INCI, function, benefits ครบถ้วน

2. **check_stock_availability** - ตรวจสอบวัตถุดิบที่มีในสต็อก (3,111 รายการ)
   - ใช้เมื่อต้องการตรวจสอบสต็อก
   - ค้นหาวัตถุดิบที่สามารถสั่งซื้อได้ทันที
   - แสดงราคา ซัพพลายเออร์ ข้อมูลสต็อก

**กฎการใช้งานสำคัญ:**
- ถามถามเรื่องวัตถุดิบทั่วไป → ใช้ search_fda_database
- ถามถามถามว่า "มีอะไรบ้างที่ช่วย..." → ใช้ search_fda_database
- ถามถามถามว่า "เรามีอะไรไหม" หรือ "มี...ในสต็อกไหม" → ใช้ check_stock_availability
- ถามถามถามถามว่า "สารที่มีอยู่ใน stock" → ใช้ check_stock_availability

**🔄 PAGINATION และ EXCLUSION:**
- เมื่อผู้ใช้ถาม "อีก 5 สาร", "อีก 10 อัน", "ขอเพิ่ม" → ใช้ parameter: offset=จำนวนที่แสดงไปแล้ว
- เมื่อผู้ใช้ถาม "ที่ไม่ใช่ SAM", "ไม่เอาที่ขึ้นต้นด้วย SAM" → ใช้ exclude_codes หรือ exclude_patterns
- ต้องติดตามว่าแสดงผลลัพธ์ไปแล้วกี่รายการเพื่อใช้ offset ต่อ
- สำหรับ stock: ใช้ exclude_patterns เพื่อกรอง "SAM", "สมุนไพร" ที่ไม่ต้องการ
- สำหรับ FDA: ใช้ exclude_codes กับ RM codes ที่แสดงไปแล้ว

**ห้ามแนะนำวัตถุดิบโดยไม่ใช้เครื่องมูลก่อนเสมอะดู!**

${systemPromptContent}

**🚨 จำไว้: เรียกใช้เครื่องมูลก่อนแนะนำวัตถุดิบเสมอะดู!**
- ถามถามเรื่องวัตถุดิบทั่วไป → เรียก search_fda_database ก่อน
- ถามถามเรื่องประโยชน์ เช่น "ช่วยลดริ้วรอย" → เรียก search_fda_database ก่อน
- ถามถามเรื่องสต็อก "มี...ไหม" หรือ "เรามี..." → เรียก check_stock_availability ก่อน
- แสดงผลลัพธ์ในรูปแบบตาราง จากนั้นนั้น จากนั้นคำแนะนำเพิ่มเติม`;

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

**กฎการใช้งาน:**
- ถามถาม "แนะนำสาร 5 ตัวที่ช่วยลดริ้วรอย" → เรียก search_fda_database(benefit="ลดริ้วรอย", limit=5)
- ถามถาม "หาวัตถุดิบสำหรับความชุ่มชื้น" → เรียก search_fda_database(benefit="ความชุ่มชื้น", limit=5)
- ถามถาม "มี vitamin C ไหม" หรือ "เรามี vitamin C ไหม" → เรียก check_stock_availability(query="vitamin C")
- ถามถาม "สารที่มีอยู่ใน stock" → เรียก check_stock_availability(query="")

**จำเป็น: เรียกใช้เครื่องมูลก่อนแนะนำ! แสดงผลลัพธ์ในรูปแบบตารางจากนั้นนั้น จากนั้นคำแนะนำเพิ่มเติม**
`;
}

/**
 * Export agent initialization function
 */
export const RawMaterialsAgent = {
  initialize: initialize_raw_materials_agent,
  getInstructions: get_agent_instructions
};
