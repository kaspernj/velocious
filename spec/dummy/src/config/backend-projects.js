import FrontendModelBaseResource from "../../../../src/frontend-model-resource/base-resource.js"

class TaskFrontendResource extends FrontendModelBaseResource {
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
      attributes: ["id", "identifier", "isDone", "name"],
      commands: {
        destroy: "destroy",
        find: "find",
        index: "list",
        update: "update"
      },
      relationships: {
        project: {
          model: "Project",
          type: "belongsTo"
        }
      },
      path: "/api/frontend-models/tasks",
      primaryKey: "id"
    }
  }
}

class ProjectFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "name"],
      relationships: {
        tasks: {
          model: "Task",
          type: "hasMany"
        }
      },
      path: "/api/frontend-models/projects"
    }
  }
}

class UserFrontendResource extends FrontendModelBaseResource {
  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: {
        email: true,
        id: true,
        name: true
      },
      path: "/api/frontend-models/users"
    }
  }
}

class BrowserFrontendModelResource extends FrontendModelBaseResource {
  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id", "email", "createdAt"],
      commands: {
        find: "frontend-find",
        index: "frontend-index"
      },
      path: "/frontend-model-system-tests"
    }
  }
}

/** Backend projects used for frontend-model generation specs. */
const backendProjects = [
  {
    path: "/tmp/example-backend",
    resources: {
      BrowserFrontendModel: BrowserFrontendModelResource,
      Project: ProjectFrontendResource,
      Task: TaskFrontendResource,
      User: UserFrontendResource
    }
  }
]

export default backendProjects
