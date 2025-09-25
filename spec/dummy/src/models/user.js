import Record from "../../../../src/database/record/index.js"
import UserModule from "../../../../src/database/record/user-module.js"

class User extends Record {
}

User.hasOne("createdProject", {className: "Project", foreignKey: "creating_user_reference", primaryKey: "reference"})

User.hasMany("authenticationTokens" , {dependent: "destroy"})
User.hasMany("createdProjects", {className: "Project", foreignKey: "creating_user_reference", primaryKey: "reference"})

const userModule = new UserModule({
  secretKey: "02e383b7-aad1-437c-b1e1-17c0240ad851"
})

userModule.attachTo(User)

export default User
