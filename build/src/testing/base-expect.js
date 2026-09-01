// @ts-check
export default class BaseExpect {
    /**
     * Runs run before.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    async runBefore() { }
    /**
     * Runs run after.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    async runAfter() { }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1leHBlY3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy9iYXNlLWV4cGVjdC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosTUFBTSxDQUFDLE9BQU8sT0FBTyxVQUFVO0lBQzdCOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsU0FBUyxLQUFzQixDQUFDO0lBRXRDOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsUUFBUSxLQUFzQixDQUFDO0NBQ3RDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhc2VFeHBlY3Qge1xuICAvKipcbiAgICogUnVucyBydW4gYmVmb3JlLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bkJlZm9yZSgpIHsgLyogZG8gbm90aGluZyAqLyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGFmdGVyLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bkFmdGVyKCkgeyAvKiBkbyBub3RoaW5nICovIH1cbn1cbiJdfQ==