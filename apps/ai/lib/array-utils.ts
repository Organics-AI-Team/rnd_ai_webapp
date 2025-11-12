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

