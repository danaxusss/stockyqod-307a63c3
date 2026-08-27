import { describe, expect, it } from 'vitest';
import { isAllowedByList } from '../hooks/useAuth';

describe('isAllowedByList', () => {
  it('treats missing legacy permission lists as unrestricted', () => {
    expect(isAllowedByList(undefined, 'Stock principal')).toBe(true);
    expect(isAllowedByList(null, 'Stock principal')).toBe(true);
    expect(isAllowedByList([], 'Stock principal')).toBe(true);
  });

  it('enforces a configured permission list', () => {
    expect(isAllowedByList(['Stock principal'], 'Stock principal')).toBe(true);
    expect(isAllowedByList(['Stock principal'], 'Dépôt secondaire')).toBe(false);
  });
});
