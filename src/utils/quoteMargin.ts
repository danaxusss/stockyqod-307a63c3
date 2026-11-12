/**
 * Estimated margin of a quote, without TVA. Sale and purchase prices both
 * include TVA in Stocky, so both are brought back to HT before comparing.
 */
export function quoteMarginHT({ totalTTC, purchaseTTC, tvaRate }: { totalTTC: number; purchaseTTC: number; tvaRate: number }): number {
  const factor = 1 + (tvaRate || 0) / 100;
  return totalTTC / factor - purchaseTTC / factor;
}
