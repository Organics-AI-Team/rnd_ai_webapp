import { redirect } from "next/navigation";

/**
 * Ingredient management is intentionally kept in the Ingredients workspace.
 * Formula creation remains a dedicated route because it includes AI planning.
 */
export default function ProductsPage() {
  redirect("/ingredients");
}
