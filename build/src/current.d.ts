export default class Current {
    /**
     * Runs configuration.
     * @returns {import("./configuration.js").default} - Current configuration.
     */
    static configuration(): import("./configuration.js").default;
    /**
     * Runs ability.
     * @returns {import("./authorization/ability.js").default | undefined} - Current ability.
     */
    static ability(): import("./authorization/ability.js").default | undefined;
    /**
     * Runs set ability.
     * @param {import("./authorization/ability.js").default | undefined} ability - Ability.
     * @returns {void} - No return value.
     */
    static setAbility(ability: import("./authorization/ability.js").default | undefined): void;
    /**
     * Runs with ability.
     * @param {import("./authorization/ability.js").default | undefined} ability - Ability.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    static withAbility(ability: import("./authorization/ability.js").default | undefined, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs tenant.
     * @returns {Record<string, unknown> | undefined} - Current tenant.
     */
    static tenant(): Record<string, unknown> | undefined;
    /**
     * Runs set tenant.
     * @param {object} tenant - Tenant. Any caller-defined object shape; read back (and narrowed) via tenant().
     * @returns {void} - No return value.
     */
    static setTenant(tenant: object): void;
    /**
     * Runs with tenant.
     * @template T
     * @param {object} tenant - Tenant. Any caller-defined object shape; read back (and narrowed) via tenant().
     * @param {() => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    static withTenant<T>(tenant: object, callback: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=current.d.ts.map