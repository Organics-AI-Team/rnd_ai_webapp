/**
 * Utility functions for parsing and handling array fields from database
 */

export function parseArrayField(field: any): string[] {
  if (!field) return [];

  if (Array.isArray(field)) {
    return field.filter(item => item && item.trim() !== '');
  }

  if (typeof field === 'string') {
    try {
      const cleaned = field.replace(/^\[\'|'\]$/g, '').trim();
      if (!cleaned) return [];

      const items = cleaned.split(/\'\s*,\s*\'/).map(item =>
        item.replace(/^\'|\'$/g, '').trim()
      ).filter(item => item !== '');

      return items;
    } catch {
      return [field];
    }
  }

  return [String(field)];
}

export function parseBenefitsField(material: any): string[] {
  return parseArrayField(material.benefits || material.benefits_cached);
}

export function parseUseCaseField(material: any): string[] {
  return parseArrayField(material.usecase || material.usecase_cached);
}

export function parseKeywordsField(material: any): string[] {
  return parseArrayField(material.keywords || material.keywords_cached);
}

export function parseIngredientsField(formula: any): string[] {
  return parseArrayField(formula.ingredients || formula.ingredients_cached);
}

/**
 * Clean and format array values for database storage
 */
export function formatArrayForStorage(items: string[]): string {
  if (!items || items.length === 0) return "[]";

  const cleanItems = items
    .filter(item => item && item.trim() !== '')
    .map(item => item.trim().replace(/'/g, "\\'"));

  return `['${cleanItems.join("','")}']`;
}

/**
 * Safely merge multiple array fields
 */
export function mergeArrayFields(...fields: any[]): string[] {
  const allItems = new Set<string>();

  fields.forEach(field => {
    const items = parseArrayField(field);
    items.forEach(item => {
      if (item && item.trim()) {
        allItems.add(item.trim());
      }
    });
  });

  return Array.from(allItems);
}