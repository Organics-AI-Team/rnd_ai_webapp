import { redirect } from 'next/navigation';

/** Legacy bookmark alias for the Sales & Market focus in the unified R&D chat. */
export default function SalesRndAIAliasPage() {
  redirect('/ai?mode=sales');
}
