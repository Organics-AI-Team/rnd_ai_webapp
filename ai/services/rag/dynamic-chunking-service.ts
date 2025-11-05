/**
 * Dynamic Chunking Service
 * Intelligently chunks documents with field importance weighting
 *
 * Features:
 * - Multi-level chunking strategy
 * - Field importance weighting
 * - Semantic-aware chunking
 * - Overlap management
 * - Metadata preservation
 * - Dynamic chunk size based on content
 */

import { RawMaterialDocument } from './pinecone-service';

export interface ChunkConfig {
  /** Maximum chunk size in characters */
  max_chunk_size?: number;
  /** Minimum chunk size in characters */
  min_chunk_size?: number;
  /** Overlap between chunks (for context preservation) */
  chunk_overlap?: number;
  /** Field importance weights */
  field_weights?: Record<string, number>;
  /** Enable semantic-aware chunking */
  semantic_chunking?: boolean;
  /** Chunk priority levels */
  chunk_priorities?: Record<string, number>;
}

export interface Chunk {
  id: string;
  text: string;
  metadata: any;
  chunk_type: string;
  priority: number;
  field_source: string[];
  character_count: number;
}

/**
 * Default field importance weights
 * Higher values = more important for search
 */
const DEFAULT_FIELD_WEIGHTS: Record<string, number> = {
  rm_code: 1.0,          // Highest priority - exact identifier
  trade_name: 0.95,      // Very high priority - common search term
  inci_name: 0.9,        // High priority - technical identifier
  supplier: 0.75,        // Medium-high priority
  company_name: 0.7,     // Medium priority
  benefits: 0.85,        // High priority - common search context
  details: 0.8,          // High priority - detailed information
  rm_cost: 0.65,         // Medium priority
  category: 0.7,         // Medium priority
  function: 0.75         // Medium-high priority
};

/**
 * Chunk priority levels
 * Determines which chunks to index first and boost in search
 */
const CHUNK_PRIORITIES: Record<string, number> = {
  primary_identifier: 1.0,    // Codes and names
  technical_specs: 0.9,       // INCI, categories, functions
  commercial_info: 0.8,       // Supplier, cost, company
  descriptive_content: 0.7,   // Benefits, details
  combined_context: 0.85      // Multi-field combinations
};

/**
 * Dynamic Chunking Service
 * Creates optimized document chunks for vector indexing
 */
export class DynamicChunkingService {
  private config: ChunkConfig;

  constructor(config: Partial<ChunkConfig> = {}) {
    this.config = {
      max_chunk_size: config.max_chunk_size || 500,
      min_chunk_size: config.min_chunk_size || 50,
      chunk_overlap: config.chunk_overlap || 50,
      field_weights: { ...DEFAULT_FIELD_WEIGHTS, ...config.field_weights },
      semantic_chunking: config.semantic_chunking !== false,
      chunk_priorities: { ...CHUNK_PRIORITIES, ...config.chunk_priorities }
    };

    console.log('🔧 [dynamic-chunking] Initialized with config:', this.config);
  }

  /**
   * Main method: Chunk raw material document with multiple strategies
   */
  chunk_raw_material_document(material: any): Chunk[] {
    console.log('📄 [dynamic-chunking] Chunking document:', material.rm_code || 'unknown');

    const chunks: Chunk[] = [];
    const base_id = material._id?.toString() || material.rm_code || Math.random().toString();

    // Strategy 1: Primary Identifier Chunk (highest priority)
    const primary_chunk = this.create_primary_identifier_chunk(material, base_id);
    if (primary_chunk) chunks.push(primary_chunk);

    // Strategy 2: Code-Only Exact Match Chunk
    const code_chunk = this.create_code_match_chunk(material, base_id);
    if (code_chunk) chunks.push(code_chunk);

    // Strategy 3: Technical Specifications Chunk
    const tech_chunk = this.create_technical_specs_chunk(material, base_id);
    if (tech_chunk) chunks.push(tech_chunk);

    // Strategy 4: Commercial Information Chunk
    const commercial_chunk = this.create_commercial_info_chunk(material, base_id);
    if (commercial_chunk) chunks.push(commercial_chunk);

    // Strategy 5: Descriptive Content Chunks (can be multiple)
    const desc_chunks = this.create_descriptive_chunks(material, base_id);
    chunks.push(...desc_chunks);

    // Strategy 6: Combined Context Chunk (for semantic search)
    const combined_chunk = this.create_combined_context_chunk(material, base_id);
    if (combined_chunk) chunks.push(combined_chunk);

    // Strategy 7: Multilingual Chunks (Thai + English)
    const multilingual_chunks = this.create_multilingual_chunks(material, base_id);
    chunks.push(...multilingual_chunks);

    console.log(`✅ [dynamic-chunking] Created ${chunks.length} chunks for ${material.rm_code}`);

    return chunks;
  }

