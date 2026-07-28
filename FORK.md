# Fork-specific changes

This repository is a long-lived fork of
[`0xcaff/codex-web`](https://github.com/0xcaff/codex-web). The goal is to keep
merging useful upstream changes while deliberately preserving the fork-level
decisions documented here.

Future contributors and coding agents should read this file before changing
the server runtime, dependency management, startup flow, authentication, or
route handling. Update it whenever another intentional divergence from
upstream is introduced.

## Summary

This fork has two major differences from upstream:

1. The server and package workflow were migrated from Node.js and Fastify to
   Bun and Hono.
2. Hosted access is protected by the central passkey service at
   `auth.anuragroy.dev`.

These are intentional architectural choices. An upstream merge should adapt
upstream changes to them rather than restore the old runtime or expose new
routes without authentication.

## 1. Bun and Hono migration

### Runtime and dependency management

- Bun is the supported runtime and package manager. `package.json` declares the
  Bun version and `bun.lock` is the lockfile.
- Use `bun install` and `bun run <script>`. Do not restore `package-lock.json`
  or make npm/Node.js the primary workflow.
- The server entry point remains the generated `src/server/main.js`, but it is
  executed with Bun.
- The existing Nix files predate this migration and are not the source of truth
  for the Bun runtime.

Common commands are:

```bash
bun install
bun run build
bun run test
bun run server
bun run server:local
```

### HTTP and WebSocket server

`src/server/main.ts` uses:

- `Hono` for routing and middleware;
- `serveStatic` from `hono/bun` for static files;
- `upgradeWebSocket` for the IPC WebSocket bridge; and
- `Bun.serve` as the HTTP/WebSocket server.

If upstream changes its Fastify routes, hooks, request handling, uploads,
static-file behavior, or WebSocket bridge, port the behavior into the existing
Hono/Bun implementation. Do not reintroduce Fastify or a separate Node
WebSocket server merely to make an upstream patch apply cleanly.

### Extracted desktop runtime shims

The extracted Codex Desktop application under `scratch/asar` expects some
Electron/Node modules. The Bun migration provides repository-owned shims for
those expectations:

- `src/server/electron/loader.cjs`
- `src/server/sqlite/loader.cjs`
- `scripts/install_runtime_shims`
- `scripts/prepare_asar`

In particular, the old native `better-sqlite3` runtime path is replaced by the
Bun-compatible SQLite shim. Preparation and startup must continue installing
these shims into the extracted application. Be careful when merging upstream
changes to asset preparation or `scratch/asar/node_modules` handling.

### Generated server files

TypeScript server sources are compiled next to their sources. This repository
currently tracks the generated `.js`, `.js.map`, `.d.ts`, and `.d.ts.map`
files. After changing a server TypeScript file, run:

```bash
bun run build:server
```

Commit the matching generated files with the source change. Changing to a
separate ignored output directory would be a broader build/distribution change
and should be done intentionally, not as part of an unrelated upstream merge.

## 2. Central passkey authentication

### Architecture

This repository does not run its own Better Auth instance and does not store
passkeys, passwords, auth tables, session secrets, or Better Auth secrets. It
is a downstream consumer of the existing central service:

- Auth UI: `https://auth.anuragroy.dev/`
- Session endpoint: `https://auth.anuragroy.dev/api/session`
- Hosted app: `https://codex.anuragroy.dev`
- Local HTTPS app hostname: `https://local.anuragroy.dev`

The incoming shared-domain cookie is forwarded server-side to the central
session endpoint. Only the configured owner identity is accepted, and central
auth failures fail closed. The fixed domains and owner ID in
`src/server/central-auth.ts` are public trust configuration, not secrets.

The central auth integration guide is maintained in the sibling repository at:

```text
/home/anurag/dev/hobby/auth.anuragroy.dev/CENTRAL_AUTH_INTEGRATION.md
```

Recheck that guide before changing the shared-cookie or session contract.

### Unauthenticated behavior

Unauthenticated top-level page requests render a local login screen from
`src/server/login-page.ts`. The login button navigates to the central auth site
with an absolute `returnTo` URL for the app origin.

Do not redirect browser subresources to the auth UI. Static frontend assets and
`/manifest.json` intentionally remain public; redirecting the manifest or an
asset cross-origin causes browser/CORS failures. Privileged backend surfaces,
including uploads, `/@fs/*`, and `/__backend/ipc`, require a valid session.

The IPC WebSocket also enforces the exact allowed app origin. Sessions are
revalidated while a connection is open, and an expired session closes the
socket with code `4401`; the browser shim reloads so the login screen can be
shown.

When adding or merging a route, explicitly classify it as one of:

- public browser infrastructure, such as immutable assets or the manifest;
- a top-level page that may render the local login screen; or
- a privileged HTTP/WebSocket endpoint that must return an unauthorized
  response when no valid session exists.

Default hosted origins are defined in `src/server/central-auth.ts`. A deployment
can narrow or override them with a comma-separated allowlist:

```bash
CODEX_WEB_ORIGINS=https://codex.anuragroy.dev bun run server
```

Origin entries are restricted to HTTPS origins under `*.anuragroy.dev`.

### Local bypass

Authentication is enabled by the normal `bun run server` command.
`bun run server:local` passes `--unsafe-disable-auth` for loopback-only local
development. The server refuses this bypass on a non-loopback bind.

Never expose `server:local` through a reverse proxy, tunnel, LAN bind, or public
interface.

## Merging upstream safely

The configured remotes are expected to be:

- `origin`: this maintained fork;
- `upstream`: `https://github.com/0xcaff/codex-web.git`.

A normal update starts with:

```bash
git fetch upstream
git merge upstream/main
```

Resolve conflicts according to behavior, not simply by choosing one side. Pay
particular attention to:

- `package.json`, `bun.lock`, and any upstream npm lockfile;
- `src/server/main.ts` and its generated files;
- asset preparation and runtime shim scripts;
- `src/browser/shim.ts`, especially WebSocket lifecycle handling;
- new or changed HTTP, file, upload, manifest, and WebSocket routes; and
- README instructions that may assume Node.js, npm, or an unauthenticated
  server.

For each upstream server change:

1. Preserve its intended user-visible behavior.
2. Express it using the existing Bun/Hono architecture.
3. Decide how every new route participates in the auth boundary.
4. Regenerate tracked server output.
5. Run the focused tests and a full build.

At minimum, verify with:

```bash
bun run test
bun run build
```

For auth-sensitive changes, also verify that unauthenticated page requests show
the login screen, `/manifest.json` remains directly accessible, privileged
HTTP endpoints return an unauthorized response, and the IPC WebSocket rejects
unauthenticated or disallowed-origin connections.
