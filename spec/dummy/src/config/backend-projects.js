import FrontendModelBaseResource from "../../../../src/frontend-model-resource/base-resource.js"
import Comment from "../models/comment.js"
import Project from "../models/project.js"
import Task from "../models/task.js"
import User from "../models/user.js"

class TaskFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Task

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        create: "create",
        destroy: "destroy",
        find: "read",
        index: "read",
        update: "update"
      },
      attributes: ["id", "identifier", "isDone", "name", "nameUppercase", "updatedAt"],
      builtInCollectionCommands: {
        index: "list",
      },
      builtInMemberCommands: {
        destroy: "destroy",
        find: "find",
        update: "update"
      },
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
}

class ProjectFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Project
  static translatedAttributes = ["name"]

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        create: "create",
        find: "read",
        index: "read",
        update: "update"
      },
      attributes: ["id", {name: "name", selectedByDefault: false}],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      relationships: ["creatingUser", "tasks"]
    }
  }
}

class UserFrontendResource extends FrontendModelBaseResource {
  static ModelClass = User

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "email", "name", "createdAt"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      collectionCommands: {
        currentSessionCookie: "current-session-cookie",
        setSessionCookie: "set-session-cookie",
        lookupByEmail: "lookup-by-email"
      },
      memberCommands: {
        refreshProfile: "refresh-profile"
      }
    }
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
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "body"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"]
    }
  }
}

/** Backend projects used for frontend-model generation specs. */
const backendProjects = [
  {
    path: "/tmp/example-backend",
    frontendModels: {
      Comment: SystemTestCommentFrontendResource,
      Project: ProjectFrontendResource,
      Task: TaskFrontendResource,
      User: UserFrontendResource
    }
  }
]

export default backendProjects
