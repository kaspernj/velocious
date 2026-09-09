// @ts-check
import { Temporal } from "@js-temporal/polyfill";
export const REQUEST_TIME_ZONE_HEADER = "X-Velocious-Time-Zone";
const timezoneOffsetPattern = /^[+-]\d{2}:\d{2}$/;
/**
 * Validates a configured or client-provided IANA timezone.
 * @param {string} timeZone - Timezone identifier.
 * @param {string} label - Error label.
 * @returns {string} - Normalized timezone identifier.
 */
export function validateTimeZone(timeZone, label = "timeZone") {
    if (typeof timeZone !== "string") {
        throw new Error(`Expected ${label} to be a timezone string`);
    }
    const normalizedTimeZone = timeZone.trim();
    if (!normalizedTimeZone) {
        throw new Error(`Expected ${label} to be a timezone string`);
    }
    if (timezoneOffsetPattern.test(normalizedTimeZone)) {
        throw new Error(`Expected ${label} to be an IANA timezone string, not offset "${normalizedTimeZone}"`);
    }
    try {
        Temporal.ZonedDateTime.from({
            day: 1,
            hour: 0,
            microsecond: 0,
            millisecond: 0,
            minute: 0,
            month: 1,
            nanosecond: 0,
            second: 0,
            timeZone: normalizedTimeZone,
            year: 2000
        });
    }
    catch (error) {
        throw new Error(`Invalid timezone "${normalizedTimeZone}" for ${label}`, { cause: error });
    }
    return normalizedTimeZone;
}
/**
 * Formats a Date as an ISO timestamp in the given timezone.
 * @param {Date} value - Date instant.
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {string} - ISO timestamp carrying the timezone's offset for the instant.
 */
