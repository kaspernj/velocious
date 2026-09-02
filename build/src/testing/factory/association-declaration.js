// @ts-check
import { InvalidDefinitionError } from "./errors.js";
/**
 * A declared association. It records the relationship name, the factory to run
 * (defaulting to the relationship name), any traits/overrides passed to that
 * factory, and an optional explicit strategy. When no strategy is given the
 * association follows the parent strategy at evaluation time.
 */
export default class AssociationDeclaration {
    /**
     * Builds an association declaration.
     * @param {object} args - Options.
     * @param {string} args.name - Relationship name on the owning model.
     * @param {string} [args.factory] - Factory name to run. Defaults to the relationship name.
     * @param {string[]} [args.traits] - Traits passed to the association factory.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.overrides] - Overrides passed to the association factory.
     * @param {"build" | "create" | undefined} [args.strategy] - Explicit strategy override.
     */
    constructor({ name, factory, traits = [], overrides = {}, strategy }) {
        if (!name || typeof name !== "string") {
            throw new InvalidDefinitionError(`Association name must be a non-empty string, got: ${String(name)}`);
        }
        if (strategy !== undefined && strategy !== "build" && strategy !== "create") {
            throw new InvalidDefinitionError(`Association strategy must be "build" or "create", got: ${String(strategy)}`);
        }
        /** @type {"association"} - Discriminant. */
        this.kind = "association";
        /** @type {string} - Relationship name on the owning model. */
        this.name = name;
        /** @type {string} - Factory name to run for the association. */
        this.factory = factory || name;
        /** @type {string[]} - Traits passed to the association factory. */
        this.traits = traits;
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} - Overrides passed to the association factory. */
        this.overrides = overrides;
        /** @type {"build" | "create" | undefined} - Explicit strategy override. */
        this.strategy = strategy;
        Object.freeze(this);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXNzb2NpYXRpb24tZGVjbGFyYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvdGVzdGluZy9mYWN0b3J5L2Fzc29jaWF0aW9uLWRlY2xhcmF0aW9uLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsc0JBQXNCLEVBQUMsTUFBTSxhQUFhLENBQUE7QUFFbEQ7Ozs7O0dBS0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHNCQUFzQjtJQUN6Qzs7Ozs7Ozs7T0FRRztJQUNILFlBQVksRUFBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLE1BQU0sR0FBRyxFQUFFLEVBQUUsU0FBUyxHQUFHLEVBQUUsRUFBRSxRQUFRLEVBQUM7UUFDaEUsSUFBSSxDQUFDLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN0QyxNQUFNLElBQUksc0JBQXNCLENBQUMscURBQXFELE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDdkcsQ0FBQztRQUVELElBQUksUUFBUSxLQUFLLFNBQVMsSUFBSSxRQUFRLEtBQUssT0FBTyxJQUFJLFFBQVEsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM1RSxNQUFNLElBQUksc0JBQXNCLENBQUMsMERBQTBELE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDaEgsQ0FBQztRQUVELDRDQUE0QztRQUM1QyxJQUFJLENBQUMsSUFBSSxHQUFHLGFBQWEsQ0FBQTtRQUV6Qiw4REFBOEQ7UUFDOUQsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFFaEIsZ0VBQWdFO1FBQ2hFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxJQUFJLElBQUksQ0FBQTtRQUU5QixtRUFBbUU7UUFDbkUsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFFcEIsMkdBQTJHO1FBQzNHLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBRTFCLDJFQUEyRTtRQUMzRSxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtRQUV4QixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3JCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge0ludmFsaWREZWZpbml0aW9uRXJyb3J9IGZyb20gXCIuL2Vycm9ycy5qc1wiXG5cbi8qKlxuICogQSBkZWNsYXJlZCBhc3NvY2lhdGlvbi4gSXQgcmVjb3JkcyB0aGUgcmVsYXRpb25zaGlwIG5hbWUsIHRoZSBmYWN0b3J5IHRvIHJ1blxuICogKGRlZmF1bHRpbmcgdG8gdGhlIHJlbGF0aW9uc2hpcCBuYW1lKSwgYW55IHRyYWl0cy9vdmVycmlkZXMgcGFzc2VkIHRvIHRoYXRcbiAqIGZhY3RvcnksIGFuZCBhbiBvcHRpb25hbCBleHBsaWNpdCBzdHJhdGVneS4gV2hlbiBubyBzdHJhdGVneSBpcyBnaXZlbiB0aGVcbiAqIGFzc29jaWF0aW9uIGZvbGxvd3MgdGhlIHBhcmVudCBzdHJhdGVneSBhdCBldmFsdWF0aW9uIHRpbWUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEFzc29jaWF0aW9uRGVjbGFyYXRpb24ge1xuICAvKipcbiAgICogQnVpbGRzIGFuIGFzc29jaWF0aW9uIGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBvbiB0aGUgb3duaW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZmFjdG9yeV0gLSBGYWN0b3J5IG5hbWUgdG8gcnVuLiBEZWZhdWx0cyB0byB0aGUgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLnRyYWl0c10gLSBUcmFpdHMgcGFzc2VkIHRvIHRoZSBhc3NvY2lhdGlvbiBmYWN0b3J5LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3Mub3ZlcnJpZGVzXSAtIE92ZXJyaWRlcyBwYXNzZWQgdG8gdGhlIGFzc29jaWF0aW9uIGZhY3RvcnkuXG4gICAqIEBwYXJhbSB7XCJidWlsZFwiIHwgXCJjcmVhdGVcIiB8IHVuZGVmaW5lZH0gW2FyZ3Muc3RyYXRlZ3ldIC0gRXhwbGljaXQgc3RyYXRlZ3kgb3ZlcnJpZGUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7bmFtZSwgZmFjdG9yeSwgdHJhaXRzID0gW10sIG92ZXJyaWRlcyA9IHt9LCBzdHJhdGVneX0pIHtcbiAgICBpZiAoIW5hbWUgfHwgdHlwZW9mIG5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkRGVmaW5pdGlvbkVycm9yKGBBc3NvY2lhdGlvbiBuYW1lIG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKG5hbWUpfWApXG4gICAgfVxuXG4gICAgaWYgKHN0cmF0ZWd5ICE9PSB1bmRlZmluZWQgJiYgc3RyYXRlZ3kgIT09IFwiYnVpbGRcIiAmJiBzdHJhdGVneSAhPT0gXCJjcmVhdGVcIikge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWREZWZpbml0aW9uRXJyb3IoYEFzc29jaWF0aW9uIHN0cmF0ZWd5IG11c3QgYmUgXCJidWlsZFwiIG9yIFwiY3JlYXRlXCIsIGdvdDogJHtTdHJpbmcoc3RyYXRlZ3kpfWApXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtcImFzc29jaWF0aW9uXCJ9IC0gRGlzY3JpbWluYW50LiAqL1xuICAgIHRoaXMua2luZCA9IFwiYXNzb2NpYXRpb25cIlxuXG4gICAgLyoqIEB0eXBlIHtzdHJpbmd9IC0gUmVsYXRpb25zaGlwIG5hbWUgb24gdGhlIG93bmluZyBtb2RlbC4gKi9cbiAgICB0aGlzLm5hbWUgPSBuYW1lXG5cbiAgICAvKiogQHR5cGUge3N0cmluZ30gLSBGYWN0b3J5IG5hbWUgdG8gcnVuIGZvciB0aGUgYXNzb2NpYXRpb24uICovXG4gICAgdGhpcy5mYWN0b3J5ID0gZmFjdG9yeSB8fCBuYW1lXG5cbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAtIFRyYWl0cyBwYXNzZWQgdG8gdGhlIGFzc29jaWF0aW9uIGZhY3RvcnkuICovXG4gICAgdGhpcy50cmFpdHMgPSB0cmFpdHNcblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIE92ZXJyaWRlcyBwYXNzZWQgdG8gdGhlIGFzc29jaWF0aW9uIGZhY3RvcnkuICovXG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXNcblxuICAgIC8qKiBAdHlwZSB7XCJidWlsZFwiIHwgXCJjcmVhdGVcIiB8IHVuZGVmaW5lZH0gLSBFeHBsaWNpdCBzdHJhdGVneSBvdmVycmlkZS4gKi9cbiAgICB0aGlzLnN0cmF0ZWd5ID0gc3RyYXRlZ3lcblxuICAgIE9iamVjdC5mcmVlemUodGhpcylcbiAgfVxufVxuIl19