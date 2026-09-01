// @ts-check
import Configuration from "./configuration.js";
import { CurrentConfigurationNotSetError } from "./configuration.js";
export default class Current {
    /**
     * Runs configuration.
     * @returns {import("./configuration.js").default} - Current configuration.
     */
    static configuration() {
        return Configuration.current();
    }
    /**
     * Runs ability.
     * @returns {import("./authorization/ability.js").default | undefined} - Current ability.
     */
    static ability() {
        try {
            return this.configuration().getCurrentAbility();
        }
        catch (error) {
            if (error instanceof CurrentConfigurationNotSetError)
                return;
            throw error;
        }
    }
    /**
     * Runs set ability.
     * @param {import("./authorization/ability.js").default | undefined} ability - Ability.
     * @returns {void} - No return value.
     */
    static setAbility(ability) {
        this.configuration().getEnvironmentHandler().setCurrentAbility(ability);
    }
    /**
     * Runs with ability.
     * @param {import("./authorization/ability.js").default | undefined} ability - Ability.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    static async withAbility(ability, callback) {
        return await this.configuration().runWithAbility(ability, callback);
    }
    /**
     * Runs tenant.
     * @returns {Record<string, unknown> | undefined} - Current tenant.
     */
    static tenant() {
        try {
            return this.configuration().getCurrentTenant();
        }
        catch (error) {
            if (error instanceof CurrentConfigurationNotSetError)
                return;
            throw error;
        }
    }
    /**
     * Runs set tenant.
     * @param {object} tenant - Tenant. Any caller-defined object shape; read back (and narrowed) via tenant().
     * @returns {void} - No return value.
     */
    static setTenant(tenant) {
        this.configuration().getEnvironmentHandler().setCurrentTenant(tenant);
    }
    /**
     * Runs with tenant.
     * @template T
     * @param {object} tenant - Tenant. Any caller-defined object shape; read back (and narrowed) via tenant().
     * @param {() => Promise<T>} callback - Callback.
     * @returns {Promise<T>} - Callback result.
     */
    static async withTenant(tenant, callback) {
        return await this.configuration().runWithTenant(tenant, callback);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3VycmVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jdXJyZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsTUFBTSxvQkFBb0IsQ0FBQTtBQUM5QyxPQUFPLEVBQUMsK0JBQStCLEVBQUMsTUFBTSxvQkFBb0IsQ0FBQTtBQUVsRSxNQUFNLENBQUMsT0FBTyxPQUFPLE9BQU87SUFDMUI7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLGFBQWE7UUFDbEIsT0FBTyxhQUFhLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxPQUFPO1FBQ1osSUFBSSxDQUFDO1lBQ0gsT0FBTyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUNqRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksS0FBSyxZQUFZLCtCQUErQjtnQkFBRSxPQUFNO1lBRTVELE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxPQUFPO1FBQ3ZCLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQ3pFLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLE9BQU8sRUFBRSxRQUFRO1FBQ3hDLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsY0FBYyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUNyRSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLE1BQU07UUFDWCxJQUFJLENBQUM7WUFDSCxPQUFPLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQ2hELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxLQUFLLFlBQVksK0JBQStCO2dCQUFFLE9BQU07WUFFNUQsTUFBTSxLQUFLLENBQUE7UUFDYixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsU0FBUyxDQUFDLE1BQU07UUFDckIsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLHFCQUFxQixFQUFFLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDdkUsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxRQUFRO1FBQ3RDLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQTtJQUNuRSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQge0N1cnJlbnRDb25maWd1cmF0aW9uTm90U2V0RXJyb3J9IGZyb20gXCIuL2NvbmZpZ3VyYXRpb24uanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBDdXJyZW50IHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIEN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBjb25maWd1cmF0aW9uKCkge1xuICAgIHJldHVybiBDb25maWd1cmF0aW9uLmN1cnJlbnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWJpbGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKi9cbiAgc3RhdGljIGFiaWxpdHkoKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24oKS5nZXRDdXJyZW50QWJpbGl0eSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEN1cnJlbnRDb25maWd1cmF0aW9uTm90U2V0RXJyb3IpIHJldHVyblxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFiaWxpdHkgLSBBYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0QWJpbGl0eShhYmlsaXR5KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuc2V0Q3VycmVudEFiaWxpdHkoYWJpbGl0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB3aXRoQWJpbGl0eShhYmlsaXR5LCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24oKS5ydW5XaXRoQWJpbGl0eShhYmlsaXR5LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRlbmFudC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgdGVuYW50LlxuICAgKi9cbiAgc3RhdGljIHRlbmFudCgpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbigpLmdldEN1cnJlbnRUZW5hbnQoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBDdXJyZW50Q29uZmlndXJhdGlvbk5vdFNldEVycm9yKSByZXR1cm5cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGVuYW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gdGVuYW50IC0gVGVuYW50LiBBbnkgY2FsbGVyLWRlZmluZWQgb2JqZWN0IHNoYXBlOyByZWFkIGJhY2sgKGFuZCBuYXJyb3dlZCkgdmlhIHRlbmFudCgpLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0VGVuYW50KHRlbmFudCkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLnNldEN1cnJlbnRUZW5hbnQodGVuYW50KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCB0ZW5hbnQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7b2JqZWN0fSB0ZW5hbnQgLSBUZW5hbnQuIEFueSBjYWxsZXItZGVmaW5lZCBvYmplY3Qgc2hhcGU7IHJlYWQgYmFjayAoYW5kIG5hcnJvd2VkKSB2aWEgdGVuYW50KCkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24oKS5ydW5XaXRoVGVuYW50KHRlbmFudCwgY2FsbGJhY2spXG4gIH1cbn1cbiJdfQ==