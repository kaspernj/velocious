import Ability from "../src/authorization/ability.js"
import Current from "../src/current.js"
import dummyConfiguration from "./dummy/src/config/configuration.js"

describe("Current", () => {
  beforeEach(() => {
    dummyConfiguration.setCurrent()
    Current.setAbility(undefined)
  })

  afterEach(() => {
    Current.setAbility(undefined)
  })

  it("reads and writes current ability", () => {
    const ability = new Ability({resources: []})

    expect(Current.ability()).toBeUndefined()
    Current.setAbility(ability)
    expect(Current.ability()).toBe(ability)
  })

  it("scopes ability per async context", async () => {
    const ability = new Ability({resources: []})

    await Current.withAbility(ability, async () => {
      expect(Current.ability()).toBe(ability)
    })

    expect(Current.ability()).toBeUndefined()
  })
})
