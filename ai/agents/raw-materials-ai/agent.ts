/**
 * Raw Materials AI Agent
 * Orchestrates tools and manages raw materials queries with database access
 */

import { get_tool_registry } from '../core/tool-registry';
import { rawMaterialsTools } from './tools/search-materials';

/**
 * Initialize the raw materials agent with all tools
 */
export function initialize_raw_materials_agent() {
  console.log('🚀 [RawMaterialsAgent] Initializing agent with tools');

  const registry = get_tool_registry();

  // Register all raw materials tools
  const tools = [
    rawMaterialsTools.search_materials,
    rawMaterialsTools.check_material_availability,
    rawMaterialsTools.find_materials_by_benefit
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

You have THREE specific tools available. ALWAYS use them for ANY factual queries:

1. **search_materials** - General search for ingredients/materials
2. **find_materials_by_benefit** - Find materials for specific benefits (like "ลดสิว")
3. **check_material_availability** - Check if specific material is in stock

**NEVER give ingredient recommendations without using tools first!**

${systemPromptContent}

**🚨 REMEMBER: Always call tools before providing any material recommendations!**
- User asks for ingredients → Use tools first
- User asks for benefits → Use find_materials_by_benefit
- User asks for availability → Use check_material_availability
- Present tool results in table format, then add expert analysis`;

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
1. search_materials - General search for ingredients/materials
2. find_materials_by_benefit - Find materials for specific benefits (like "ลดสิว", "acne")
3. check_material_availability - Check stock availability

**USAGE RULES:**
- User asks "แนะนำ สาร 5 ตัวที่ช่วยลดสิว" → Call find_materials_by_benefit(benefit="สิว", count=5)
- User asks "หาวัตถุดิบสำหรับ..." → Call search_materials(query="...")
- User asks "มี [material] ไหม?" → Call check_material_availability(material_name_or_code="...")

**ALWAYS use tools before providing recommendations! Present results in table format, then add expert analysis.**
`;
}

/**
 * Export agent initialization function
 */
export const RawMaterialsAgent = {
  initialize: initialize_raw_materials_agent,
  getInstructions: get_agent_instructions
};