  /**
   * Strategy 1: Primary Identifier Chunk
   * Contains codes and names - optimized for exact matching
   */
  private create_primary_identifier_chunk(material: any, base_id: string): Chunk | null {
    const parts: string[] = [];
    const fields: string[] = [];

    if (material.rm_code) {
      parts.push(`Material Code: ${material.rm_code}`);
      parts.push(`Code: ${material.rm_code}`);
      parts.push(material.rm_code); // Raw code
      fields.push('rm_code');
    }

    if (material.trade_name) {
      parts.push(`Trade Name: ${material.trade_name}`);
      parts.push(material.trade_name); // Raw name
      fields.push('trade_name');
    }

    if (material.inci_name) {
      parts.push(`INCI Name: ${material.inci_name}`);
      parts.push(`INCI: ${material.inci_name}`);
      fields.push('inci_name');
    }

    if (parts.length === 0) return null;

    return {
      id: `${base_id}_primary_id`,
      text: parts.join('. '),
      metadata: {
        ...material,
        chunk_type: 'primary_identifier',
        search_boost: 1.0
      },
      chunk_type: 'primary_identifier',
      priority: this.config.chunk_priorities!.primary_identifier,
      field_source: fields,
      character_count: parts.join('. ').length
    };
  }

  /**
   * Strategy 2: Code-Only Exact Match Chunk
   * Minimal chunk for exact code searches
   */
  private create_code_match_chunk(material: any, base_id: string): Chunk | null {
    if (!material.rm_code) return null;

    const text = `${material.rm_code} ${material.trade_name || ''}`.trim();

    return {
      id: `${base_id}_code_exact`,
      text,
      metadata: {
        ...material,
        chunk_type: 'code_exact_match',
        search_boost: 1.0
      },
      chunk_type: 'code_exact_match',
      priority: 1.0,
      field_source: ['rm_code', 'trade_name'],
      character_count: text.length
    };
  }

  /**
   * Strategy 3: Technical Specifications Chunk
   * INCI, category, function - for technical searches
   */
  private create_technical_specs_chunk(material: any, base_id: string): Chunk | null {
    const parts: string[] = [];
    const fields: string[] = [];

    if (material.inci_name) {
      parts.push(`INCI Name: ${material.inci_name}`);
      fields.push('inci_name');
    }

    if (material.category) {
      parts.push(`Category: ${material.category}`);
      fields.push('category');
    }

    if (material.function) {
      parts.push(`Function: ${material.function}`);
      fields.push('function');
    }

    if (material.trade_name) {
      parts.push(`Trade Name: ${material.trade_name}`);
      fields.push('trade_name');
    }

    if (parts.length === 0) return null;

    return {
      id: `${base_id}_tech_specs`,
      text: parts.join('. '),
      metadata: {
        ...material,
        chunk_type: 'technical_specs',
        search_boost: 0.9
      },
      chunk_type: 'technical_specs',
      priority: this.config.chunk_priorities!.technical_specs,
      field_source: fields,
      character_count: parts.join('. ').length
    };
  }

  /**
   * Strategy 4: Commercial Information Chunk
   * Supplier, cost, company - for business queries
   */
  private create_commercial_info_chunk(material: any, base_id: string): Chunk | null {
    const parts: string[] = [];
    const fields: string[] = [];

    if (material.rm_code) {
      parts.push(`Material: ${material.rm_code}`);
      fields.push('rm_code');
    }

    if (material.supplier) {
      parts.push(`Supplier: ${material.supplier}`);
      fields.push('supplier');
    }

    if (material.company_name) {
      parts.push(`Company: ${material.company_name}`);
      fields.push('company_name');
    }

    if (material.rm_cost) {
      parts.push(`Cost: ${material.rm_cost}`);
      fields.push('rm_cost');
    }

    if (parts.length <= 1) return null; // Need more than just code

    return {
      id: `${base_id}_commercial`,
      text: parts.join('. '),
      metadata: {
        ...material,
        chunk_type: 'commercial_info',
        search_boost: 0.8
      },
      chunk_type: 'commercial_info',
      priority: this.config.chunk_priorities!.commercial_info,
      field_source: fields,
      character_count: parts.join('. ').length
    };
  }

  /**
   * Strategy 5: Descriptive Content Chunks
   * Benefits and details - can be split into multiple chunks if long
   */
  private create_descriptive_chunks(material: any, base_id: string): Chunk[] {
    const chunks: Chunk[] = [];

    // Benefits chunk
    if (material.benefits) {
      const benefits_text = `${material.trade_name || material.rm_code}: Benefits - ${material.benefits}`;

      chunks.push({
        id: `${base_id}_benefits`,
        text: benefits_text,
        metadata: {
          ...material,
          chunk_type: 'benefits',
          search_boost: 0.85
        },
        chunk_type: 'benefits',
        priority: this.config.chunk_priorities!.descriptive_content,
        field_source: ['benefits'],
        character_count: benefits_text.length
      });
    }

    // Details chunk
    if (material.details) {
      const details_text = `${material.trade_name || material.rm_code}: Details - ${material.details}`;

      // Split into smaller chunks if too long
      const detail_chunks = this.split_long_text(
        details_text,
        material,
        base_id,
        'details'
      );

      chunks.push(...detail_chunks);
    }

    return chunks;
  }

