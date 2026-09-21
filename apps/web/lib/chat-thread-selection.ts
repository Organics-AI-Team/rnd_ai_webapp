/**
 * Select the default chat thread once and preserve that choice across refetches.
 *
 * `undefined` means no default has been pinned yet, `null` means the user
 * explicitly entered new-chat mode, and a string is the pinned thread ID.
 *
 * @param pinned_thread_id - Existing pinned selection state.
 * @param is_new_chat - Whether the user explicitly requested a new chat.
 * @param threads - Current server-ordered thread list.
 * @returns Existing pin, explicit null, first available thread, or undefined.
 */
export function select_default_thread_once(
  pinned_thread_id: string | null | undefined,
  is_new_chat: boolean,
  threads: ReadonlyArray<{ id: string }>,
): string | null | undefined {
  if (is_new_chat) return null;
  if (pinned_thread_id !== undefined) return pinned_thread_id;
  return threads[0]?.id;
}
