/**
 * Builds the banner prepended to every Velocious-generated file that is overwritten on
 * regeneration. It warns against manual edits, states that changes are overwritten, and
 * names the command that regenerates the file so readers know how to apply changes.
 * @param {string} regenerateCommand - CLI command that regenerates the file, for example "velocious generate:frontend-models".
 * @returns {string} - Banner comment lines, terminated by a trailing newline.
 */
export default function generatedFileBanner(regenerateCommand: string): string;
//# sourceMappingURL=generated-file-banner.d.ts.map