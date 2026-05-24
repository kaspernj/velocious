# Mailers

Velocious mailers render EJS templates from `src/mailers/<mailer-name>/<action>.ejs`. Mailer actions should assign template data, then return `this.mail(...)` with an explicit `actionName`.

```js
import VelociousMailer from "velocious/build/src/mailer.js"

export default class TasksMailer extends VelociousMailer {
  newNotification(task, user) {
    this.assignView({task, user})

    return this.mail({
      to: user.email(),
      subject: "New task",
      actionName: "newNotification"
    })
  }
}
```

Delivery wrappers support three flows:

```js
const delivery = new TasksMailer().newNotification(task, user)

await delivery.deliverNow()
await delivery.deliverLater()
const payload = await delivery.buildPayload()
```

Use `deliverNow()` for immediate transport delivery and `deliverLater()` for background-job delivery. Use `buildPayload()` when the application needs the rendered `{to, subject, html, mailer, action}` payload without sending, such as storing an audit snapshot before passing the HTML to a custom queue or transport.

If an action needs async setup, keep the action method synchronous and pass the pending work as `actionPromise`. Velocious awaits that promise before `deliverNow()`, `deliverLater()`, or `buildPayload()` renders the template.
