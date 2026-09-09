// @ts-check
import DatabaseRecord from "../index.js";
import RecordAttachmentsStore from "./store.js";
const INTEGER_STRING_PATTERN = /^-?\d+$/;
/** Frontend-readable metadata row for `velocious_attachments`. */
export default class VelociousAttachment extends DatabaseRecord {
    /**
     * Returns the backing attachment table name.
     * @returns {string} - Backing attachment table name.
     */
    static tableName() {
        return "velocious_attachments";
    }
    /**
     * Ensures the framework-owned attachment table exists before loading metadata.
     * @param {object} args - Options object.
     * @param {import("../../../configuration.js").default} args.configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    static async initializeRecord({ configuration }) {
        const store = new RecordAttachmentsStore({
            configuration,
            databaseIdentifier: this.getConfiguredDatabaseIdentifier()
        });
        await store.ensureReady();
        await super.initializeRecord({ configuration });
    }
    /**
     * Returns the attachment id.
     * @returns {string} - Attachment id.
     */
    id() { return this.readAttribute("id"); }
    /**
     * Returns the owner model name.
     * @returns {string} - Owner model name.
     */
    recordType() { return this.readAttribute("recordType"); }
    /**
     * Returns the owner record id.
     * @returns {string} - Owner record id.
     */
    recordId() { return this.readAttribute("recordId"); }
    /**
     * Returns the attachment name on the owner model.
     * @returns {string} - Attachment name on the owner model.
     */
    name() { return this.readAttribute("name"); }
    /**
     * Returns the attachment position.
     * @returns {number} - Attachment position.
     */
    position() { return this.readAttribute("position"); }
    /**
     * Returns the attachment filename.
     * @returns {string} - Attachment filename.
     */
    filename() { return this.readAttribute("filename"); }
    /**
     * Returns the attachment content type.
     * @returns {string | null} - Attachment content type.
     */
    contentType() { return this.readAttribute("contentType"); }
    /**
     * Returns the attachment byte size.
     * @returns {number} - Attachment byte size.
     */
    byteSize() { return this.safeIntegerAttribute({ attributeName: "byteSize", expectedDescription: "attachment byte size" }); }
    /**
     * Returns the created-at timestamp in milliseconds.
     * @returns {number} - Created-at timestamp in milliseconds.
     */
    createdAtMs() { return this.safeIntegerAttribute({ attributeName: "createdAtMs", expectedDescription: "safe millisecond timestamp" }); }
    /**
     * Returns the updated-at timestamp in milliseconds.
     * @returns {number} - Updated-at timestamp in milliseconds.
     */
    updatedAtMs() { return this.safeIntegerAttribute({ attributeName: "updatedAtMs", expectedDescription: "safe millisecond timestamp" }); }
    /**
     * Returns a checked integer attribute value.
     * @param {object} args - Options object.
     * @param {"byteSize" | "createdAtMs" | "updatedAtMs"} args.attributeName - Integer attribute name.
     * @param {string} args.expectedDescription - Description for error messages.
     * @returns {number} - Safe integer value.
     */
    safeIntegerAttribute({ attributeName, expectedDescription }) {
        const value = this.readAttribute(attributeName);
        let integer;
        if (typeof value === "number") {
            integer = value;
        }
        else if (typeof value === "bigint") {
            integer = Number(value);
        }
        else if (typeof value === "string" && INTEGER_STRING_PATTERN.test(value)) {
            integer = Number(value);
        }
        else {
            throw new Error(`Expected ${attributeName} to be a ${expectedDescription}`);
        }
        if (!Number.isSafeInteger(integer)) {
            throw new Error(`Expected ${attributeName} to be a ${expectedDescription}`);
        }
        return integer;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXR0YWNobWVudC1yZWNvcmQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL2F0dGFjaG1lbnQtcmVjb3JkLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGNBQWMsTUFBTSxhQUFhLENBQUE7QUFDeEMsT0FBTyxzQkFBc0IsTUFBTSxZQUFZLENBQUE7QUFFL0MsTUFBTSxzQkFBc0IsR0FBRyxTQUFTLENBQUE7QUFFeEMsa0VBQWtFO0FBQ2xFLE1BQU0sQ0FBQyxPQUFPLE9BQU8sbUJBQW9CLFNBQVEsY0FBYztJQUM3RDs7O09BR0c7SUFDSCxNQUFNLENBQUMsU0FBUztRQUNkLE9BQU8sdUJBQXVCLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLGFBQWEsRUFBQztRQUMzQyxNQUFNLEtBQUssR0FBRyxJQUFJLHNCQUFzQixDQUFDO1lBQ3ZDLGFBQWE7WUFDYixrQkFBa0IsRUFBRSxJQUFJLENBQUMsK0JBQStCLEVBQUU7U0FDM0QsQ0FBQyxDQUFBO1FBRUYsTUFBTSxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUE7UUFDekIsTUFBTSxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7O09BR0c7SUFDSCxFQUFFLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUV4Qzs7O09BR0c7SUFDSCxVQUFVLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUV4RDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxJQUFJLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUU1Qzs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVwRDs7O09BR0c7SUFDSCxXQUFXLEtBQUssT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUUxRDs7O09BR0c7SUFDSCxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUMsb0JBQW9CLENBQUMsRUFBQyxhQUFhLEVBQUUsVUFBVSxFQUFFLG1CQUFtQixFQUFFLHNCQUFzQixFQUFDLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFekg7OztPQUdHO0lBQ0gsV0FBVyxLQUFLLE9BQU8sSUFBSSxDQUFDLG9CQUFvQixDQUFDLEVBQUMsYUFBYSxFQUFFLGFBQWEsRUFBRSxtQkFBbUIsRUFBRSw0QkFBNEIsRUFBQyxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRXJJOzs7T0FHRztJQUNILFdBQVcsS0FBSyxPQUFPLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxFQUFDLGFBQWEsRUFBRSxhQUFhLEVBQUUsbUJBQW1CLEVBQUUsNEJBQTRCLEVBQUMsQ0FBQyxDQUFBLENBQUMsQ0FBQztJQUVySTs7Ozs7O09BTUc7SUFDSCxvQkFBb0IsQ0FBQyxFQUFDLGFBQWEsRUFBRSxtQkFBbUIsRUFBQztRQUN2RCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQy9DLElBQUksT0FBTyxDQUFBO1FBRVgsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM5QixPQUFPLEdBQUcsS0FBSyxDQUFBO1FBQ2pCLENBQUM7YUFBTSxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3JDLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDekIsQ0FBQzthQUFNLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLHNCQUFzQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzNFLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDekIsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksYUFBYSxZQUFZLG1CQUFtQixFQUFFLENBQUMsQ0FBQTtRQUM3RSxDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNuQyxNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksYUFBYSxZQUFZLG1CQUFtQixFQUFFLENBQUMsQ0FBQTtRQUM3RSxDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBEYXRhYmFzZVJlY29yZCBmcm9tIFwiLi4vaW5kZXguanNcIlxuaW1wb3J0IFJlY29yZEF0dGFjaG1lbnRzU3RvcmUgZnJvbSBcIi4vc3RvcmUuanNcIlxuXG5jb25zdCBJTlRFR0VSX1NUUklOR19QQVRURVJOID0gL14tP1xcZCskL1xuXG4vKiogRnJvbnRlbmQtcmVhZGFibGUgbWV0YWRhdGEgcm93IGZvciBgdmVsb2Npb3VzX2F0dGFjaG1lbnRzYC4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0F0dGFjaG1lbnQgZXh0ZW5kcyBEYXRhYmFzZVJlY29yZCB7XG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBiYWNraW5nIGF0dGFjaG1lbnQgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBCYWNraW5nIGF0dGFjaG1lbnQgdGFibGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyB0YWJsZU5hbWUoKSB7XG4gICAgcmV0dXJuIFwidmVsb2Npb3VzX2F0dGFjaG1lbnRzXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBmcmFtZXdvcmstb3duZWQgYXR0YWNobWVudCB0YWJsZSBleGlzdHMgYmVmb3JlIGxvYWRpbmcgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb259KSB7XG4gICAgY29uc3Qgc3RvcmUgPSBuZXcgUmVjb3JkQXR0YWNobWVudHNTdG9yZSh7XG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIH0pXG5cbiAgICBhd2FpdCBzdG9yZS5lbnN1cmVSZWFkeSgpXG4gICAgYXdhaXQgc3VwZXIuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBpZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBdHRhY2htZW50IGlkLlxuICAgKi9cbiAgaWQoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJpZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG93bmVyIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gT3duZXIgbW9kZWwgbmFtZS5cbiAgICovXG4gIHJlY29yZFR5cGUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJyZWNvcmRUeXBlXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgb3duZXIgcmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE93bmVyIHJlY29yZCBpZC5cbiAgICovXG4gIHJlY29yZElkKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicmVjb3JkSWRcIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IG5hbWUgb24gdGhlIG93bmVyIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgbmFtZSBvbiB0aGUgb3duZXIgbW9kZWwuXG4gICAqL1xuICBuYW1lKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwibmFtZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgcG9zaXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNobWVudCBwb3NpdGlvbi5cbiAgICovXG4gIHBvc2l0aW9uKCkgeyByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKFwicG9zaXRpb25cIikgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdHRhY2htZW50IGZpbGVuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEF0dGFjaG1lbnQgZmlsZW5hbWUuXG4gICAqL1xuICBmaWxlbmFtZSgpIHsgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShcImZpbGVuYW1lXCIpIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXR0YWNobWVudCBjb250ZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIEF0dGFjaG1lbnQgY29udGVudCB0eXBlLlxuICAgKi9cbiAgY29udGVudFR5cGUoKSB7IHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoXCJjb250ZW50VHlwZVwiKSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF0dGFjaG1lbnQgYnl0ZSBzaXplLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaG1lbnQgYnl0ZSBzaXplLlxuICAgKi9cbiAgYnl0ZVNpemUoKSB7IHJldHVybiB0aGlzLnNhZmVJbnRlZ2VyQXR0cmlidXRlKHthdHRyaWJ1dGVOYW1lOiBcImJ5dGVTaXplXCIsIGV4cGVjdGVkRGVzY3JpcHRpb246IFwiYXR0YWNobWVudCBieXRlIHNpemVcIn0pIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3JlYXRlZC1hdCB0aW1lc3RhbXAgaW4gbWlsbGlzZWNvbmRzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIENyZWF0ZWQtYXQgdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIGNyZWF0ZWRBdE1zKCkgeyByZXR1cm4gdGhpcy5zYWZlSW50ZWdlckF0dHJpYnV0ZSh7YXR0cmlidXRlTmFtZTogXCJjcmVhdGVkQXRNc1wiLCBleHBlY3RlZERlc2NyaXB0aW9uOiBcInNhZmUgbWlsbGlzZWNvbmQgdGltZXN0YW1wXCJ9KSB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHVwZGF0ZWQtYXQgdGltZXN0YW1wIGluIG1pbGxpc2Vjb25kcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBVcGRhdGVkLWF0IHRpbWVzdGFtcCBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICB1cGRhdGVkQXRNcygpIHsgcmV0dXJuIHRoaXMuc2FmZUludGVnZXJBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWU6IFwidXBkYXRlZEF0TXNcIiwgZXhwZWN0ZWREZXNjcmlwdGlvbjogXCJzYWZlIG1pbGxpc2Vjb25kIHRpbWVzdGFtcFwifSkgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgY2hlY2tlZCBpbnRlZ2VyIGF0dHJpYnV0ZSB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtcImJ5dGVTaXplXCIgfCBcImNyZWF0ZWRBdE1zXCIgfCBcInVwZGF0ZWRBdE1zXCJ9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEludGVnZXIgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmV4cGVjdGVkRGVzY3JpcHRpb24gLSBEZXNjcmlwdGlvbiBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gU2FmZSBpbnRlZ2VyIHZhbHVlLlxuICAgKi9cbiAgc2FmZUludGVnZXJBdHRyaWJ1dGUoe2F0dHJpYnV0ZU5hbWUsIGV4cGVjdGVkRGVzY3JpcHRpb259KSB7XG4gICAgY29uc3QgdmFsdWUgPSB0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICBsZXQgaW50ZWdlclxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgaW50ZWdlciA9IHZhbHVlXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiYmlnaW50XCIpIHtcbiAgICAgIGludGVnZXIgPSBOdW1iZXIodmFsdWUpXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgSU5URUdFUl9TVFJJTkdfUEFUVEVSTi50ZXN0KHZhbHVlKSkge1xuICAgICAgaW50ZWdlciA9IE51bWJlcih2YWx1ZSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke2F0dHJpYnV0ZU5hbWV9IHRvIGJlIGEgJHtleHBlY3RlZERlc2NyaXB0aW9ufWApXG4gICAgfVxuXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihpbnRlZ2VyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke2F0dHJpYnV0ZU5hbWV9IHRvIGJlIGEgJHtleHBlY3RlZERlc2NyaXB0aW9ufWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGludGVnZXJcbiAgfVxufVxuIl19