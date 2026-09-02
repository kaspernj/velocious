// @ts-check
/**
 * Validates a low-cardinality activity label suitable for profile output.
 * @param {string} name - Activity name.
 * @returns {string} - Validated name.
 */
export function validateTestActivityName(name) {
    if (typeof name !== "string" || !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(name) || name.length > 64) {
        throw new Error("Test profile activity name must be a lowercase identifier of at most 64 characters");
    }
    return name;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1wcm9maWxlLWFjdGl2aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Rlc3RpbmcvdGVzdC1wcm9maWxlLWFjdGl2aXR5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLHdCQUF3QixDQUFDLElBQUk7SUFDM0MsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLElBQUksQ0FBQyxzQ0FBc0MsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLEVBQUUsQ0FBQztRQUN2RyxNQUFNLElBQUksS0FBSyxDQUFDLG9GQUFvRixDQUFDLENBQUE7SUFDdkcsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFBO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIFZhbGlkYXRlcyBhIGxvdy1jYXJkaW5hbGl0eSBhY3Rpdml0eSBsYWJlbCBzdWl0YWJsZSBmb3IgcHJvZmlsZSBvdXRwdXQuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEFjdGl2aXR5IG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZhbGlkYXRlZCBuYW1lLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVUZXN0QWN0aXZpdHlOYW1lKG5hbWUpIHtcbiAgaWYgKHR5cGVvZiBuYW1lICE9PSBcInN0cmluZ1wiIHx8ICEvXlthLXpdW2EtejAtOV0qKD86Wy5fOi1dW2EtejAtOV0rKSokLy50ZXN0KG5hbWUpIHx8IG5hbWUubGVuZ3RoID4gNjQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0IHByb2ZpbGUgYWN0aXZpdHkgbmFtZSBtdXN0IGJlIGEgbG93ZXJjYXNlIGlkZW50aWZpZXIgb2YgYXQgbW9zdCA2NCBjaGFyYWN0ZXJzXCIpXG4gIH1cblxuICByZXR1cm4gbmFtZVxufVxuIl19