// @ts-check
import restArgsError from "./utils/rest-args-error.js";
export default class VelociousInitializer {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./configuration.js").default} args.configuration - Configuration instance.
     * @param {import("./configuration-types.js").ApplicationProcessContext} [args.processContext] - Framework-owned application process context.
     * @param {string} args.type - Type identifier.
     */
    constructor({ configuration, processContext, type, ...restArgs }) {
        restArgsError(restArgs);
        this._configuration = configuration;
        this._processContext = processContext;
        this._type = type;
    }
    /**
     * Runs get configuration.
     * @returns {import("./configuration.js").default} - The configuration.
     */
    getConfiguration() { return this._configuration; }
    /**
     * Runs get type.
     * @returns {string} - The type.
     */
    getType() { return this._type; }
    /**
     * Gets the immutable context for this application process lifecycle.
     * @returns {import("./configuration-types.js").ApplicationProcessContext} - Shared process context.
     */
    getProcessContext() {
        if (!this._processContext)
            throw new Error("Application process context is only available to framework-run initializers");
        return this._processContext;
    }
    /**
     * Runs run.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    run() {
        throw new Error(`'run' hasn't been implemented on ${this.constructor.name})`);
    }
    /**
     * Tears down application-owned process resources.
     * @returns {Promise<void>} - Resolves after optional application cleanup.
     */
    async teardown() { }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5pdGlhbGl6ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW5pdGlhbGl6ZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLDRCQUE0QixDQUFBO0FBRXRELE1BQU0sQ0FBQyxPQUFPLE9BQU8sb0JBQW9CO0lBQ3ZDOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsY0FBYyxFQUFFLElBQUksRUFBRSxHQUFHLFFBQVEsRUFBQztRQUM1RCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFFdkIsSUFBSSxDQUFDLGNBQWMsR0FBRyxhQUFhLENBQUE7UUFDbkMsSUFBSSxDQUFDLGVBQWUsR0FBRyxjQUFjLENBQUE7UUFDckMsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7T0FHRztJQUNILGdCQUFnQixLQUFLLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQSxDQUFDLENBQUM7SUFFakQ7OztPQUdHO0lBQ0gsT0FBTyxLQUFLLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQSxDQUFDLENBQUM7SUFFL0I7OztPQUdHO0lBQ0gsaUJBQWlCO1FBQ2YsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw2RUFBNkUsQ0FBQyxDQUFBO1FBRXpILE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEdBQUc7UUFDRCxNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLENBQUE7SUFDL0UsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxRQUFRLEtBQUksQ0FBQztDQUNwQiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNJbml0aWFsaXplciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0fSBbYXJncy5wcm9jZXNzQ29udGV4dF0gLSBGcmFtZXdvcmstb3duZWQgYXBwbGljYXRpb24gcHJvY2VzcyBjb250ZXh0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50eXBlIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIHByb2Nlc3NDb250ZXh0LCB0eXBlLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgdGhpcy5fY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLl9wcm9jZXNzQ29udGV4dCA9IHByb2Nlc3NDb250ZXh0XG4gICAgdGhpcy5fdHlwZSA9IHR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkgeyByZXR1cm4gdGhpcy5fY29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHR5cGUuXG4gICAqL1xuICBnZXRUeXBlKCkgeyByZXR1cm4gdGhpcy5fdHlwZSB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGltbXV0YWJsZSBjb250ZXh0IGZvciB0aGlzIGFwcGxpY2F0aW9uIHByb2Nlc3MgbGlmZWN5Y2xlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkFwcGxpY2F0aW9uUHJvY2Vzc0NvbnRleHR9IC0gU2hhcmVkIHByb2Nlc3MgY29udGV4dC5cbiAgICovXG4gIGdldFByb2Nlc3NDb250ZXh0KCkge1xuICAgIGlmICghdGhpcy5fcHJvY2Vzc0NvbnRleHQpIHRocm93IG5ldyBFcnJvcihcIkFwcGxpY2F0aW9uIHByb2Nlc3MgY29udGV4dCBpcyBvbmx5IGF2YWlsYWJsZSB0byBmcmFtZXdvcmstcnVuIGluaXRpYWxpemVyc1wiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Byb2Nlc3NDb250ZXh0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4uXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgcnVuKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJ3J1bicgaGFzbid0IGJlZW4gaW1wbGVtZW50ZWQgb24gJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9KWApXG4gIH1cblxuICAvKipcbiAgICogVGVhcnMgZG93biBhcHBsaWNhdGlvbi1vd25lZCBwcm9jZXNzIHJlc291cmNlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgb3B0aW9uYWwgYXBwbGljYXRpb24gY2xlYW51cC5cbiAgICovXG4gIGFzeW5jIHRlYXJkb3duKCkge31cbn1cbiJdfQ==