import AccountBase from "../model-bases/account.js"

class Account extends AccountBase {
}

if (process.env.VELOCIOUS_DISABLE_MSSQL !== "1") {
  Account.setDatabaseIdentifier("mssql")
}

export default Account
