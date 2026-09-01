export default class UserModule {
    secretKey: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.secretKey - Secret key.
     */
    constructor({ secretKey, ...restArgs }: {
        secretKey: string;
    });
    /**
     * Runs attach to.
     * @param {typeof import("./index.js").default} UserClass - User class.
     */
    attachTo(UserClass: typeof import("./index.js").default): void;
}
//# sourceMappingURL=user-module.d.ts.map