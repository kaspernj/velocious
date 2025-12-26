// @ts-check

import bcryptjs from "bcryptjs"
import restArgsError from "../../utils/rest-args-error.js"

export default class UserModule {
  /**
   * @param {object} args - Options object.
   * @param {string} args.secretKey - Secret key.
   */
  constructor({secretKey, ...restArgs}) {
    restArgsError(restArgs)

    if (!secretKey) throw new Error(`Invalid secret key given: ${secretKey}`)

    this.secretKey = secretKey
  }

  /**
   * @param {typeof import("./index.js").default} UserClass - User class.
   */
  attachTo(UserClass) {
    // @ts-expect-error
    UserClass.prototype.setPassword = function(newPassword) {
      const salt = bcryptjs.genSaltSync(10)
      const encryptedPassword = bcryptjs.hashSync(newPassword, salt)

      // @ts-expect-error
      this.setEncryptedPassword(encryptedPassword)
    }

    // @ts-expect-error
    UserClass.prototype.setPasswordConfirmation = function(newPasswordConfirmation) {
      const salt = bcryptjs.genSaltSync(10)
      const encryptedPassword = bcryptjs.hashSync(newPasswordConfirmation, salt)

      // @ts-expect-error
      this._encryptedPasswordConfirmation = encryptedPassword
    }
  }
}
