import bcryptjs from "bcryptjs"
import restArgsError from "../../utils/rest-args-error.js"

export default class UserModule {
  constructor({secretKey, ...restArgs}) {
    restArgsError(restArgs)

    if (!secretKey) throw new Error(`Invalid secret key given: ${secretKey}`)

    this.secretKey = secretKey
  }

  attachTo(UserClass) {
    UserClass.prototype.setPassword = function(newPassword) {
      const salt = bcryptjs.genSaltSync(10)
      const encryptedPassword = bcryptjs.hashSync(newPassword, salt)

      this.setEncryptedPassword(encryptedPassword)
    }

    UserClass.prototype.setPasswordConfirmation = function(newPasswordConfirmation) {
      const salt = bcryptjs.genSaltSync(10)
      const encryptedPassword = bcryptjs.hashSync(newPasswordConfirmation, salt)

      this._encryptedPasswordConfirmation = encryptedPassword
    }
  }
}
