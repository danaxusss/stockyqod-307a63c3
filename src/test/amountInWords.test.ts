import { describe, expect, it } from 'vitest';
import { amountInWordsFr, numberToWordsFr } from '../utils/amountInWords';

// French agreement rules for "cent", "vingt", "mille" and "million", the
// ones a reader of an invoice checks first.
const NUMBERS: Array<[number, string]> = [
  [0, 'ZÉRO'],
  [1, 'UN'],
  [16, 'SEIZE'],
  [17, 'DIX-SEPT'],
  [21, 'VINGT ET UN'],
  [22, 'VINGT-DEUX'],
  [70, 'SOIXANTE-DIX'],
  [71, 'SOIXANTE ET ONZE'],
  [72, 'SOIXANTE-DOUZE'],
  [80, 'QUATRE-VINGTS'],
  [81, 'QUATRE-VINGT-UN'],
  [90, 'QUATRE-VINGT-DIX'],
  [91, 'QUATRE-VINGT-ONZE'],
  [99, 'QUATRE-VINGT-DIX-NEUF'],
  [100, 'CENT'],
  [101, 'CENT UN'],
  [180, 'CENT QUATRE-VINGTS'],
  [200, 'DEUX CENTS'],
  [201, 'DEUX CENT UN'],
  [280, 'DEUX CENT QUATRE-VINGTS'],
  [1000, 'MILLE'],
  [1001, 'MILLE UN'],
  [1100, 'MILLE CENT'],
  [2000, 'DEUX MILLE'],
  [80_000, 'QUATRE-VINGT MILLE'],
  [81_000, 'QUATRE-VINGT-UN MILLE'],
  [200_000, 'DEUX CENT MILLE'],
  [280_000, 'DEUX CENT QUATRE-VINGT MILLE'],
  [999_999, 'NEUF CENT QUATRE-VINGT-DIX-NEUF MILLE NEUF CENT QUATRE-VINGT-DIX-NEUF'],
  [1_000_000, 'UN MILLION'],
  [2_000_000, 'DEUX MILLIONS'],
  [80_000_000, 'QUATRE-VINGTS MILLIONS'],
  [200_000_000, 'DEUX CENTS MILLIONS'],
  [2_300_400, 'DEUX MILLIONS TROIS CENT MILLE QUATRE CENTS'],
  [1_000_000_000, 'UN MILLIARD'],
];

describe('numberToWordsFr', () => {
  it.each(NUMBERS)('%d → %s', (n, words) => {
    expect(numberToWordsFr(n)).toBe(words);
  });
});

const AMOUNTS: Array<[number, string]> = [
  [0, 'ZÉRO DIRHAM'],
  [1, 'UN DIRHAM'],
  [0.01, 'ZÉRO DIRHAM ET UN CENTIME'],
  [2.5, 'DEUX DIRHAMS ET CINQUANTE CENTIMES'],
  [1200, 'MILLE DEUX CENTS DIRHAMS'],
  [71.81, 'SOIXANTE ET ONZE DIRHAMS ET QUATRE-VINGT-UN CENTIMES'],
  [1_000_000, 'UN MILLION DE DIRHAMS'],
  [2_000_000, 'DEUX MILLIONS DE DIRHAMS'],
  [2_000_001, 'DEUX MILLIONS UN DIRHAMS'],
  [2_300_400.5, 'DEUX MILLIONS TROIS CENT MILLE QUATRE CENTS DIRHAMS ET CINQUANTE CENTIMES'],
  // Floating point: 0.1 + 0.2 is 0.30000000000000004.
  [0.1 + 0.2, 'ZÉRO DIRHAM ET TRENTE CENTIMES'],
  [1234.565, 'MILLE DEUX CENT TRENTE-QUATRE DIRHAMS ET CINQUANTE-SEPT CENTIMES'],
];

describe('amountInWordsFr', () => {
  it.each(AMOUNTS)('%d → %s', (amount, words) => {
    expect(amountInWordsFr(amount)).toBe(words);
  });
});
