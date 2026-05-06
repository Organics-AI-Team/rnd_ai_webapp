/**
 * Utility functions for parsing and handling array fields from database
 *
 * @module array-utils
 */

/**
 * Parses array field from database that might be in various formats
 *
 * Handles:
 * - Already parsed arrays
 * - String representations of arrays
 * - Single values
 * - Empty/null values
 *
 * @param field - Field value from database
 * @returns Parsed array of strings
 *
 * @example
 * parseArrayField(['item1', 'item2']) // ['item1', 'item2']
 * parseArrayField("['item1', 'item2']") // ['item1', 'item2']
 * parseArrayField('single') // ['single']
 * parseArrayField(null) // []
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
