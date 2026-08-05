/**
 * Turn a supabase.functions.invoke() failure into something actionable.
 *
 * invoke() reports every non-2xx response as the same opaque string
 * ("Edge Function returned a non-2xx status code"). The server's real message
 * lives in `error.context`, which is a Response — so we read it and, where the
 * status alone is diagnostic, say what to do about it.
 */

export interface EdgeFailure {
  status: number | null;
  /** Message from the function body, when it sent one. */
  serverMessage: string | null;
  /** What to show the user. */
  message: string;
  retryAfter?: number;
}

export async function describeEdgeError(error: unknown, fnName: string): Promise<EdgeFailure> {
  const ctx: any = (error as any)?.context;
  const status: number | null = typeof ctx?.status === 'number' ? ctx.status : null;

  // Read the JSON body without consuming the caller's copy.
  let serverMessage: string | null = null;
  let retryAfter: number | undefined;
  try {
    if (ctx && typeof ctx.clone === 'function') {
      const body = await ctx.clone().json();
      if (typeof body?.error === 'string') serverMessage = body.error;
      if (typeof body?.retry_after === 'number') retryAfter = body.retry_after;
      // Per-model outcomes from the AI functions: 404 everywhere means the
      // model ids are gone, 402 means no credits, 400 means a rejected
      // request. Appending them turns a dead end into a next step.
      if (Array.isArray(body?.attempts) && body.attempts.length) {
        const detail = body.attempts
          .map((a: any) => `${a.model} → ${a.status}`)
          .join(' · ');
        serverMessage = `${serverMessage || 'Échec'} (${detail})`;
      }
    }
  } catch { /* body absent, already read, or not JSON */ }

  const deployHint = `La fonction « ${fnName} » n'est pas déployée. Lancez : npx supabase functions deploy ${fnName}`;

  let message: string;
  switch (status) {
    case 404:
      message = deployHint;
      break;
    case 401:
    case 403:
      message = "Accès refusé par le serveur (autorisation).";
      break;
    case 413:
      message = serverMessage || "Fichier trop volumineux pour l'analyse.";
      break;
    case 429:
      message = serverMessage
        || `Quota atteint.${retryAfter ? ` Réessayez dans ${Math.ceil(retryAfter / 60)} min.` : ''}`;
      break;
    case 500:
      // The commonest cause here is a missing provider key in Function secrets.
      message = serverMessage
        || "Erreur serveur. Vérifiez que le secret OPENROUTER_API_KEY est bien configuré.";
      break;
    case 502:
      message = serverMessage || "L'IA n'a pas pu lire ce document (modèles indisponibles ou page illisible).";
      break;
    default:
      // No status at all means the browser never got a readable response.
      // In practice that is a function which isn't deployed (or crashes on
      // boot): Supabase answers without CORS headers, so the browser blocks
      // the reply and supabase-js reports a transport failure rather than a
      // 404. Name the likely cause instead of saying "unreachable".
      message = serverMessage
        || (status
          ? `Échec (HTTP ${status}).`
          : `La fonction « ${fnName} » ne répond pas — elle n'est probablement pas déployée.`);
  }

  // A body message is more specific than our generic text — prefer it, except
  // for 404 where the deploy instruction is the useful part.
  if (serverMessage && status !== 404) message = serverMessage;

  return { status, serverMessage, message, retryAfter };
}

/** Convenience: throw an Error carrying the human-readable cause. */
export async function throwEdgeError(error: unknown, fnName: string): Promise<never> {
  const d = await describeEdgeError(error, fnName);
  console.error(`[edge:${fnName}] status=${d.status ?? '?'} — ${d.serverMessage ?? d.message}`);
  throw new Error(d.message);
}
