# Mailers

Velocious mailers render EJS templates from `src/mailers/<mailer-name>/<action>.ejs`. The mailer directory and action filename are normalized with underscore + dasherize, so `TasksMailer#newNotification` renders `src/mailers/tasks/new-notification.ejs`. Mailer actions should assign template data, then return `this.mail(...)`. When `this.mail(...)` is called from a mailer action method, Velocious infers the action name from that method.

```js
import VelociousMailer from "velocious/build/src/mailer.js"

export default class TasksMailer extends VelociousMailer {
  newNotification(task, user) {
    this.assignView({task, user})

    return this.mail({
      to: user.email(),
      subject: "New task"
    })
  }
}
```

Pass `actionName` explicitly when one method should render another action's template, or when the `this.mail(...)` call happens somewhere Velocious cannot infer the intended public action from the call stack.

```js
return this.mail({
  to: user.email(),
  subject: "Task summary",
  actionName: "newNotification"
})
```

Delivery wrappers support three flows:

```js
const delivery = new TasksMailer().newNotification(task, user)

await delivery.deliverNow()
await delivery.deliverLater()
const payload = await delivery.buildPayload()
```

Use `deliverNow()` for immediate transport delivery and `deliverLater()` for background-job delivery. Use `buildPayload()` when the application needs the rendered `{to, subject, html, mailer, action}` payload without sending, such as storing an audit snapshot before passing the HTML to a custom queue or transport.

## Provider-backed idempotent background delivery

When a provider explicitly supports duplicate suppression, pass a stable producer-owned operation id to `deliverLater()`:

```js
const jobId = await new TasksMailer()
  .newNotification(task, user)
  .deliverLater({
    deliveryOperation: {
      id: `project-command:${command.id()}`,
      idempotency: "required"
    }
  })
```

The id must identify exactly one rendered email and survive producer replay, enqueue persistence, worker retries, and worker crashes. Do not derive it from the randomly generated background-job id. The first enqueue atomically persists the native `MailDeliveryJob`, durable enqueue ownership, and mail-operation state. Exact producer replay returns the original native job id, including after its terminal job row is pruned.

Velocious stores a versioned SHA-256 digest over the operation id and every rendered provider-relevant payload field: recipients (`to`, `cc`, `bcc`), sender, reply-to, subject, HTML, custom headers, and the mailer/action identity. Reusing the same operation id with changed content fails before network I/O. The persisted operation metadata is immutable and is revalidated before every attempt.

Required delivery also revalidates the configured backend's provider kind and retention before every attempt. A backend without an explicit capability fails before durable enqueue and before network I/O. Generic `SmtpMailerBackend` deliberately has no such capability: SMTP acceptance alone cannot provide provider-backed duplicate suppression, so generic SMTP remains at-least-once.

### Resend SMTP

Use the dedicated backend for Resend's SMTP idempotency contract:

```js
import {ResendSmtpMailerBackend} from "velocious/build/src/mailer.js"

export default new Configuration({
  mailerBackend: new ResendSmtpMailerBackend({
    connectionOptions: {
      host: "smtp.resend.com",
      port: 587,
      secure: false,
      auth: {user: "resend", pass: process.env.RESEND_API_KEY}
    },
    defaultFrom: "no-reply@example.com"
  })
})
```

`ResendSmtpMailerBackend` advertises provider kind `resend-smtp` with a 24-hour retention window and injects the stable operation id as `Resend-Idempotency-Key`. Keys must contain 1–256 characters and cannot contain SMTP header control characters. Caller-supplied versions of that reserved header are rejected case-insensitively. Resend documents that identical requests with the same key are suppressed for 24 hours and changed-payload reuse is rejected; see [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) and [Resend SMTP](https://resend.com/docs/send-with-smtp).

The retention clock starts when Velocious durably marks the first provider attempt immediately before network I/O; time spent waiting in the queue does not consume the window. At or after `firstAttemptStartedAt + 24 hours`, Velocious raises the safe `mail-delivery-idempotency-expired` error without opening a network connection. It never rotates the key or silently downgrades required delivery. Operators must reconcile the ambiguous operation with provider records before deciding what to do next. A changed or removed backend similarly fails closed.

The exported `deliverPayload()` helper can execute required delivery directly when no transaction is active on the background-jobs database connection. Calling it from an existing caller-owned transaction raises the safe `mail-delivery-idempotency-transaction-active` error before provider I/O: a nested savepoint could otherwise let an outer rollback erase the durable first-attempt marker after provider acceptance. Enqueue outside the caller transaction or invoke direct delivery only after that transaction commits. Native `MailDeliveryJob` inline, pooled, forked, and spawned attempts establish their own nontransactional execution scope before marking the provider attempt.

This is a provider-backed suppression guarantee within the provider's retention window, not a claim that SMTP or mail delivery is universally exactly-once. The durable enqueue keys and mail-operation rows are intentionally not pruned in this initial release; a future deletion policy requires explicit reconciliation. Mail without `deliveryOperation` keeps the existing at-least-once behavior and default retry policy.

If an action needs async setup, keep the action method synchronous and pass the pending work as `actionPromise`. Velocious awaits that promise before `deliverNow()`, `deliverLater()`, or `buildPayload()` renders the template.
