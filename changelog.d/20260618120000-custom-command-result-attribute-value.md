Type custom command results as `Record<string, FrontendModelAttributeValue>`.
`executeCustomCommand` now declares and returns the accurate transport-value
record (matching the generated custom-command method declarations) instead of
`Record<string, ?>`. A command result is a deserialized transport payload, so its
values are always `FrontendModelAttributeValue`; the previous `?` return made the
generated custom-command methods fail to typecheck because `Record<string, unknown>`
is not assignable to the declared `Record<string, FrontendModelAttributeValue>`.
