// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import VelociousPackage from "../../src/packages/velocious-package.js"
import dummyPackage from "../dummy-package/velocious-package.js"
import {describe, expect, it} from "../../src/testing/test.js"

/** @returns {Configuration} */
function buildConfigurationWithPackage() {
  return new Configuration({
    backendProjects: [{frontendModelsOutputPath: "/tmp/app", path: "/tmp/app-backend"}],
    directory: "/tmp/nonexistent-velocious-app",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    packages: [dummyPackage]
  })
}

describe("VelociousPackage", () => {
  it("derives its directories from the descriptor url", () => {
    expect(dummyPackage.getName()).toEqual("dummy-package")
    expect(dummyPackage.getModelsPath().endsWith("/spec/dummy-package/src/models")).toEqual(true)
    expect(dummyPackage.getResourcesPath().endsWith("/spec/dummy-package/src/resources")).toEqual(true)
    expect(dummyPackage.getMigrationsPath().endsWith("/spec/dummy-package/src/database/migrations")).toEqual(true)
  })

  it("wraps a plain descriptor via from() and returns instances unchanged", () => {
    const wrapped = VelociousPackage.from({name: "plain", path: "/tmp/plain"})

    expect(wrapped.getModelsPath()).toEqual("/tmp/plain/src/models")
    expect(VelociousPackage.from(dummyPackage)).toBe(dummyPackage)
  })
})

describe("Configuration with packages", () => {
  it("exposes the registered packages", () => {
    expect(buildConfigurationWithPackage().getPackages()).toEqual([dummyPackage])
  })

  it("appends a derived backend project targeting the app frontend-models output", () => {
    const backendProjects = buildConfigurationWithPackage().getBackendProjects()

    expect(backendProjects.length).toEqual(2)
    expect(backendProjects[1].frontendModelsOutputPath).toEqual("/tmp/app")
    expect(backendProjects[1].path.endsWith("/spec/dummy-package")).toEqual(true)
  })

  it("includes the package's migrations in findMigrations with their real absolute paths", async () => {
    const migrations = await buildConfigurationWithPackage().getEnvironmentHandler().findMigrations()
    const joblerMigration = migrations.find((migration) => migration.file === "20230728075330-create-jobler-jobs.js")

    if (!joblerMigration) {
      throw new Error("Expected the package migration to be discovered.")
    }

    expect(joblerMigration.fullPath?.endsWith("/spec/dummy-package/src/database/migrations/20230728075330-create-jobler-jobs.js")).toEqual(true)
    expect(joblerMigration.date).toEqual(20230728075330)
  })

  it("merges discovered package resources into the ability resources", () => {
    const configuration = buildConfigurationWithPackage()
    class JoblerJobResource {}
    const packageBackendProject = configuration.getBackendProjects().find((backendProject) => backendProject.path.endsWith("/spec/dummy-package"))

    if (!packageBackendProject) {
      throw new Error("Expected the derived package backend project.")
    }

    // Stand in for autoDiscoverResources having populated the package's resources.
    packageBackendProject.frontendModels = {JoblerJob: JoblerJobResource}
    configuration._mergeDiscoveredAbilityResources()

    expect(configuration.getAbilityResources().includes(JoblerJobResource)).toEqual(true)
  })

  it("leaves a configuration without packages unchanged", () => {
    const configuration = new Configuration({
      backendProjects: [{path: "/tmp/app-backend"}],
      directory: "/tmp/app",
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode()
    })

    expect(configuration.getPackages()).toEqual([])
    expect(configuration.getBackendProjects().length).toEqual(1)
  })
})
