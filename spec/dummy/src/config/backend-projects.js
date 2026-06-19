import wait from "awaitery/build/wait.js"
import FrontendModelBaseResource from "../../../../src/frontend-model-resource/base-resource.js"
import Comment from "../models/comment.js"
import Interaction from "../models/interaction.js"
import Project from "../models/project.js"
import Task from "../models/task.js"
import User from "../models/user.js"

class TaskFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Task

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: ["read", "create", "update", "destroy"],
      attributes: ["id", "identifier", "isDone", "name", "nameUppercase", "asyncNameUppercase", "downloadToken", {name: "projectId", selectedByDefault: false}, {name: "createdAt", selectedByDefault: false}, "updatedAt"],
      attachments: {
        descriptionFile: {type: "hasOne"},
        files: {type: "hasMany"}
      },
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find", "update", "destroy"],
      relationships: ["project", "comments"],
      primaryKey: "id"
    }
  }

  /**
   * Virtual attribute: returns the task name in uppercase.
   *
   * @param {import("../models/task.js").default} model - Task model instance.
   * @returns {string | null}
   */
  nameUppercaseAttribute(model) {
    const name = model.readAttribute("name")

    return typeof name === "string" ? name.toUpperCase() : null
  }

  /**
   * Virtual attribute resolved asynchronously before frontend serialization.
   *
   * @param {import("../models/task.js").default} model - Task model instance.
   * @returns {Promise<string | null>}
   */
  async asyncNameUppercaseAttribute(model) {
    return this.nameUppercaseAttribute(model)
  }

  /**
   * Write-only task download token.
   * @param {import("../models/task.js").default} model - Task model instance.
   * @returns {null} Hidden read value.
   */
  downloadTokenAttribute(model) {
    void model
    return null
  }

  /**
   * Assigns a write-only task download token.
   * @param {import("../models/task.js").default} model - Task model instance.
   * @param {string} value - New download token.
   * @returns {void}
   */
  setDownloadTokenAttribute(model, value) {
    void model
    void value
  }

  /** @returns {Array<string | Record<string, ?>>} - Permit spec for Task writes. */
  permittedParams() {
    return [
      "name",
      "isDone",
      "downloadToken",
      "descriptionFile",
      {commentsAttributes: ["id", "_destroy", "body"]},
      {projectAttributes: ["name"]}
    ]
  }
}

class ProjectFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Project
  static translatedAttributes = ["name"]

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: ["read", "create", "update"],
      attributes: ["id", {name: "name", selectedByDefault: false}],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      relationships: ["creatingUser", "interactions", "tasks"]
    }
  }

  /** @returns {Array<string | Record<string, ?>>} - Permit spec for Project writes (name is translated). */
  permittedParams() {
    return [
      "name",
      {interactionsAttributes: ["id", "_destroy", "kind"]},
      {tasksAttributes: ["id", "_destroy", "name", "isDone", "descriptionFile", {commentsAttributes: ["id", "_destroy", "body"]}]}
    ]
  }
}

class InteractionFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Interaction

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: ["read", "create", "update", "destroy"],
      attributes: ["id", "kind", "subjectId", "subjectType"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find", "update", "destroy"]
    }
  }

  /** @returns {Array<string>} - Permit spec for Interaction writes. */
  permittedParams() {
    return ["kind"]
  }
}

class UserFrontendResource extends FrontendModelBaseResource {
  static ModelClass = User

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: ["read"],
      attributes: ["id", "email", "name", {name: "reference", selectedByDefault: false}, "createdAt"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      collectionCommands: [
        "currentSessionCookie",
        "setSessionCookie",
        "lookupByEmail",
        "delayedLookupByEmail",
        "echoMessage",
        "echoObjectStyle",
        "multiLineReturn",
        {name: "echoOverride", returnType: "{fromConfig: boolean}"}
      ],
      memberCommands: ["refreshProfile", "echoMemberPayload"]
    }
  }

  /**
   * Returns the client's own `id` argument to prove the member route id does not
   * overwrite the typed args payload passed to the command method.
   * @param {{id: string}} args - Member echo arguments.
   * @returns {Promise<{receivedId: string}>} - Echo response.
   */
  async echoMemberPayload(args) {
    return {receivedId: args.id}
  }

  /**
   * Echoes the typed args object back so the generator can derive the command's
   * `@param`/`@returns` types and the runner's args forwarding can be exercised.
   * @param {{message: string, times: number}} args - Echo arguments.
   * @returns {Promise<{echoed: string, length: number}>} - Echo response.
   */
  async echoMessage(args) {
    return {echoed: args.message, length: args.times}
  }

  /**
   * Documents its payload with the `@param {object}` + property-tag style so the
   * generator emits a single `args` parameter instead of `args, args`.
   * @param {object} args - Object-style arguments.
   * @param {string} args.label - Label argument.
   * @returns {Promise<{labeled: string}>} - Echo response.
   */
  async echoObjectStyle(args) {
    return {labeled: /** @type {{label: string}} */ (args).label}
  }

  /** @returns {Promise<{fromJsDoc: boolean}>} - JSDoc response the explicit resourceConfig returnType overrides. */
  async echoOverride() {
    return {fromJsDoc: true}
  }

  /**
   * Has a multiline `@returns` so the generator must collapse it into a single line
   * before emitting the inline cast (a multiline cast makes TypeScript read `undefined`).
   * @returns {Promise<{
   *   first: string,
   *   second: number
   * }>} - Multiline response.
   */
  async multiLineReturn() {
    return {first: "x", second: 1}
  }

  /** @returns {Promise<{success: true}>} */
  async setSessionCookie() {
    this.controllerInstance().setCookie("frontend_model_session", "frontend-model-shared-cookie", {
      httpOnly: true,
      path: "/",
      sameSite: "Lax"
    })

    return {success: true}
  }

  /** @returns {{value: string | null}} */
  currentSessionCookie() {
    const cookie = this.controllerInstance().getCookies().find((entry) => entry.name() === "frontend_model_session")

    return {value: cookie ? cookie.value() : null}
  }

  /** @returns {Promise<{users: import("../models/user.js").default[]}>} */
  async lookupByEmail() {
    const email = this.params().email
    let query = this.authorizedQuery("index")

    if (typeof email === "string" && email.length > 0) {
      query = query.where({email})
    }

    return {users: await query.toArray()}
  }

  /** @returns {Promise<{users: import("../models/user.js").default[]}>} */
  async delayedLookupByEmail() {
    await wait(100)

    return await this.lookupByEmail()
  }

  /**
   * User display name exposed by the dummy frontend model.
   * @param {import("../models/user.js").default} model - User model.
   * @returns {string | null}
   */
  nameAttribute(model) {
    return model.email()
  }

  /** @returns {Promise<{user: import("../models/user.js").default | null}>} */
  async refreshProfile() {
    const id = this.params().id

    if (typeof id !== "string" && typeof id !== "number") {
      return {user: null}
    }

    return {user: await this.find("find", id)}
  }
}

class SystemTestCommentFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Comment

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: ["read", "create", "update", "destroy"],
      attributes: ["id", "body"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"]
    }
  }

  /** @returns {Array<string>} - Permit spec for Comment writes. */
  permittedParams() {
    return ["body"]
  }
}

/** Backend projects used for frontend-model generation specs. */
const backendProjects = [
  {
    path: "/tmp/example-backend",
    frontendModels: {
      Comment: SystemTestCommentFrontendResource,
      Interaction: InteractionFrontendResource,
      Project: ProjectFrontendResource,
      Task: TaskFrontendResource,
      User: UserFrontendResource
    }
  }
]

export default backendProjects
