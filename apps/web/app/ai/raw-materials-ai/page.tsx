import { redirect } from 'next/navigation';

/** Legacy bookmark alias for the Materials focus in the unified R&D chat. */
export default function RawMaterialsAIAliasPage() {
  redirect('/ai?mode=materials');
}
