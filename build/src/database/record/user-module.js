// @ts-check
import bcryptjs from "bcryptjs";
import restArgsError from "../../utils/rest-args-error.js";
export default class UserModule {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {string} args.secretKey - Secret key.
     */
    constructor({ secretKey, ...restArgs }) {
        restArgsError(restArgs);
        if (!secretKey)
            throw new Error(`Invalid secret key given: ${secretKey}`);
        this.secretKey = secretKey;
    }
    /**
     * Runs attach to.
     * @param {typeof import("./index.js").default} UserClass - User class.
     */
    attachTo(UserClass) {
        // @ts-expect-error
        UserClass.prototype.setPassword = function (newPassword) {
            const salt = bcryptjs.genSaltSync(10);
            const encryptedPassword = bcryptjs.hashSync(newPassword, salt);
            // @ts-expect-error
            this.setEncryptedPassword(encryptedPassword);
        };
        // @ts-expect-error
        UserClass.prototype.setPasswordConfirmation = function (newPasswordConfirmation) {
            const salt = bcryptjs.genSaltSync(10);
            const encryptedPassword = bcryptjs.hashSync(newPasswordConfirmation, salt);
            // @ts-expect-error
            this._encryptedPasswordConfirmation = encryptedPassword;
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlci1tb2R1bGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL3VzZXItbW9kdWxlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFFBQVEsTUFBTSxVQUFVLENBQUE7QUFDL0IsT0FBTyxhQUFhLE1BQU0sZ0NBQWdDLENBQUE7QUFFMUQsTUFBTSxDQUFDLE9BQU8sT0FBTyxVQUFVO0lBQzdCOzs7O09BSUc7SUFDSCxZQUFZLEVBQUMsU0FBUyxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ2xDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsU0FBUztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLFNBQVMsRUFBRSxDQUFDLENBQUE7UUFFekUsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILFFBQVEsQ0FBQyxTQUFTO1FBQ2hCLG1CQUFtQjtRQUNuQixTQUFTLENBQUMsU0FBUyxDQUFDLFdBQVcsR0FBRyxVQUFTLFdBQVc7WUFDcEQsTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUNyQyxNQUFNLGlCQUFpQixHQUFHLFFBQVEsQ0FBQyxRQUFRLENBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxDQUFBO1lBRTlELG1CQUFtQjtZQUNuQixJQUFJLENBQUMsb0JBQW9CLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtRQUM5QyxDQUFDLENBQUE7UUFFRCxtQkFBbUI7UUFDbkIsU0FBUyxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsR0FBRyxVQUFTLHVCQUF1QjtZQUM1RSxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQ3JDLE1BQU0saUJBQWlCLEdBQUcsUUFBUSxDQUFDLFFBQVEsQ0FBQyx1QkFBdUIsRUFBRSxJQUFJLENBQUMsQ0FBQTtZQUUxRSxtQkFBbUI7WUFDbkIsSUFBSSxDQUFDLDhCQUE4QixHQUFHLGlCQUFpQixDQUFBO1FBQ3pELENBQUMsQ0FBQTtJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgYmNyeXB0anMgZnJvbSBcImJjcnlwdGpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBVc2VyTW9kdWxlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNlY3JldEtleSAtIFNlY3JldCBrZXkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7c2VjcmV0S2V5LCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFzZWNyZXRLZXkpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzZWNyZXQga2V5IGdpdmVuOiAke3NlY3JldEtleX1gKVxuXG4gICAgdGhpcy5zZWNyZXRLZXkgPSBzZWNyZXRLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF0dGFjaCB0by5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBVc2VyQ2xhc3MgLSBVc2VyIGNsYXNzLlxuICAgKi9cbiAgYXR0YWNoVG8oVXNlckNsYXNzKSB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIFVzZXJDbGFzcy5wcm90b3R5cGUuc2V0UGFzc3dvcmQgPSBmdW5jdGlvbihuZXdQYXNzd29yZCkge1xuICAgICAgY29uc3Qgc2FsdCA9IGJjcnlwdGpzLmdlblNhbHRTeW5jKDEwKVxuICAgICAgY29uc3QgZW5jcnlwdGVkUGFzc3dvcmQgPSBiY3J5cHRqcy5oYXNoU3luYyhuZXdQYXNzd29yZCwgc2FsdClcblxuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgICAgdGhpcy5zZXRFbmNyeXB0ZWRQYXNzd29yZChlbmNyeXB0ZWRQYXNzd29yZClcbiAgICB9XG5cbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgVXNlckNsYXNzLnByb3RvdHlwZS5zZXRQYXNzd29yZENvbmZpcm1hdGlvbiA9IGZ1bmN0aW9uKG5ld1Bhc3N3b3JkQ29uZmlybWF0aW9uKSB7XG4gICAgICBjb25zdCBzYWx0ID0gYmNyeXB0anMuZ2VuU2FsdFN5bmMoMTApXG4gICAgICBjb25zdCBlbmNyeXB0ZWRQYXNzd29yZCA9IGJjcnlwdGpzLmhhc2hTeW5jKG5ld1Bhc3N3b3JkQ29uZmlybWF0aW9uLCBzYWx0KVxuXG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgICB0aGlzLl9lbmNyeXB0ZWRQYXNzd29yZENvbmZpcm1hdGlvbiA9IGVuY3J5cHRlZFBhc3N3b3JkXG4gICAgfVxuICB9XG59XG4iXX0=