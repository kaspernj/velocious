// @ts-check

/** @type {Array<[RegExp, string]>} */
const UMLAUT_REPLACEMENTS = [
  [/Ä/g, "Ae"],
  [/Ö/g, "Oe"],
  [/Ü/g, "Ue"],
  [/ä/g, "ae"],
  [/ö/g, "oe"],
  [/ü/g, "ue"],
  [/ß/g, "ss"]
]

/**
 * Transliterates German umlauts (and ß) in a database column name to ASCII so generated and runtime
 * attribute names stay ASCII regardless of whether the column uses the umlaut ("Plätze") or already
 * transliterated ("Plaetze") spelling. Both then map to the same attribute (e.g. "plaetzeVerkauft"),
 * which keeps generated model bases consistent with code that references the ASCII attribute names.
 * The raw column name is still used for the actual SQL, so the underlying column is untouched.
 * @param {string} columnName - Raw database column name.
 * @returns {string} - ASCII-transliterated column name.
 */
export default function deburrColumnName(columnName) {
  let result = columnName

  for (const [pattern, replacement] of UMLAUT_REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }

  // An all-caps acronym column (e.g. "IP", "EA") would camelize to "iP"/"eA" because only the first
  // letter is lowercased. Down-case columns that contain no lowercase letters so "IP" becomes "ip".
  if (!/[a-z]/.test(result)) {
    result = result.toLowerCase()
  }

  return result
}
