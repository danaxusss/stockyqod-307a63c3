import { supabase } from './supabaseClient';
import { getToken } from './session';
import { describeEdgeError } from './edgeError';
import type { SheetDocumentKind, SheetSearchResult } from './sheetSearch';

const FUNCTION_NAME = 'technical-sheet-search';

/** No search provider key on the server: web search is off, the library and manual import still work. */
export class SheetSearchNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetSearchNotConfiguredError';
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const session_token = getToken();
  if (!session_token) throw new Error('Reconnectez-vous pour rechercher des fiches techniques.');
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body: { ...body, session_token } });
  if (error) {
    const failure = await describeEdgeError(error, FUNCTION_NAME);
    if (failure.status === 501) throw new SheetSearchNotConfiguredError(failure.serverMessage || failure.message);
    throw new Error(failure.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const SheetSearchService = {
  async search(query: string, fileType: 'pdf' | 'documents'): Promise<SheetSearchResult[]> {
    const data = await invoke<{ results: SheetSearchResult[] }>({ action: 'search', query, file_type: fileType });
    return data.results || [];
  },

  /** Download a web document through the server (needed for the preview and to store it). */
  async fetchDocument(url: string): Promise<{ file: File; kind: SheetDocumentKind }> {
    const data = await invoke<{ content_type: string; kind: SheetDocumentKind; file_name: string; data: string }>({ action: 'fetch', url });
    const binary = atob(data.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return { file: new File([bytes], data.file_name || `fiche-technique.${data.kind}`, { type: data.content_type }), kind: data.kind };
  },
};
