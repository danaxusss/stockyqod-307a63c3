import { supabase } from './supabaseClient';
import { getToken } from './session';
import { describeEdgeError } from './edgeError';
import { base64ToFile, type ImageSearchResult } from './imageSearch';

const FUNCTION_NAME = 'product-image-search';

/** No search provider key is configured on the server: search is off, paste/drop still works. */
export class ImageSearchNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSearchNotConfiguredError';
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const session_token = getToken();
  if (!session_token) throw new Error('Reconnectez-vous pour rechercher des images.');
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body: { ...body, session_token } });
  if (error) {
    const failure = await describeEdgeError(error, FUNCTION_NAME);
    if (failure.status === 501) throw new ImageSearchNotConfiguredError(failure.serverMessage || failure.message);
    throw new Error(failure.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const ImageSearchService = {
  async search(query: string): Promise<ImageSearchResult[]> {
    const data = await invoke<{ results: ImageSearchResult[] }>({ action: 'search', query });
    return data.results || [];
  },

  /** Download a web image through the server (image sites rarely allow direct browser downloads). */
  async fetchImage(url: string, fileBaseName: string, referer?: string | null): Promise<File> {
    const data = await invoke<{ content_type: string; data: string }>({ action: 'fetch', url, referer: referer || null });
    return base64ToFile(data.data, data.content_type, fileBaseName);
  },
};
