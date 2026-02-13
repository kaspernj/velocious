import Ability from "../../src/authorization/ability.js"
import BaseResource from "../../src/authorization/base-resource.js"
import User from "../dummy/src/models/user.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/**
 * @param {string} email - Email.
 * @param {string} reference - Reference.
 * @returns {Promise<User>} - Created user.
 */
async function createUser(email, reference) {
  return /** @type {User} */ (await User.create({
    email,
    encryptedPassword: "encrypted-test-password",
    reference
  }))
}

describe("Authorization - ability", {tags: ["dummy"]}, () => {
  it("filters records by resource-defined hash conditions", async () => {
    const allowedUser = await createUser("allowed@example.com", "allowed")
    const blockedUser = await createUser("blocked@example.com", "blocked")

    class UserResource extends BaseResource {
      static ModelClass = User

      abilities() {
        const currentUser = this.currentUser()

        if (currentUser) {
          this.can("read", User, {id: currentUser.id()})
        }
      }
    }

    const ability = new Ability({
      context: {currentUser: allowedUser},
      resources: [UserResource]
    })

    const foundUsers = await User.accessible(ability).order("id").toArray()

    expect(foundUsers.map((user) => user.id())).toEqual([allowedUser.id()])
    expect(foundUsers.map((user) => user.id()).includes(blockedUser.id())).toEqual(false)
  })

  it("applies deny rules on top of allowed records", async () => {
    const userOne = await createUser("one@example.com", "one")
    const userTwo = await createUser("two@example.com", "two")

    class UserResource extends BaseResource {
      static ModelClass = User

      abilities() {
        this.can("read", User)
        this.cannot("read", User, {id: userTwo.id()})
      }
    }

    const ability = new Ability({resources: [UserResource]})
    const foundUsers = await User.accessible(ability).where({id: [userOne.id(), userTwo.id()]}).order("id").toArray()

    expect(foundUsers.map((user) => user.id())).toEqual([userOne.id()])
  })

  it("uses ability from configuration context when available", async () => {
    const userOne = await createUser("ctx-one@example.com", "ctx-one")
    const userTwo = await createUser("ctx-two@example.com", "ctx-two")

    class UserResource extends BaseResource {
      static ModelClass = User

      abilities() {
        this.can("read", User, {id: userOne.id()})
      }
    }

    const previousResolver = dummyConfiguration.getAbilityResolver()
    const previousResources = dummyConfiguration.getAbilityResources()

    try {
      dummyConfiguration.setAbilityResolver(undefined)
      dummyConfiguration.setAbilityResources([UserResource])

      await dummyConfiguration.runWithAbility(await dummyConfiguration.resolveAbility({
        params: {},
        request: /** @type {any} */ ({header: () => undefined}),
        response: /** @type {any} */ ({})
      }), async () => {
        const foundUsers = await User.accessible().where({id: [userOne.id(), userTwo.id()]}).order("id").toArray()

        expect(foundUsers.map((user) => user.id())).toEqual([userOne.id()])
      })
    } finally {
      dummyConfiguration.setAbilityResolver(previousResolver)
      dummyConfiguration.setAbilityResources(previousResources)
      dummyConfiguration.getEnvironmentHandler().setCurrentAbility(undefined)
    }
  })

  it("uses custom ability resolver when configured", async () => {
    const userOne = await createUser("resolver-one@example.com", "resolver-one")
    const userTwo = await createUser("resolver-two@example.com", "resolver-two")
    const previousResolver = dummyConfiguration.getAbilityResolver()

    class ResolverUserResource extends BaseResource {
      static ModelClass = User

      abilities() {
        const params = this.params()

        if (params && params.userId) {
          this.can("read", User, {id: parseInt(`${params.userId}`, 10)})
        }
      }
    }

    try {
      dummyConfiguration.setAbilityResolver(({configuration, params, request, response}) => {
        return new Ability({
          context: {configuration, params, request, response},
          resources: [ResolverUserResource]
        })
      })

      await dummyConfiguration.runWithAbility(await dummyConfiguration.resolveAbility({
        params: {userId: userTwo.id()},
        request: /** @type {any} */ ({header: () => undefined}),
        response: /** @type {any} */ ({})
      }), async () => {
        const foundUsers = await User.accessible().where({id: [userOne.id(), userTwo.id()]}).order("id").toArray()

        expect(foundUsers.map((user) => user.id())).toEqual([userTwo.id()])
      })
    } finally {
      dummyConfiguration.setAbilityResolver(previousResolver)
      dummyConfiguration.getEnvironmentHandler().setCurrentAbility(undefined)
    }
  })

  it("raises an error when no ability is available", async () => {
    dummyConfiguration.getEnvironmentHandler().setCurrentAbility(undefined)

    await expect(async () => {
      await User.accessible().toArray()
    }).toThrow(/No ability in context/)
  })
})
