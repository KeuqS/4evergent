# API server troubleshooting

This page documents observable startup and configuration behaviour in the
current API server. The source links include line references so that future
changes to an error message or its handling can update this page at the same
time. Unless noted otherwise, commands are run from the repository root after
`pnpm build`.

Every startup failure described here exits with status `1`. Capture the
process output as well as the exit status: the error is written to stderr, so
it can be easy to miss when a container or process manager only reports that
the process stopped.

## Startup failures

### Invalid `API_KEYS` format

Source: [`apps/api/src/server.ts#L46-L47`](../apps/api/src/server.ts#L46-L47)

Exact message:

```text
FATAL: Invalid API_KEYS format. Expected key:ownerId[:subject], got: <entry>
```

This means an `API_KEYS` entry does not contain at least a key and an owner ID.
Entries are comma-separated, and each entry is `key:ownerId[:subject]`.
For example:

```text
API_KEYS=local-secret:operator:local-cli,another-secret:automation
```

Use a server-side secret for each key. Do not put real keys in source files,
images, logs, or documentation. See the [API authentication
model](security-model.md#api-authentication).

### API key or owner ID is empty

Source: [`apps/api/src/server.ts#L49-L52`](../apps/api/src/server.ts#L49-L52)

Exact message:

```text
FATAL: API key and ownerId are required. Got: <entry>
```

The entry has the right separator but an empty key or owner ID, such as
`:operator` or `local-secret:`. Replace it with a non-empty
`key:ownerId[:subject]` entry. An omitted optional subject is valid; the server
generates one from the first eight characters of the key.

### Mainnet Horizon URL

Source: [`apps/api/src/server.ts#L103-L114`](../apps/api/src/server.ts#L103-L114)

Exact message:

```text
FATAL: STELLAR_HORIZON_URL must point to Testnet (got: <url>). Mainnet execution is not supported.
```

4evergent is Testnet-first and deliberately refuses a Horizon URL that does
not contain `testnet`. Set:

```text
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

The network guard is intentional; see [Testnet setup](testnet.md) and the
[security model](security-model.md#key-management).

### Missing or invalid Testnet signing key

Source: [`apps/api/src/server.ts#L117-L123`](../apps/api/src/server.ts#L117-L123)
and [`packages/stellar/src/testnet-local-signer.ts#L38-L48`](../packages/stellar/src/testnet-local-signer.ts#L38-L48)

The signer initialization is wrapped by a dynamic `FATAL` handler. For a
missing key, the current message is:

```text
FATAL: TestnetLocalSigner: environment variable STELLAR_TESTNET_SECRET_KEY is not set. Set it in your local .env (never commit it).
```

Set `STELLAR_TESTNET_SECRET_KEY` to a valid Testnet secret in the runtime
environment or a local, uncommitted `.env` file. Never paste the value into a
ticket, pull request, container image, or log. An invalid secret produces the
same `FATAL: <underlying error>` form with the key parsing error.

### Public bind without authentication

Source: [`apps/api/src/server.ts#L78-L100`](../apps/api/src/server.ts#L78-L100)
and [`apps/api/src/server.ts#L127-L136`](../apps/api/src/server.ts#L127-L136)

Exact message:

```text
FATAL: refusing to start: bind host '<host>' is not loopback and API_KEYS is unset. Set API_KEYS for production authentication, bind to 127.0.0.1, or explicitly set ALLOW_DEV_AUTH=1.
```

The decision is deliberately fail-closed:

| Bind and configuration | Result |
| --- | --- |
| `API_KEYS` is set | Production API-key authentication, regardless of bind address |
| Loopback host (`127.0.0.1`, `localhost`, `::1`) and no keys | Development authentication for local work |
| Non-loopback host, no keys, `ALLOW_DEV_AUTH=1` | Development authentication with an explicit opt-in |
| Non-loopback host, no keys, no opt-in | Startup is refused |

For a real deployment, configure `API_KEYS`. `ALLOW_DEV_AUTH=1` is only an
explicit development escape hatch and must not be used to expose an
unauthenticated service.

### The server exits after another startup error

Source: [`apps/api/src/server.ts#L183-L206`](../apps/api/src/server.ts#L183-L206)

The server catches failures while creating or listening on the API and prints
the underlying error in this form:

```text
FATAL: <underlying error message>
```

Common causes include a port already being used, an inaccessible
`DATABASE_PATH`, an invalid web origin, or a failure while creating the API
modules. Read the complete preceding environment and stack-free error output,
then correct the relevant setting. The process exits with status `1` via
`process.exit(1)`.

For a container, inspect the logs and exit status with:

```bash
docker logs --tail=100 <container>
docker inspect --format='{{.State.ExitCode}}' <container>
```

For a systemd-managed service, use:

```bash
journalctl -u 4evergent-api -n 100 --no-pager
systemctl show 4evergent-api --property=ExecMainStatus
```

## Reproduced startup output

The following examples were run against the current local build. The two
cases that need `STELLAR_TESTNET_SECRET_KEY` used a freshly generated valid
Stellar secret only to pass signer construction; no funded account or live
transaction was used.

### Testnet guard

```text
$ STELLAR_HORIZON_URL=https://horizon.stellar.org node apps/api/dist/server.js
FATAL: STELLAR_HORIZON_URL must point to Testnet (got: https://horizon.stellar.org). Mainnet execution is not supported.
$ echo $?
1
```

### Malformed API key entry

```text
$ STELLAR_TESTNET_SECRET_KEY=<valid-testnet-secret> API_KEYS=not-a-valid-entry node apps/api/dist/server.js
FATAL: Invalid API_KEYS format. Expected key:ownerId[:subject], got: not-a-valid-entry
$ echo $?
1
```

### Public bind without API keys

```text
$ STELLAR_TESTNET_SECRET_KEY=<valid-testnet-secret> HOST=0.0.0.0 node apps/api/dist/server.js
FATAL: refusing to start: bind host '0.0.0.0' is not loopback and API_KEYS is unset. Set API_KEYS for production authentication, bind to 127.0.0.1, or explicitly set ALLOW_DEV_AUTH=1.
$ echo $?
1
```

## Configuration symptoms that do not print a server `FATAL`

### The API is unreachable from a container

The default bind address is `127.0.0.1`, which is loopback inside the
container. Set `HOST=0.0.0.0` so traffic can reach the process through the
container network. When using a non-loopback bind, also configure `API_KEYS` so
the fail-closed authentication check allows startup. See the [API runtime
requirements](api.md#runtime-requirements).

### A fresh checkout fails typecheck with `TS2307`

Workspace packages publish their TypeScript entry points from `dist/`, so a
fresh checkout must be built before typecheck:

```bash
pnpm build
pnpm typecheck
```

Keep the full setup note and CI ordering in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#development-setup); this page only
points to the failure symptom.

### The deployed dashboard calls the visitor's localhost

`apps/web/src/api.ts` falls back to `http://localhost:3000` when
`VITE_API_BASE` is unset or empty. In a deployed browser, that means requests
go to the visitor's own machine rather than the API host. Set `VITE_API_BASE`
to the public API origin at frontend build time, and configure the matching
`CORS_ORIGIN` on the API. The [frontend integration notes](api.md#frontend-integration)
describe the two settings together.
