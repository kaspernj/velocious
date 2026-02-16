// @ts-check

import ejs from "ejs"
import {incorporate} from "incorporator"
import * as inflection from "inflection"
import Logger from "./logger.js"
import Cookie from "./http-server/cookie.js"
import ParamsToObject from "./http-server/client/params-to-object.js"
import restArgsError from "./utils/rest-args-error.js"
import querystring from "querystring"

export default class VelociousController {
  /**
   * @param {string} methodName - Method name.
   * @returns {void} - No return value.
   */
  static beforeAction(methodName) {
    if (!this._beforeActions) {
      /** @type {Array<string>}  */
      this._beforeActions = []
    }

    this._beforeActions.push(methodName)
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.action - Action.
   * @param {import("./configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.controller - Controller.
   * @param {object} args.params - Parameters object.
   * @param {import("./http-server/client/request.js").default} args.request - Request object.
   * @param {import("./http-server/client/response.js").default} args.response - Response object.
   * @param {string} args.viewPath - View path.
   */
  constructor({action, configuration, controller, params, request, response, viewPath}) {
    if (!action) throw new Error("No action given")
    if (!configuration) throw new Error("No configuration given")
    if (!controller) throw new Error("No controller given")
    if (!params) throw new Error("No params given")
    if (!request) throw new Error("No request given")
    if (!response) throw new Error("No response given")
    if (!viewPath) throw new Error("No viewPath given")

    this._action = action
    this._controller = controller
    this._configuration = configuration
    this.logger = new Logger(this)
    this._params = params
    this._request = request
    this._response = response
    this.viewParams = {}
    this._viewPath = viewPath
  }

  /** @returns {string} - The action.  */
  getAction() { return this._action }

  /** @returns {import("./configuration.js").default} - The configuration.  */
  getConfiguration() { return this._configuration }

  /** @returns {Record<string, any>} - The params.  */
  getParams() { return this._params }

  /** @returns {import("./http-server/client/request.js").default} - The request.  */
  getRequest() { return this._request }

  /**
   * @param {string} name - Cookie name.
   * @param {unknown} value - Cookie value.
   * @param {object} [args] - Options object.
   * @param {string} [args.domain] - Domain.
   * @param {Date} [args.expires] - Expires date.
   * @param {boolean} [args.httpOnly] - HttpOnly flag.
   * @param {number} [args.maxAge] - Max-Age in seconds.
   * @param {string} [args.path] - Path.
   * @param {boolean} [args.secure] - Secure flag.
   * @param {"Lax" | "Strict" | "None"} [args.sameSite] - SameSite value.
   * @param {boolean} [args.encrypted] - Whether to encrypt the cookie value.
   * @returns {Cookie} - Cookie instance.
   */
  setCookie(name, value, args = {}) {
    const {encrypted = false, ...options} = args
    const secret = encrypted ? this.getConfiguration().getCookieSecret() : undefined
    const cookieValue = encrypted ? Cookie.encryptValue(value, secret) : String(value ?? "")
    const cookie = new Cookie({name, value: cookieValue, options, encrypted})

    this._response.addHeader("Set-Cookie", cookie.toHeader())

    return cookie
  }

  /** @returns {Cookie[]} - Cookies from the request. */
  getCookies() {
    if (!this._cookies) {
      const secret = this.getConfiguration().getCookieSecret()
      const headerValue = this._request.header("cookie")

      this._cookies = Cookie.parseHeader(headerValue, secret)
    }

    return this._cookies
  }

  /**
   * @private
   * @returns {typeof VelociousController} - The controller class.
   */
  _getControllerClass() {
    const controllerClass = /** @type {typeof VelociousController} */ (this.constructor)

    return controllerClass
  }

  async _runBeforeCallbacks() {
    await this.logger.debug("_runBeforeCallbacks")

    let currentControllerClass = this._getControllerClass()

    while (currentControllerClass) {
      await this.logger.debug(`Running callbacks for ${currentControllerClass.name}`)

      const beforeActions = currentControllerClass._beforeActions

      if (beforeActions) {
        for (const beforeActionName of beforeActions) {
          const beforeAction = currentControllerClass.prototype[beforeActionName]

          if (!beforeAction) throw new Error(`No such before action: ${beforeActionName}`)

          const boundBeforeAction = beforeAction.bind(this)

          await boundBeforeAction()
        }
      }

      currentControllerClass = Object.getPrototypeOf(currentControllerClass)

      if (!currentControllerClass?.name?.endsWith("Controller")) break
    }

    await this.logger.debug("After runBeforeCallbacks")
  }

  /** @returns {Record<string, any>} - The params.  */
  params() {
    // Merge query parameters so controllers can read them via params()
    const mergedParams = {...this.queryParameters(), ...this._params}

    if (!mergedParams.controller) mergedParams.controller = this._controller

    return mergedParams
  }

  /** @returns {Record<string, any>} - The query parameters.  */
  queryParameters() {
    const query = this._request.path().split("?")[1]

    if (!query) return {}

    /** @type {Record<string, any>} */
    const unparsedParams = querystring.parse(query)
    const paramsToObject = new ParamsToObject(unparsedParams)

    return paramsToObject.toObject()
  }

  /**
   * @param {object} [args] - Options object.
   * @param {object} [args.json] - Json.
   * @param {number | string} [args.status] - Status.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async render({json, status, ...restArgs} = {}) {
    restArgsError(restArgs)

    if (json) {
      return this.renderJsonArg(json)
    }

    if (status) {
      this._response.setStatus(status)
    }

    return await this.renderView()
  }

  /** @param {object} json - JSON payload. */
  renderJsonArg(json) {
    const body = JSON.stringify(json)

    this._response.setHeader("Content-Type", "application/json; charset=UTF-8")
    this._response.setBody(body)
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  renderView() {
    return new Promise((resolve, reject) => {
      const viewPath = `${this._viewPath}/${inflection.dasherize(inflection.underscore(this._action))}.ejs`
      const actualViewParams = incorporate({controller: this}, this.viewParams)

      ejs.renderFile(viewPath, actualViewParams, {}, (err, str) => {
        if (err) {
          if (err.code === "ENOENT") {
            this.logger.warn(`Missing view file: ${viewPath}`)

            if (this._response.getStatusCode() === 200) {
              this._response.setStatus("internal-server-error")
            }

            this._response.setHeader("Content-Type", "text/plain; charset=UTF-8")
            this._response.setBody(`Missing view file: ${viewPath}`)

            resolve(null)
          } else {
            reject(err)
          }
        } else {
          this._response.setHeader("Content-Type", "text/html; charset=UTF-8")
          this._response.setBody(str)

          resolve(null)
        }
      })
    })
  }

  /**
   * @returns {typeof import("./database/record/index.js").default} - Frontend model class for controller resource actions.
   */
  frontendModelClass() {
    const frontendModelClass = this.frontendModelClassFromConfiguration()

    if (frontendModelClass) return frontendModelClass

    throw new Error(`No frontend model configured for controller '${this.params().controller}'. Configure backendProjects resources or override frontendModelClass().`)
  }

  /**
   * @returns {{modelName: string, resourceConfiguration: import("./configuration-types.js").FrontendModelResourceConfiguration} | null} - Frontend model resource configuration for current controller.
   */
  frontendModelResourceConfiguration() {
    const params = this.params()
    const controllerName = typeof params.controller === "string" ? params.controller : undefined

    if (!controllerName || controllerName.length < 1) return null

    const backendProjects = this.getConfiguration().getBackendProjects()

    for (const backendProject of backendProjects) {
      const resources = backendProject.frontendModels || backendProject.resources || {}

      for (const modelName in resources) {
        const resourceConfiguration = resources[modelName]
        const resourcePath = this.frontendModelResourcePath(modelName, resourceConfiguration)

        if (this.frontendModelResourceMatchesController({controllerName, resourcePath})) {
          return {modelName, resourceConfiguration}
        }
      }
    }

    return null
  }

  /**
   * @returns {typeof import("./database/record/index.js").default | null} - Frontend model class resolved from backend project configuration.
   */
  frontendModelClassFromConfiguration() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    const modelClasses = this.getConfiguration().getModelClasses()
    const modelClass = modelClasses[frontendModelResource.modelName]

    if (!modelClass) {
      throw new Error(`Frontend model '${frontendModelResource.modelName}' is configured for '${this.params().controller}', but no model class was registered. Registered models: ${Object.keys(modelClasses).join(", ")}`)
    }

    return modelClass
  }

  /**
   * @param {string} modelName - Model class name.
   * @param {import("./configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Resource configuration.
   * @returns {string} - Normalized resource path.
   */
  frontendModelResourcePath(modelName, resourceConfiguration) {
    if (resourceConfiguration.path) return `/${resourceConfiguration.path.replace(/^\/+/, "")}`

    return `/${inflection.dasherize(inflection.pluralize(modelName))}`
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.controllerName - Controller name from params.
   * @param {string} args.resourcePath - Resource path from configuration.
   * @returns {boolean} - Whether resource path matches current controller.
   */
  frontendModelResourceMatchesController({controllerName, resourcePath}) {
    const normalizedController = controllerName.replace(/^\/+|\/+$/g, "")
    const normalizedResourcePath = resourcePath.replace(/^\/+|\/+$/g, "")

    if (normalizedResourcePath === normalizedController) return true

    return normalizedResourcePath.endsWith(`/${normalizedController}`)
  }

  /**
   * @returns {import("./configuration-types.js").FrontendModelResourceServerConfiguration | null} - Optional server behavior config for frontend model actions.
   */
  frontendModelServerConfiguration() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    return frontendModelResource.resourceConfiguration.server || null
  }

  /**
   * @param {"index" | "find" | "update" | "destroy"} action - Frontend action.
   * @returns {Promise<boolean>} - Whether action should continue.
   */
  async runFrontendModelBeforeAction(action) {
    const serverConfiguration = this.frontendModelServerConfiguration()

    if (!serverConfiguration?.beforeAction) return true

    const modelClass = this.frontendModelClass()
    const result = await serverConfiguration.beforeAction({
      action,
      controller: this,
      modelClass,
      params: this.params()
    })

    return result !== false
  }

  /**
   * @param {"find" | "update" | "destroy"} action - Frontend action.
   * @param {string | number} id - Record id.
   * @returns {Promise<import("./database/record/index.js").default | null>} - Located model record.
   */
  async frontendModelFindRecord(action, id) {
    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()

    if (serverConfiguration?.find) {
      return await serverConfiguration.find({
        action,
        controller: this,
        id,
        modelClass,
        params: this.params()
      })
    }

    return await modelClass.findBy({id})
  }

  /**
   * @returns {Promise<import("./database/record/index.js").default[]>} - Frontend model records.
   */
  async frontendModelRecords() {
    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()

    if (serverConfiguration?.records) {
      return await serverConfiguration.records({
        action: "index",
        controller: this,
        modelClass,
        params: this.params()
      })
    }

    return await modelClass.toArray()
  }

  /**
   * @param {import("./database/record/index.js").default} model - Frontend model record.
   * @returns {Record<string, any>} - Serialized frontend model payload.
   */
  serializeFrontendModel(model) {
    return model.attributes()
  }

  /**
   * @param {string} errorMessage - Error message.
   * @returns {Promise<void>} - Resolves when error has been rendered.
   */
  async frontendModelRenderError(errorMessage) {
    const renderError = /** @type {((errorMessage: string) => Promise<void>) | undefined} */ (
      /** @type {any} */ (this).renderError
    )

    if (typeof renderError === "function") {
      await renderError.call(this, errorMessage)
      return
    }

    await this.render({
      json: {
        errorMessage,
        status: "error"
      }
    })
  }

  /** @returns {Promise<void>} - Collection action for frontend model resources. */
  async frontendIndex() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("index"))) return

    const models = await this.frontendModelRecords()

    await this.render({
      json: {
        models: await Promise.all(models.map(async (model) => {
          const serverConfiguration = this.frontendModelServerConfiguration()

          if (serverConfiguration?.serialize) {
            return await serverConfiguration.serialize({
              action: "index",
              controller: this,
              model,
              modelClass: this.frontendModelClass(),
              params: this.params()
            })
          }

          return this.serializeFrontendModel(model)
        })),
        status: "success"
      }
    })
  }

