# Trusted Proxies

Velocious can resolve `request.remoteAddress()` from `X-Forwarded-For` when an
application runs behind a trusted reverse proxy.

Configure `trustedProxies` with the socket addresses or CIDR ranges for the
proxies that are allowed to supply forwarding headers:

```js
const configuration = new Configuration({
  // ...
  trustedProxies: ["42.0.0.4"]
})
```

When the incoming socket peer is trusted, Velocious resolves the first
untrusted address from the forwarded chain. When no trusted proxies are
configured, or the socket peer is not trusted, `request.remoteAddress()` remains
the socket peer address.

Do not list public client addresses in `trustedProxies`. List only reverse
proxies you control. Security decisions such as partner allowlists should still
compare against the resolved `request.remoteAddress()`.
