/** The message of a thrown error (Error, Supabase error object or string), for a toast. */
export function errorText(e: unknown, fallback = 'Échec'): string {
  if (typeof e === 'string') return e || fallback;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : fallback;
}
