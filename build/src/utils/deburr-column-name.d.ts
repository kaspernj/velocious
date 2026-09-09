/**
 * Transliterates German umlauts (and ß) in a database column name to ASCII so generated and runtime
 * attribute names stay ASCII regardless of whether the column uses the umlaut ("Plätze") or already
 * transliterated ("Plaetze") spelling. Both then map to the same attribute (e.g. "plaetzeVerkauft"),
 * which keeps generated model bases consistent with code that references the ASCII attribute names.
 * The raw column name is still used for the actual SQL, so the underlying column is untouched.
 * @param {string} columnName - Raw database column name.
 * @returns {string} - ASCII-transliterated column name.
 */
export default function deburrColumnName(columnName: string): string;
//# sourceMappingURL=deburr-column-name.d.ts.map