

## Plan: Fix PDF Export Layout Issues

### Problems Identified
1. Company name text overflows into the DEVIS box — insufficient space calculation
2. Two-column Y tracking bug: `lastAutoTable.finalY` only captures the RIGHT table's Y, so if the left (client) table is taller, content overlaps
3. Company details line between header and items table overlaps with client table rows
4. Header font size too large for long company names

### Changes

**File: `src/utils/pdfExport.ts`** — Single file, focused fixes:

1. **Fix company name overflow**: Reduce max font size, calculate text width dynamically, and shrink if it would collide with the DEVIS box. Add `maxWidth` constraint.

2. **Fix Y-position tracking between two tables**: After drawing the LEFT client table, capture its `finalY` into a variable BEFORE drawing the right table. Then use `Math.max(leftFinalY, rightFinalY)` for the next section's Y position. Current code draws both tables then only reads `lastAutoTable.finalY` once (which is the right table's value).

3. **Remove the redundant company details line** between client info and items table — this info is already in the footer and causes overlap issues. This frees up space.

4. **Ensure "Commercial" row renders fully**: The overlap is a consequence of #2 — fixing Y tracking will resolve this.

5. **Minor polish**: Ensure consistent cell padding so rows don't clip text.

### No database or dependency changes needed — purely a rendering fix in one file.

