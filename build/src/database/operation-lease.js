// @ts-check
/**
 * Exclusive lease installed on a shared physical connection while one
 * operation-scoped transaction owns it.
 */
export default class VelociousDatabaseOperationLease {
    /**
     * Runs constructor.
     * @param {symbol} owner - Opaque operation owner token.
     */
    constructor(owner) {
        this.owner = owner;
        this.released = false;
        /**
         * Resolves the lease waiters.
         * @type {() => void} */
        let release = () => { };
        this.releasedPromise = new Promise((resolve) => {
            release = () => resolve(undefined);
        });
        this.releasePromise = release;
    }
    /**
     * Waits until the lease is released unless `owner` owns it.
     * @param {symbol | undefined} owner - Candidate operation owner.
     * @returns {Promise<void>} - Resolves when access is allowed.
     */
    async wait(owner) {
        if (owner === this.owner)
            return;
        await this.releasedPromise;
    }
    /**
     * Releases all waiters exactly once.
     * @returns {void}
     */
    release() {
        if (this.released)
            return;
        this.released = true;
        this.releasePromise();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlcmF0aW9uLWxlYXNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RhdGFiYXNlL29wZXJhdGlvbi1sZWFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVo7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTywrQkFBK0I7SUFDbEQ7OztPQUdHO0lBQ0gsWUFBWSxLQUFLO1FBQ2YsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7UUFDbEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUE7UUFDckI7O2dDQUV3QjtRQUN4QixJQUFJLE9BQU8sR0FBRyxHQUFHLEVBQUUsR0FBRSxDQUFDLENBQUE7UUFFdEIsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQzdDLE9BQU8sR0FBRyxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDcEMsQ0FBQyxDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsY0FBYyxHQUFHLE9BQU8sQ0FBQTtJQUMvQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSztRQUNkLElBQUksS0FBSyxLQUFLLElBQUksQ0FBQyxLQUFLO1lBQUUsT0FBTTtRQUVoQyxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILE9BQU87UUFDTCxJQUFJLElBQUksQ0FBQyxRQUFRO1lBQUUsT0FBTTtRQUV6QixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtRQUNwQixJQUFJLENBQUMsY0FBYyxFQUFFLENBQUE7SUFDdkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogRXhjbHVzaXZlIGxlYXNlIGluc3RhbGxlZCBvbiBhIHNoYXJlZCBwaHlzaWNhbCBjb25uZWN0aW9uIHdoaWxlIG9uZVxuICogb3BlcmF0aW9uLXNjb3BlZCB0cmFuc2FjdGlvbiBvd25zIGl0LlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNEYXRhYmFzZU9wZXJhdGlvbkxlYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3ltYm9sfSBvd25lciAtIE9wYXF1ZSBvcGVyYXRpb24gb3duZXIgdG9rZW4uXG4gICAqL1xuICBjb25zdHJ1Y3Rvcihvd25lcikge1xuICAgIHRoaXMub3duZXIgPSBvd25lclxuICAgIHRoaXMucmVsZWFzZWQgPSBmYWxzZVxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIHRoZSBsZWFzZSB3YWl0ZXJzLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfSAqL1xuICAgIGxldCByZWxlYXNlID0gKCkgPT4ge31cblxuICAgIHRoaXMucmVsZWFzZWRQcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHJlbGVhc2UgPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZClcbiAgICB9KVxuICAgIHRoaXMucmVsZWFzZVByb21pc2UgPSByZWxlYXNlXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgdW50aWwgdGhlIGxlYXNlIGlzIHJlbGVhc2VkIHVubGVzcyBgb3duZXJgIG93bnMgaXQuXG4gICAqIEBwYXJhbSB7c3ltYm9sIHwgdW5kZWZpbmVkfSBvd25lciAtIENhbmRpZGF0ZSBvcGVyYXRpb24gb3duZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWNjZXNzIGlzIGFsbG93ZWQuXG4gICAqL1xuICBhc3luYyB3YWl0KG93bmVyKSB7XG4gICAgaWYgKG93bmVyID09PSB0aGlzLm93bmVyKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMucmVsZWFzZWRQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgYWxsIHdhaXRlcnMgZXhhY3RseSBvbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlbGVhc2UoKSB7XG4gICAgaWYgKHRoaXMucmVsZWFzZWQpIHJldHVyblxuXG4gICAgdGhpcy5yZWxlYXNlZCA9IHRydWVcbiAgICB0aGlzLnJlbGVhc2VQcm9taXNlKClcbiAgfVxufVxuIl19