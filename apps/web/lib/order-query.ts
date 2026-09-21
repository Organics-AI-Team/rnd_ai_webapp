/**
 * Read the public order organization identifier from App Router search params.
 *
 * @param search_params - Search-parameter reader supplied by Next.js or URLSearchParams.
 * @returns Organization identifier, or an empty string when absent.
 */
export function get_order_organization_id(
  search_params: Pick<URLSearchParams, "get">,
): string {
  return search_params.get("org") || "";
}
