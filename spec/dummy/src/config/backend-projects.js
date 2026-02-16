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
        path: "/api/frontend-models/tasks",
        primaryKey: "id"
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
      }
    }
  }
]

export default backendProjects