  /**
   * Strategy 6: Combined Context Chunk
   * All fields combined for comprehensive semantic search
   */
  private create_combined_context_chunk(material: any, base_id: string): Chunk | null {
    const parts: string[] = [];

    // Add all available fields in priority order
    const field_priority = [
      'rm_code',
      'trade_name',
      'inci_name',
      'category',
      'function',
      'benefits',
      'supplier',
      'company_name',
      'rm_cost',
      'details'
    ];

    field_priority.forEach(field => {
      if (material[field]) {
        const field_name = field.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        parts.push(`${field_name}: ${material[field]}`);
      }
    });

    if (parts.length === 0) return null;

    const combined_text = parts.join('. ');

    // Truncate if too long
    const max_length = this.config.max_chunk_size || 500;
    const truncated_text = combined_text.length > max_length
      ? combined_text.substring(0, max_length) + '...'
      : combined_text;

    return {
      id: `${base_id}_combined`,
      text: truncated_text,
      metadata: {
        ...material,
        chunk_type: 'combined_context',
        search_boost: 0.85
      },
      chunk_type: 'combined_context',
      priority: this.config.chunk_priorities!.combined_context,
      field_source: field_priority.filter(f => material[f]),
      character_count: truncated_text.length
    };
  }

  /**
   * Strategy 7: Multilingual Chunks
   * Create chunks optimized for Thai and English searches
   */
  private create_multilingual_chunks(material: any, base_id: string): Chunk[] {
    const chunks: Chunk[] = [];

    // Thai-optimized chunk
    const thai_parts: string[] = [];
    if (material.rm_code) thai_parts.push(`รหัสสาร: ${material.rm_code}`);
    if (material.trade_name) thai_parts.push(`ชื่อการค้า: ${material.trade_name}`);
    if (material.inci_name) thai_parts.push(`ชื่อ INCI: ${material.inci_name}`);
    if (material.supplier) thai_parts.push(`ซัพพลายเออร์: ${material.supplier}`);
    if (material.benefits) thai_parts.push(`ประโยชน์: ${material.benefits}`);

    if (thai_parts.length > 0) {
      chunks.push({
        id: `${base_id}_thai`,
        text: thai_parts.join('. '),
        metadata: {
          ...material,
          chunk_type: 'thai_optimized',
          language: 'thai',
          search_boost: 0.9
        },
        chunk_type: 'thai_optimized',
        priority: 0.9,
        field_source: ['multilingual'],
        character_count: thai_parts.join('. ').length
      });
    }

    return chunks;
  }

  /**
   * Split long text into smaller chunks with overlap
   */
  private split_long_text(
    text: string,
    material: any,
    base_id: string,
    field: string
  ): Chunk[] {
    const max_size = this.config.max_chunk_size || 500;
    const overlap = this.config.chunk_overlap || 50;

    if (text.length <= max_size) {
      return [{
        id: `${base_id}_${field}_0`,
        text,
        metadata: {
          ...material,
          chunk_type: field,
          chunk_index: 0,
          search_boost: 0.7
        },
        chunk_type: field,
        priority: this.config.chunk_priorities!.descriptive_content,
        field_source: [field],
        character_count: text.length
      }];
    }

    const chunks: Chunk[] = [];
    let start = 0;
    let chunk_index = 0;

    while (start < text.length) {
      const end = Math.min(start + max_size, text.length);
      const chunk_text = text.substring(start, end);

      chunks.push({
        id: `${base_id}_${field}_${chunk_index}`,
        text: chunk_text,
        metadata: {
          ...material,
          chunk_type: field,
          chunk_index,
          is_split: true,
          search_boost: 0.7
        },
        chunk_type: field,
        priority: this.config.chunk_priorities!.descriptive_content,
        field_source: [field],
        character_count: chunk_text.length
      });

      start += max_size - overlap;
      chunk_index++;
    }

    return chunks;
  }

  /**
   * Convert chunks to RawMaterialDocument format for Pinecone
   */
  chunks_to_documents(chunks: Chunk[]): RawMaterialDocument[] {
    return chunks.map(chunk => ({
      id: chunk.id,
      text: chunk.text,
      metadata: {
        ...chunk.metadata,
        chunk_type: chunk.chunk_type,
        priority: chunk.priority,
        field_source: chunk.field_source.join(','),
        character_count: chunk.character_count,
        source: 'raw_materials_real_stock'
      }
    }));
  }

  /**
   * Get chunk statistics for monitoring
   */
  get_chunk_stats(chunks: Chunk[]): any {
    const stats = {
      total_chunks: chunks.length,
      by_type: {} as Record<string, number>,
      avg_character_count: 0,
      total_characters: 0,
      priority_distribution: {} as Record<string, number>
    };

    chunks.forEach(chunk => {
      stats.by_type[chunk.chunk_type] = (stats.by_type[chunk.chunk_type] || 0) + 1;
      stats.total_characters += chunk.character_count;

      const priority_bucket = Math.floor(chunk.priority * 10) / 10;
      stats.priority_distribution[priority_bucket] =
        (stats.priority_distribution[priority_bucket] || 0) + 1;
    });

    stats.avg_character_count = stats.total_characters / chunks.length;

    return stats;
  }
}
