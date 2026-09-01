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
];
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
    let result = columnName;
    for (const [pattern, replacement] of UMLAUT_REPLACEMENTS) {
        result = result.replace(pattern, replacement);
    }
    // An all-caps acronym column (e.g. "IP", "EA") would camelize to "iP"/"eA" because only the first
    // letter is lowercased. Down-case columns that contain no lowercase letters so "IP" becomes "ip".
    if (!/[a-z]/.test(result)) {
        result = result.toLowerCase();
    }
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVidXJyLWNvbHVtbi1uYW1lLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3V0aWxzL2RlYnVyci1jb2x1bW4tbmFtZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosc0NBQXNDO0FBQ3RDLE1BQU0sbUJBQW1CLEdBQUc7SUFDMUIsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDO0lBQ1osQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDO0lBQ1osQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDO0lBQ1osQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDO0lBQ1osQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDO0lBQ1osQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDO0lBQ1osQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDO0NBQ2IsQ0FBQTtBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sVUFBVSxnQkFBZ0IsQ0FBQyxVQUFVO0lBQ2pELElBQUksTUFBTSxHQUFHLFVBQVUsQ0FBQTtJQUV2QixLQUFLLE1BQU0sQ0FBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLElBQUksbUJBQW1CLEVBQUUsQ0FBQztRQUN6RCxNQUFNLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUE7SUFDL0MsQ0FBQztJQUVELGtHQUFrRztJQUNsRyxrR0FBa0c7SUFDbEcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztRQUMxQixNQUFNLEdBQUcsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBQy9CLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQTtBQUNmLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqIEB0eXBlIHtBcnJheTxbUmVnRXhwLCBzdHJpbmddPn0gKi9cbmNvbnN0IFVNTEFVVF9SRVBMQUNFTUVOVFMgPSBbXG4gIFsvw4QvZywgXCJBZVwiXSxcbiAgWy/Dli9nLCBcIk9lXCJdLFxuICBbL8OcL2csIFwiVWVcIl0sXG4gIFsvw6QvZywgXCJhZVwiXSxcbiAgWy/Dti9nLCBcIm9lXCJdLFxuICBbL8O8L2csIFwidWVcIl0sXG4gIFsvw58vZywgXCJzc1wiXVxuXVxuXG4vKipcbiAqIFRyYW5zbGl0ZXJhdGVzIEdlcm1hbiB1bWxhdXRzIChhbmQgw58pIGluIGEgZGF0YWJhc2UgY29sdW1uIG5hbWUgdG8gQVNDSUkgc28gZ2VuZXJhdGVkIGFuZCBydW50aW1lXG4gKiBhdHRyaWJ1dGUgbmFtZXMgc3RheSBBU0NJSSByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhlIGNvbHVtbiB1c2VzIHRoZSB1bWxhdXQgKFwiUGzDpHR6ZVwiKSBvciBhbHJlYWR5XG4gKiB0cmFuc2xpdGVyYXRlZCAoXCJQbGFldHplXCIpIHNwZWxsaW5nLiBCb3RoIHRoZW4gbWFwIHRvIHRoZSBzYW1lIGF0dHJpYnV0ZSAoZS5nLiBcInBsYWV0emVWZXJrYXVmdFwiKSxcbiAqIHdoaWNoIGtlZXBzIGdlbmVyYXRlZCBtb2RlbCBiYXNlcyBjb25zaXN0ZW50IHdpdGggY29kZSB0aGF0IHJlZmVyZW5jZXMgdGhlIEFTQ0lJIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIFRoZSByYXcgY29sdW1uIG5hbWUgaXMgc3RpbGwgdXNlZCBmb3IgdGhlIGFjdHVhbCBTUUwsIHNvIHRoZSB1bmRlcmx5aW5nIGNvbHVtbiBpcyB1bnRvdWNoZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIFJhdyBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQVNDSUktdHJhbnNsaXRlcmF0ZWQgY29sdW1uIG5hbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGRlYnVyckNvbHVtbk5hbWUoY29sdW1uTmFtZSkge1xuICBsZXQgcmVzdWx0ID0gY29sdW1uTmFtZVxuXG4gIGZvciAoY29uc3QgW3BhdHRlcm4sIHJlcGxhY2VtZW50XSBvZiBVTUxBVVRfUkVQTEFDRU1FTlRTKSB7XG4gICAgcmVzdWx0ID0gcmVzdWx0LnJlcGxhY2UocGF0dGVybiwgcmVwbGFjZW1lbnQpXG4gIH1cblxuICAvLyBBbiBhbGwtY2FwcyBhY3JvbnltIGNvbHVtbiAoZS5nLiBcIklQXCIsIFwiRUFcIikgd291bGQgY2FtZWxpemUgdG8gXCJpUFwiL1wiZUFcIiBiZWNhdXNlIG9ubHkgdGhlIGZpcnN0XG4gIC8vIGxldHRlciBpcyBsb3dlcmNhc2VkLiBEb3duLWNhc2UgY29sdW1ucyB0aGF0IGNvbnRhaW4gbm8gbG93ZXJjYXNlIGxldHRlcnMgc28gXCJJUFwiIGJlY29tZXMgXCJpcFwiLlxuICBpZiAoIS9bYS16XS8udGVzdChyZXN1bHQpKSB7XG4gICAgcmVzdWx0ID0gcmVzdWx0LnRvTG93ZXJDYXNlKClcbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cbiJdfQ==