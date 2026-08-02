import { redirect } from "next/navigation";

interface RawMaterialsAIPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

/** Redirect the retired specialist URL to the one unified AI workspace. */
export default function RawMaterialsAIPage({ searchParams }: RawMaterialsAIPageProps) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else if (value) {
      query.set(key, value);
    }
  }

  const query_string = query.toString();
  redirect(query_string ? `/ai?${query_string}` : "/ai");
}
