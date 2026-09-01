declare class CurrentConfigurationNotSetError extends Error {
}
/**
 * Types the following value.
 * @returns {import("./configuration.js").default} - Current configuration.
 */
export declare function currentConfiguration(): import("./configuration.js").default;
/**
 * Types the following value.
 * @param {import("./configuration.js").default} configuration - Current configuration.
 * @returns {void} - No return value.
 */
export declare function setCurrentConfiguration(configuration: import("./configuration.js").default): void;
export { CurrentConfigurationNotSetError };
//# sourceMappingURL=current-configuration.d.ts.map