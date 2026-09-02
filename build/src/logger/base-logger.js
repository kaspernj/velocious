// @ts-check
/**
 * Base logger interface for custom logger implementations.
 */
export default class BaseLogger {
    /**
     * Convert the logger into an output config.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default | undefined} [args.configuration] - Configuration instance.
     * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
     */
    toOutputConfig(args) {
        void args;
        if (typeof this.write !== "function") {
            throw new Error("BaseLogger#write must be implemented");
        }
        return {
            output: this,
            levels: /** @type {ReturnType<typeof JSON.parse>} */ (this).levels
        };
    }
    /**
     * Write a log payload.
     * @param {import("../configuration-types.js").LoggingOutputPayload} payload - Log payload.
     * @returns {Promise<void> | void} - Resolves when complete.
     */
    write(payload) {
        void payload;
        throw new Error("BaseLogger#write must be implemented");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1sb2dnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2VyL2Jhc2UtbG9nZ2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sVUFBVTtJQUM3Qjs7Ozs7T0FLRztJQUNILGNBQWMsQ0FBQyxJQUFJO1FBQ2pCLEtBQUssSUFBSSxDQUFBO1FBQ1QsSUFBSSxPQUFPLElBQUksQ0FBQyxLQUFLLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDckMsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFBO1FBQ3pELENBQUM7UUFFRCxPQUFPO1lBQ0wsTUFBTSxFQUFFLElBQUk7WUFDWixNQUFNLEVBQUUsNENBQTRDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNO1NBQ25FLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsS0FBSyxPQUFPLENBQUE7UUFDWixNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxDQUFDLENBQUE7SUFDekQsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQmFzZSBsb2dnZXIgaW50ZXJmYWNlIGZvciBjdXN0b20gbG9nZ2VyIGltcGxlbWVudGF0aW9ucy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFzZUxvZ2dlciB7XG4gIC8qKlxuICAgKiBDb252ZXJ0IHRoZSBsb2dnZXIgaW50byBhbiBvdXRwdXQgY29uZmlnLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Mb2dnaW5nT3V0cHV0Q29uZmlnfSAtIE91dHB1dCBjb25maWcuXG4gICAqL1xuICB0b091dHB1dENvbmZpZyhhcmdzKSB7XG4gICAgdm9pZCBhcmdzXG4gICAgaWYgKHR5cGVvZiB0aGlzLndyaXRlICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJhc2VMb2dnZXIjd3JpdGUgbXVzdCBiZSBpbXBsZW1lbnRlZFwiKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBvdXRwdXQ6IHRoaXMsXG4gICAgICBsZXZlbHM6IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKS5sZXZlbHNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV3JpdGUgYSBsb2cgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkxvZ2dpbmdPdXRwdXRQYXlsb2FkfSBwYXlsb2FkIC0gTG9nIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+IHwgdm9pZH0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgd3JpdGUocGF5bG9hZCkge1xuICAgIHZvaWQgcGF5bG9hZFxuICAgIHRocm93IG5ldyBFcnJvcihcIkJhc2VMb2dnZXIjd3JpdGUgbXVzdCBiZSBpbXBsZW1lbnRlZFwiKVxuICB9XG59XG4iXX0=