/** Backend projects used for frontend-model generation specs. */
const backendProjects = [
  {
    path: "/tmp/example-backend",
    resources: {
      Task: {
        attributes: ["id", "identifier", "name"],
        commands: {
          destroy: "destroy",
          find: "find",
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
        path: "/api/frontend-models/users"
      }
    }
  }
]

export default backendProjects