export function formatDateInTimeZone(value, timeZone) {
    const normalizedTimeZone = validateTimeZone(timeZone, "timeZone");
    const instant = Temporal.Instant.fromEpochMilliseconds(value.getTime());
    const zonedDateTime = instant.toZonedDateTimeISO(normalizedTimeZone);
    return zonedDateTime.toString({
        fractionalSecondDigits: 3,
        timeZoneName: "never"
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGltZS16b25lLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3RpbWUtem9uZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLFFBQVEsRUFBQyxNQUFNLHVCQUF1QixDQUFBO0FBRTlDLE1BQU0sQ0FBQyxNQUFNLHdCQUF3QixHQUFHLHVCQUF1QixDQUFBO0FBRS9ELE1BQU0scUJBQXFCLEdBQUcsbUJBQW1CLENBQUE7QUFFakQ7Ozs7O0dBS0c7QUFDSCxNQUFNLFVBQVUsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLEtBQUssR0FBRyxVQUFVO0lBQzNELElBQUksT0FBTyxRQUFRLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDakMsTUFBTSxJQUFJLEtBQUssQ0FBQyxZQUFZLEtBQUssMEJBQTBCLENBQUMsQ0FBQTtJQUM5RCxDQUFDO0lBRUQsTUFBTSxrQkFBa0IsR0FBRyxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUE7SUFFMUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7UUFDeEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxZQUFZLEtBQUssMEJBQTBCLENBQUMsQ0FBQTtJQUM5RCxDQUFDO0lBRUQsSUFBSSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1FBQ25ELE1BQU0sSUFBSSxLQUFLLENBQUMsWUFBWSxLQUFLLCtDQUErQyxrQkFBa0IsR0FBRyxDQUFDLENBQUE7SUFDeEcsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILFFBQVEsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDO1lBQzFCLEdBQUcsRUFBRSxDQUFDO1lBQ04sSUFBSSxFQUFFLENBQUM7WUFDUCxXQUFXLEVBQUUsQ0FBQztZQUNkLFdBQVcsRUFBRSxDQUFDO1lBQ2QsTUFBTSxFQUFFLENBQUM7WUFDVCxLQUFLLEVBQUUsQ0FBQztZQUNSLFVBQVUsRUFBRSxDQUFDO1lBQ2IsTUFBTSxFQUFFLENBQUM7WUFDVCxRQUFRLEVBQUUsa0JBQWtCO1lBQzVCLElBQUksRUFBRSxJQUFJO1NBQ1gsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixrQkFBa0IsU0FBUyxLQUFLLEVBQUUsRUFBRSxFQUFDLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQzFGLENBQUM7SUFFRCxPQUFPLGtCQUFrQixDQUFBO0FBQzNCLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsUUFBUTtJQUNsRCxNQUFNLGtCQUFrQixHQUFHLGdCQUFnQixDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQTtJQUNqRSxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLHFCQUFxQixDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFBO0lBQ3ZFLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO0lBRXBFLE9BQU8sYUFBYSxDQUFDLFFBQVEsQ0FBQztRQUM1QixzQkFBc0IsRUFBRSxDQUFDO1FBQ3pCLFlBQVksRUFBRSxPQUFPO0tBQ3RCLENBQUMsQ0FBQTtBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtUZW1wb3JhbH0gZnJvbSBcIkBqcy10ZW1wb3JhbC9wb2x5ZmlsbFwiXG5cbmV4cG9ydCBjb25zdCBSRVFVRVNUX1RJTUVfWk9ORV9IRUFERVIgPSBcIlgtVmVsb2Npb3VzLVRpbWUtWm9uZVwiXG5cbmNvbnN0IHRpbWV6b25lT2Zmc2V0UGF0dGVybiA9IC9eWystXVxcZHsyfTpcXGR7Mn0kL1xuXG4vKipcbiAqIFZhbGlkYXRlcyBhIGNvbmZpZ3VyZWQgb3IgY2xpZW50LXByb3ZpZGVkIElBTkEgdGltZXpvbmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gdGltZVpvbmUgLSBUaW1lem9uZSBpZGVudGlmaWVyLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gRXJyb3IgbGFiZWwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vcm1hbGl6ZWQgdGltZXpvbmUgaWRlbnRpZmllci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIGxhYmVsID0gXCJ0aW1lWm9uZVwiKSB7XG4gIGlmICh0eXBlb2YgdGltZVpvbmUgIT09IFwic3RyaW5nXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkICR7bGFiZWx9IHRvIGJlIGEgdGltZXpvbmUgc3RyaW5nYClcbiAgfVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWRUaW1lWm9uZSA9IHRpbWVab25lLnRyaW0oKVxuXG4gIGlmICghbm9ybWFsaXplZFRpbWVab25lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCAke2xhYmVsfSB0byBiZSBhIHRpbWV6b25lIHN0cmluZ2ApXG4gIH1cblxuICBpZiAodGltZXpvbmVPZmZzZXRQYXR0ZXJuLnRlc3Qobm9ybWFsaXplZFRpbWVab25lKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHtsYWJlbH0gdG8gYmUgYW4gSUFOQSB0aW1lem9uZSBzdHJpbmcsIG5vdCBvZmZzZXQgXCIke25vcm1hbGl6ZWRUaW1lWm9uZX1cImApXG4gIH1cblxuICB0cnkge1xuICAgIFRlbXBvcmFsLlpvbmVkRGF0ZVRpbWUuZnJvbSh7XG4gICAgICBkYXk6IDEsXG4gICAgICBob3VyOiAwLFxuICAgICAgbWljcm9zZWNvbmQ6IDAsXG4gICAgICBtaWxsaXNlY29uZDogMCxcbiAgICAgIG1pbnV0ZTogMCxcbiAgICAgIG1vbnRoOiAxLFxuICAgICAgbmFub3NlY29uZDogMCxcbiAgICAgIHNlY29uZDogMCxcbiAgICAgIHRpbWVab25lOiBub3JtYWxpemVkVGltZVpvbmUsXG4gICAgICB5ZWFyOiAyMDAwXG4gICAgfSlcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgdGltZXpvbmUgXCIke25vcm1hbGl6ZWRUaW1lWm9uZX1cIiBmb3IgJHtsYWJlbH1gLCB7Y2F1c2U6IGVycm9yfSlcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkVGltZVpvbmVcbn1cblxuLyoqXG4gKiBGb3JtYXRzIGEgRGF0ZSBhcyBhbiBJU08gdGltZXN0YW1wIGluIHRoZSBnaXZlbiB0aW1lem9uZS5cbiAqIEBwYXJhbSB7RGF0ZX0gdmFsdWUgLSBEYXRlIGluc3RhbnQuXG4gKiBAcGFyYW0ge3N0cmluZ30gdGltZVpvbmUgLSBJQU5BIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIElTTyB0aW1lc3RhbXAgY2FycnlpbmcgdGhlIHRpbWV6b25lJ3Mgb2Zmc2V0IGZvciB0aGUgaW5zdGFudC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdERhdGVJblRpbWVab25lKHZhbHVlLCB0aW1lWm9uZSkge1xuICBjb25zdCBub3JtYWxpemVkVGltZVpvbmUgPSB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcInRpbWVab25lXCIpXG4gIGNvbnN0IGluc3RhbnQgPSBUZW1wb3JhbC5JbnN0YW50LmZyb21FcG9jaE1pbGxpc2Vjb25kcyh2YWx1ZS5nZXRUaW1lKCkpXG4gIGNvbnN0IHpvbmVkRGF0ZVRpbWUgPSBpbnN0YW50LnRvWm9uZWREYXRlVGltZUlTTyhub3JtYWxpemVkVGltZVpvbmUpXG5cbiAgcmV0dXJuIHpvbmVkRGF0ZVRpbWUudG9TdHJpbmcoe1xuICAgIGZyYWN0aW9uYWxTZWNvbmREaWdpdHM6IDMsXG4gICAgdGltZVpvbmVOYW1lOiBcIm5ldmVyXCJcbiAgfSlcbn1cbiJdfQ==