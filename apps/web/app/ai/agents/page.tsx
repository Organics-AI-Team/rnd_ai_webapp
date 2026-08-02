/** Preserve the former agent-directory URL as an alias of the one R&D AI chat. */
import { redirect } from 'next/navigation';

interface AgentsAliasPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default function AgentsAliasPage({ searchParams }: AgentsAliasPageProps) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else if (value) {
      query.set(key, value);
    }
  }

  const query_string = query.toString();
  redirect(query_string ? `/ai?${query_string}` : '/ai');
}
