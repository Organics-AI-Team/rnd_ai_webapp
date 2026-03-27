/**
 * ReAct Agent Tool Definitions
 * Gemini function calling declarations for the ReAct (Reason + Act) agent.
 *
 * Defines 5 tools:
 *   1. qdrant_search   - Semantic similarity search across Qdrant collections
 *   2. mongo_query      - Direct MongoDB read-only queries
 *   3. formula_calculate - Batch cost, scaling, unit conversion
 *   4. web_search       - External web search
 *   5. context_memory   - Conversation history look-back
 *
 * All declarations use the plain-object format expected by
 * `@google/generative-ai` FunctionDeclaration[].
 *
 * @author AI Management System
 * @date 2026-03-27
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Union of all tool names the ReAct agent may invoke.
 * Keep in sync with the declarations array below.
 */
export type ReactToolName =
  | 'qdrant_search'
  | 'mongo_query'
  | 'formula_calculate'
  | 'web_search'
  | 'context_memory';

/**
 * Gemini-compatible function declaration shape.
 * Mirrors the structure expected by `tools: [{ functionDeclarations }]`.
 */
export interface GeminiFunctionDeclaration {
  name: ReactToolName;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

// ---------------------------------------------------------------------------
// Individual Tool Declarations
// ---------------------------------------------------------------------------

/**
 * Build the qdrant_search tool declaration.
 *
 * @returns GeminiFunctionDeclaration for semantic vector search across
 *          Qdrant collections (raw_materials_console, raw_materials_fda,
 *          raw_materials_stock, sales_rnd).
 */
function build_qdrant_search_declaration(): GeminiFunctionDeclaration {
  console.log('[ReActTools] Building qdrant_search declaration');

  return {
    name: 'qdrant_search',
    description:
      'Semantic similarity search across Qdrant vector collections. ' +
      'Use for ingredient discovery, material comparison, and R&D queries ' +
      'where exact field matching is insufficient.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description:
            'Natural-language search query, e.g. "moisturizing active for serum".',
        },
        collection: {
          type: 'STRING',
          description:
            'Target Qdrant collection to search.',
          enum: [
            'raw_materials_console',
            'raw_materials_fda',
            'raw_materials_stock',
            'raw_materials_myskin',
            'sales_rnd',
          ],
        },
        top_k: {
          type: 'NUMBER',
          description:
            'Maximum number of results to return. Defaults to 5, capped at 20.',
        },
        score_threshold: {
          type: 'NUMBER',
          description:
            'Minimum cosine similarity score (0-1). Defaults to 0.55.',
        },
        filters: {
          type: 'OBJECT',
          description:
            'Optional Qdrant payload filter object, e.g. {"supplier": "BASF"}. ' +
            'Keys must match indexed payload fields.',
        },
      },
      required: ['query', 'collection'],
    },
  };
}

/**
 * Build the mongo_query tool declaration.
 *
 * @returns GeminiFunctionDeclaration for direct read-only MongoDB queries
 *          against rnd_ai or raw_materials databases.
 */
function build_mongo_query_declaration(): GeminiFunctionDeclaration {
  console.log('[ReActTools] Building mongo_query declaration');

  return {
    name: 'mongo_query',
    description:
      'Execute a read-only MongoDB query. Use for exact field lookups, ' +
      'aggregations, counts, and structured data retrieval where ' +
      'vector search is unnecessary.',
    parameters: {
      type: 'OBJECT',
      properties: {
        collection: {
          type: 'STRING',
          description:
            'MongoDB collection name, e.g. "raw_materials", "formulas", "orders".',
        },
        database: {
          type: 'STRING',
          description: 'Target database.',
          enum: ['rnd_ai', 'raw_materials'],
        },
        operation: {
          type: 'STRING',
          description: 'MongoDB read operation to execute.',
          enum: ['find', 'findOne', 'aggregate', 'count'],
        },
        filter: {
          type: 'OBJECT',
          description:
            'MongoDB query filter object, e.g. {"rm_code": "RM001234"} or ' +
            '{"Function": {"$regex": "ANTI-AGING", "$options": "i"}}.',
        },
        projection: {
          type: 'OBJECT',
          description:
            'Fields to include/exclude, e.g. {"INCI_name": 1, "Function": 1, "_id": 0}.',
        },
        sort: {
          type: 'OBJECT',
          description:
            'Sort specification, e.g. {"cost": 1} for ascending cost.',
        },
        limit: {
          type: 'NUMBER',
          description:
            'Maximum documents to return. Defaults to 10, capped at 20.',
        },
      },
      required: ['collection', 'database', 'operation', 'filter'],
    },
  };
}

