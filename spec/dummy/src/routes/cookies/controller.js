import Controller from "../../../../../src/controller.js"

export default class CookiesController extends Controller {
  set() {
    this.setCookie("flavor", "chocolate", {httpOnly: true, path: "/", sameSite: "Lax"})
    this.renderJsonArg({status: "ok"})
  }

  setEncrypted() {
    this.setCookie("secret", "s3cr3t", {encrypted: true, httpOnly: true, path: "/"})
    this.renderJsonArg({status: "ok"})
  }

  read() {
    const cookies = this.getCookies().map((cookie) => {
      return {
        name: cookie.name(),
        value: cookie.value(),
        encrypted: cookie.isEncrypted(),
        error: cookie.error()?.message
      }
    })

    this.renderJsonArg({cookies})
  }
}
