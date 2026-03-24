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
      attributes: ["id", "identifier", "isDone", "name", "updatedAt"],
      builtInCollectionCommands: {
        index: "list",
      },
      builtInMemberCommands: {
        destroy: "destroy",
        find: "find",
        update: "update"
      },
      relationships: {
        project: {
          model: "Project",
          type: "belongsTo"
        },
        comments: {
          model: "Comment",
          type: "hasMany"
        }
      },
      primaryKey: "id"
    }
  }
}

class ProjectFrontendResource extends FrontendModelBaseResource {
  static ModelClass = Project

  /** @returns {import("../../../../src/configuration-types.js").FrontendModelResourceConfiguration} */
  static resourceConfig() {
    return {
      abilities: {
        find: "read",
        index: "read"
      },
      attributes: ["id"],
      builtInCollectionCommands: ["index"],
      builtInMemberCommands: ["find"],
      relationships: {
        tasks: {
          model: "Task",
          type: "hasMany"
        }
      }
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
        lookupByEmail: "lookup-by-email"
      },
      memberCommands: {
        refreshProfile: "refresh-profile"
      }
    }
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
