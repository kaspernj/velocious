/** Backend projects used for frontend-model generation specs. */
const backendProjects = [
  {
    path: "/tmp/example-backend",
    resources: {
      Task: {
        attributes: ["id", "identifier", "name"],
        abilities: {
          create: "create",
          destroy: "destroy",
          find: "read",
          index: "read",
          update: "update"
        },
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
      },
      Project: {
        attributes: ["id", "name"],
        abilities: {
          find: "read",
          index: "read"
        },
        relationships: {
          tasks: {
            model: "Task",
            type: "hasMany"
          }
        },
        path: "/api/frontend-models/projects"
      },
      User: {
        attributes: {
          email: true,
          id: true,
          name: true
        },
        abilities: {
          find: "read",
          index: "read"
        },
        path: "/api/frontend-models/users"
      },
      BrowserFrontendModel: {
        attributes: ["id", "email", "createdAt"],
        abilities: {
          find: "read",
          index: "read"
        },
        commands: {
          find: "frontend-find",
          index: "frontend-index"
        },
        path: "/frontend-model-system-tests"
      }
    }
  }
]

export default backendProjects