  /** @returns {Promise<void>} - Member find action for frontend model resources. */
  async frontendFind() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("find"))) return

    const params = this.params()
    const id = params.id

    if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
      await this.frontendModelRenderError("Expected model id.")
      return
    }

    const modelClass = this.frontendModelClass()
    const model = await this.frontendModelFindRecord("find", id)

    if (!model) {
      await this.frontendModelRenderError(`${modelClass.name} not found.`)
      return
    }

    const serverConfiguration = this.frontendModelServerConfiguration()
    const serializedModel = serverConfiguration?.serialize
      ? await serverConfiguration.serialize({
        action: "find",
        controller: this,
        model,
        modelClass,
        params
      })
      : this.serializeFrontendModel(model)

    await this.render({
      json: {
        model: serializedModel,
        status: "success"
      }
    })
  }

  /** @returns {Promise<void>} - Member update action for frontend model resources. */
  async frontendUpdate() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("update"))) return

    const params = this.params()
    const id = params.id
    const attributes = params.attributes

    if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
      await this.frontendModelRenderError("Expected model id.")
      return
    }

    if (!attributes || typeof attributes !== "object") {
      await this.frontendModelRenderError("Expected model attributes.")
      return
    }

    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()
    const model = await this.frontendModelFindRecord("update", id)

    if (!model) {
      await this.frontendModelRenderError(`${modelClass.name} not found.`)
      return
    }

    let updatedModel = model

    if (serverConfiguration?.update) {
      const callbackModel = await serverConfiguration.update({
        action: "update",
        attributes,
        controller: this,
        model,
        modelClass,
        params
      })

      if (callbackModel) updatedModel = callbackModel
    } else {
      model.assign(attributes)
      await model.save()
    }

    const serializedModel = serverConfiguration?.serialize
      ? await serverConfiguration.serialize({
        action: "update",
        controller: this,
        model: updatedModel,
        modelClass,
        params
      })
      : this.serializeFrontendModel(updatedModel)

    await this.render({
      json: {
        model: serializedModel,
        status: "success"
      }
    })
  }

  /** @returns {Promise<void>} - Member destroy action for frontend model resources. */
  async frontendDestroy() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("destroy"))) return

    const params = this.params()
    const id = params.id

    if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
      await this.frontendModelRenderError("Expected model id.")
      return
    }

    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()
    const model = await this.frontendModelFindRecord("destroy", id)

    if (!model) {
      await this.frontendModelRenderError(`${modelClass.name} not found.`)
      return
    }

    if (serverConfiguration?.destroy) {
      await serverConfiguration.destroy({
        action: "destroy",
        controller: this,
        model,
        modelClass,
        params
      })
    } else {
      await model.destroy()
    }

    await this.render({
      json: {
        status: "success"
      }
    })
  }

  /** @returns {void} - No return value.  */
  renderText() {
    throw new Error("renderText stub")
  }

  /** @returns {import("./authorization/ability.js").default | undefined} - Current ability for request scope. */
  currentAbility() {
    return this.getConfiguration().getCurrentAbility()
  }

  /** @returns {import("./http-server/client/request.js").default} - The request.  */
  request() { return this._request }

  /** @returns {import("./http-server/client/response.js").default} - The response.  */
  response() { return this._response }
}
