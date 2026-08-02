/**
 * Stock Lookup Tool Handler
 *
 * Queries the real-stock collection first and keeps catalog matches separate
 * when live availability cannot be confirmed. This gives the unified R&D
 * agent one truthful source for materials and stock requests.
 */

import main_client_promise, { raw_materials_client_promise } from '@rnd-ai/shared-database';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

interface StockLookupParams {
  query: string;
  supplier?: string;
  limit?: number;
}

interface StockMaterial {
  material_code: string | null;
  trade_name: string | null;
  inci_name: string | null;
  supplier: string | null;
  cost_per_kg: number | null;
  stock_status: string | null;
}

/** Escape a user search term before including it in a MongoDB regular expression. */
function escape_regex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a safe cross-field lookup filter for raw-material records. */
function build_stock_filter(query: string, supplier?: string): Record<string, unknown> {
  const query_regex = new RegExp(escape_regex(query.trim()), 'i');
  const filter: Record<string, unknown> = {
    $or: [
      { rm_code: query_regex },
      { materialCode: query_regex },
      { trade_name: query_regex },
      { productName: query_regex },
      { INCI_name: query_regex },
      { inci_name: query_regex },
      { Function: query_regex },
      { benefits: query_regex },
      { usecase: query_regex },
    ],
  };

  if (supplier?.trim()) {
    filter.supplier = new RegExp(escape_regex(supplier.trim()), 'i');
  }

  return filter;
}

/** Normalise the fields used by the stock and catalog collections. */
function format_material(document: Record<string, any>): StockMaterial {
  const raw_cost = document.rm_cost ?? document.cost ?? document.unitPrice ?? null;
  const numeric_cost = Number(raw_cost);

  return {
    material_code: document.rm_code || document.materialCode || document.code || null,
    trade_name: document.trade_name || document.productName || document.name || null,
    inci_name: document.INCI_name || document.inci_name || document.inci || null,
    supplier: document.supplier || document.company_name || null,
    cost_per_kg: Number.isFinite(numeric_cost) ? numeric_cost : null,
    stock_status: document.stock_status || document.stockStatus || null,
  };
}

/** Read material records from a collection and return only agent-safe fields. */
async function find_materials(
  client_promise: Promise<any>,
  collection_name: string,
  filter: Record<string, unknown>,
  limit: number,
): Promise<StockMaterial[]> {
  const client = await client_promise;
  const documents = await client
    .db()
    .collection(collection_name)
    .find(filter)
    .project({
      rm_code: 1,
      materialCode: 1,
      code: 1,
      trade_name: 1,
      productName: 1,
      name: 1,
      INCI_name: 1,
      inci_name: 1,
      inci: 1,
      supplier: 1,
      company_name: 1,
      rm_cost: 1,
      cost: 1,
      unitPrice: 1,
      stock_status: 1,
      stockStatus: 1,
    })
    .limit(limit)
    .toArray();

  return documents.map((document: Record<string, any>) => format_material(document));
}

/**
 * Look up real stock availability and catalog alternatives for the unified agent.
 *
 * @param params - Search text, optional supplier restriction, and result limit.
 * @returns JSON describing confirmed stock matches and clearly labelled catalog matches.
 */
export async function handle_stock_lookup(params: StockLookupParams): Promise<string> {
  const start_ts = Date.now();
  console.log('[stock-lookup] handle_stock_lookup — start', {
    query: params.query,
    supplier: params.supplier,
    limit: params.limit,
  });

  if (!params.query?.trim()) {
    return JSON.stringify({ error: 'query is required for stock_lookup' });
  }

  const limit = Math.min(Math.max(1, params.limit || DEFAULT_LIMIT), MAX_LIMIT);
  const filter = build_stock_filter(params.query, params.supplier);

  try {
    const [stock_result, catalog_result] = await Promise.allSettled([
      find_materials(raw_materials_client_promise, 'raw_materials_real_stock', filter, limit),
      find_materials(main_client_promise, 'raw_materials_console', filter, limit),
    ]);

    const stock_matches = stock_result.status === 'fulfilled' ? stock_result.value : [];
    const catalog_matches = catalog_result.status === 'fulfilled' ? catalog_result.value : [];
    const stock_error = stock_result.status === 'rejected'
      ? (stock_result.reason instanceof Error ? stock_result.reason.message : String(stock_result.reason))
      : null;

    const elapsed = Date.now() - start_ts;
    console.log('[stock-lookup] handle_stock_lookup — done', {
      stock_matches: stock_matches.length,
      catalog_matches: catalog_matches.length,
      stock_query_failed: !!stock_error,
      elapsed_ms: elapsed,
    });

    return JSON.stringify({
      query: params.query,
      availability: stock_matches.length > 0
        ? 'confirmed_in_stock'
        : stock_error
          ? 'stock_unavailable_to_verify'
          : 'not_found_in_current_stock',
      stock_matches,
      catalog_matches: stock_matches.length === 0 ? catalog_matches : [],
      note: stock_matches.length > 0
        ? 'stock_matches are from raw_materials_real_stock and may be presented as available.'
        : catalog_matches.length > 0
          ? 'catalog_matches are reference records only; do not claim they are in stock.'
          : 'No matching material was found in current stock or the catalog.',
      stock_error,
    });
  } catch (error) {
    const err_msg = error instanceof Error ? error.message : String(error);
    console.error('[stock-lookup] handle_stock_lookup — error', { error: err_msg });
    return JSON.stringify({ error: `Stock lookup failed: ${err_msg}` });
  }
}