/**
 * Build the formula_calculate tool declaration.
 *
 * @returns GeminiFunctionDeclaration for cosmetic formula calculations
 *          including batch cost, scaling, and unit conversion.
 */
function build_formula_calculate_declaration(): GeminiFunctionDeclaration {
  console.log('[ReActTools] Building formula_calculate declaration');

  return {
    name: 'formula_calculate',
    description:
      'Perform cosmetic formula calculations: batch cost estimation, ' +
      'formula scaling, unit conversion, and ingredient percentage computation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        operation: {
          type: 'STRING',
          description: 'Calculation type to perform.',
          enum: [
            'batch_cost',
            'scale_formula',
            'unit_convert',
            'ingredient_percentage',
          ],
        },
        ingredients: {
          type: 'ARRAY',
          description:
            'List of ingredients with quantity, unit, and optional cost. ' +
            'Each item: {name: string, quantity: number, unit: string, cost_per_unit?: number}.',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING', description: 'Ingredient name or INCI name.' },
              quantity: { type: 'NUMBER', description: 'Amount of ingredient.' },
              unit: { type: 'STRING', description: 'Unit of measure (g, kg, ml, L, oz).' },
              cost_per_unit: {
                type: 'NUMBER',
                description: 'Cost per unit in THB. Required for batch_cost.',
              },
            },
            required: ['name', 'quantity', 'unit'],
          },
        },
        batch_size: {
          type: 'NUMBER',
          description:
            'Target batch size for scaling. Used with scale_formula and batch_cost.',
        },
        target_unit: {
          type: 'STRING',
          description: 'Target unit for unit_convert operation.',
          enum: ['g', 'kg', 'ml', 'L', 'oz', 'lb'],
        },
        formula_id: {
          type: 'STRING',
          description:
            'Optional formula ID to load ingredients from the database ' +
            'instead of passing them inline.',
        },
      },
      required: ['operation'],
    },
  };
}

/**
 * Build the web_search tool declaration.
 *
 * @returns GeminiFunctionDeclaration for external web search when
 *          internal databases lack the required information.
 */
function build_web_search_declaration(): GeminiFunctionDeclaration {
  console.log('[ReActTools] Building web_search declaration');

  return {
    name: 'web_search',
    description:
      'Search the external web for cosmetic science articles, regulatory ' +
      'updates, INCI references, or supplier information not available in ' +
      'internal databases.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description:
            'Search query string, e.g. "niacinamide concentration limits EU regulation 2025".',
        },
        max_results: {
          type: 'NUMBER',
          description:
            'Maximum number of search results to return. Defaults to 5, capped at 10.',
        },
      },
      required: ['query'],
    },
  };
}

/**
 * Build the context_memory tool declaration.
 *
 * @returns GeminiFunctionDeclaration for retrieving conversation history
 *          within a session to maintain contextual continuity.
 */
function build_context_memory_declaration(): GeminiFunctionDeclaration {
  console.log('[ReActTools] Building context_memory declaration');

  return {
    name: 'context_memory',
    description:
      'Retrieve recent conversation history for the current session. ' +
      'Use to recall earlier user preferences, mentioned ingredients, ' +
      'or formulation context without re-asking the user.',
    parameters: {
      type: 'OBJECT',
      properties: {
        session_id: {
          type: 'STRING',
          description: 'The active chat session identifier.',
        },
        lookback: {
          type: 'NUMBER',
          description:
            'Number of past messages to retrieve. Defaults to 10, capped at 50.',
        },
      },
      required: ['session_id'],
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the complete array of Gemini FunctionDeclaration objects for the
 * ReAct agent.
 *
 * Usage:
 * ```ts
 * const declarations = get_react_tool_declarations();
 * const model = genAI.getGenerativeModel({
 *   model: 'gemini-2.5-flash',
 *   tools: [{ functionDeclarations: declarations }],
 * });
 * ```
 *
 * @returns GeminiFunctionDeclaration[] - Array of 5 tool declarations.
 */
export function get_react_tool_declarations(): GeminiFunctionDeclaration[] {
  console.log('[ReActTools] get_react_tool_declarations() - start');

  const declarations: GeminiFunctionDeclaration[] = [
    build_qdrant_search_declaration(),
    build_mongo_query_declaration(),
    build_formula_calculate_declaration(),
    build_web_search_declaration(),
    build_context_memory_declaration(),
  ];

  console.log(
    `[ReActTools] get_react_tool_declarations() - built ${declarations.length} declarations: ` +
      declarations.map((d) => d.name).join(', ')
  );

  return declarations;
}
