import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { CommercialAgenticTestConsole } from '@/components/ai/commercial_agentic_test_console';
import { is_credential_free_commercial_test_runtime } from '@/lib/server/commercial-test-run-adapter';

export const dynamic = 'force-dynamic';

/** Render the commercial browser harness only in explicit non-production test mode. */
export default async function CommercialAgenticTestPage() {
  if (!is_credential_free_commercial_test_runtime()) notFound();
  const cookie_store = await cookies();
  return (
    <CommercialAgenticTestConsole
      initial_is_manager={cookie_store.get('commercial_test_role')?.value === 'manager'}
    />
  );
}
