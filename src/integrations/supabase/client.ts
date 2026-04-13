// Supabase has been replaced by the custom Express API server.
// All data access goes through src/lib/apiClient.ts.
// This stub exists only to prevent import errors during incremental migration.

export const supabase: never = new Proxy({} as never, {
  get(_target, prop) {
    throw new Error(
      `[Migration] Direct supabase.${String(prop)}() call detected. ` +
      `Use the functions in src/lib/apiClient.ts instead.`
    );
  },
});
