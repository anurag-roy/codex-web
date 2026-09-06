#!/usr/bin/env bun

declare global {
  var __CODEX_SHIM_VALUES__: {
    version: string;
  };
}

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs as parseCliArgs } from "node:util";
import { Hono, type Context, type Next } from "hono";
import { serveStatic, upgradeWebSocket, websocket } from "hono/bun";
import type { WSContext, WSMessageReceive } from "hono/ws";
import { glob } from "glob";
import {
  CENTRAL_AUTH_ORIGIN,
  type CentralAuthSession,
  getCentralAuthLoginUrl,
  getCentralAuthSession,
  getCodexWebOrigins,
  isCodexWebOrigin,
  resolveCodexWebOrigin,
} from "./central-auth.js";
import { renderLoginPage } from "./login-page.js";

type ServerOptions = {
  authEnabled: boolean;
  host: string;
  port: number;
};

type CentralAuthState =
  | {
      enabled: true;
      cookie: string;
      session: CentralAuthSession;
    }
  | {
      enabled: false;
    };

type ServerEnvironment = {
  Variables: {
    centralAuth: CentralAuthState;
  };
};

type RendererToMainMessage =
  | {
      type: "ipc-renderer-invoke";
      requestId: string;
      channel: string;
      args: unknown[];
      sourceUrl: string;
    }
  | {
      type: "ipc-renderer-send";
      channel: string;
      args: unknown[];
      sourceUrl: string;
    }
  | {
      type: "ipc-renderer-post-message";
      channel: string;
      message: unknown;
      portIds: string[];
      sourceUrl?: string;
    }
  | {
      type: "message-port-message";
      portId: string;
      data: unknown;
    }
  | {
      type: "message-port-close";
      portId: string;
    }
  | {
      type: "workspace-directory-entries-request";
      requestId: string;
      directoryPath: string | null;
      directoriesOnly: boolean;
    };

type MainToRendererMessage =
  | {
      type: "ipc-main-event";
      channel: string;
      args: unknown[];
    }
  | {
      type: "ipc-renderer-invoke-result";
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "ipc-renderer-invoke-result";
      requestId: string;
      ok: false;
      errorMessage: string;
    }
  | {
      type: "workspace-directory-entries-result";
      requestId: string;
      ok: true;
      result: WorkspaceDirectoryEntries;
    }
  | {
      type: "workspace-directory-entries-result";
      requestId: string;
      ok: false;
      errorMessage: string;
    }
  | {
      type: "message-port-message";
      portId: string;
      data: unknown;
    }
  | {
      type: "message-port-close";
      portId: string;
    };

type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

type WorkspaceDirectoryEntries = {
  directoryPath: string;
  parentPath: string | null;
  entries: WorkspaceDirectoryEntry[];
};

type MessagePortListener = (...args: unknown[]) => void;

type BridgedMessagePort = {
  close: () => void;
  on: (event: string, listener: MessagePortListener) => unknown;
  postMessage: (message: unknown) => void;
  start: () => void;
};

class WebSocketMessagePort implements BridgedMessagePort {
  private closed = false;
  private readonly listeners = new Map<string, Set<MessagePortListener>>();

  constructor(
    private readonly portId: string,
    private readonly sendToRenderer: (message: MainToRendererMessage) => void,
    private readonly onClosed: () => void,
  ) {}

  on(event: string, listener: MessagePortListener): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);

    return this;
  }

  postMessage(data: unknown): void {
    if (this.closed) {
      return;
    }
    this.sendToRenderer({
      type: "message-port-message",
      portId: this.portId,
      data,
    });
  }

  start(): void {}

  close(): void {
    if (!this.markClosed()) {
      return;
    }
    this.sendToRenderer({
      type: "message-port-close",
      portId: this.portId,
    });
  }

  receiveMessage(data: unknown): void {
    if (this.closed) {
      return;
    }
    const listeners = this.listeners.get("message");
    if (!listeners || listeners.size === 0) {
      return;
    }
    for (const listener of listeners) {
      listener({ data });
    }
  }

  disconnect(): void {
    if (!this.markClosed()) {
      return;
    }
    this.emit("close");
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  private markClosed(): boolean {
    if (this.closed) {
      return false;
    }
    this.closed = true;
    this.onClosed();
    return true;
  }
}

function workspaceDirectoryEntryTypeRank(
  entry: WorkspaceDirectoryEntry,
): number {
  return entry.type === "directory" ? 0 : 1;
}

function workspaceDirectoryEntryHiddenRank(
  entry: WorkspaceDirectoryEntry,
): number {
  return entry.name.startsWith(".") ? 1 : 0;
}

function compareWorkspaceDirectoryEntries(
  left: WorkspaceDirectoryEntry,
  right: WorkspaceDirectoryEntry,
): number {
  return (
    workspaceDirectoryEntryTypeRank(left) -
      workspaceDirectoryEntryTypeRank(right) ||
    workspaceDirectoryEntryHiddenRank(left) -
      workspaceDirectoryEntryHiddenRank(right) ||
    left.name.localeCompare(right.name)
  );
}

type IpcMainBridgeState = {
  broadcastToRenderer?: (message: MainToRendererMessage) => void;
  handleRendererInvoke?: (channel: string, args: unknown[]) => Promise<unknown>;
  handleRendererPostMessage?: (
    channel: string,
    message: unknown,
    ports: BridgedMessagePort[],
    sourceUrl?: string,
  ) => void;
  handleRendererSend?: (channel: string, args: unknown[]) => void;
};

type SocketConnection = {
  authCookie: string | null;
  messagePorts: Map<string, WebSocketMessagePort>;
  revalidationTimer: ReturnType<typeof setTimeout> | null;
  socket: WSContext;
};

const OPEN_WEBSOCKET_READY_STATE = 1;
const MAX_REQUEST_BODY_SIZE = 1024 ** 4;
const SESSION_REVALIDATION_INTERVAL_MS = 30_000;
const UNAUTHORIZED_WEBSOCKET_CLOSE_CODE = 4401;

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  server [--host <host>] [--port <port>] [--unsafe-disable-auth]",
      "",
      "Defaults:",
      "  --host 127.0.0.1",
      "  --port 8214",
      "",
      "Examples:",
      "  bun run server",
      "  bun run server --port 9000",
      "  bun run server:local",
    ].join("\n"),
  );
}

function parsePort(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return parsed;
}

function parseServerArgs(args: string[]): ServerOptions {
  const parsed = parseCliArgs({
    args,
    allowPositionals: false,
    options: {
      help: {
        short: "h",
        type: "boolean",
      },
      host: {
        type: "string",
      },
      port: {
        type: "string",
      },
      "unsafe-disable-auth": {
        type: "boolean",
      },
    },
    strict: true,
  });

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  const host = parsed.values.host ?? "127.0.0.1";
  const authEnabled = !parsed.values["unsafe-disable-auth"];
  if (!authEnabled && !isLoopbackHost(host)) {
    throw new Error(
      "--unsafe-disable-auth can only be used on a loopback host",
    );
  }

  return {
    authEnabled,
    host,
    port: parsed.values.port ? parsePort(parsed.values.port) : 8214,
  };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function getIpcMainBridgeState(): IpcMainBridgeState {
  const globals = globalThis as typeof globalThis & {
    __codexElectronIpcBridge?: IpcMainBridgeState;
  };
  if (!globals.__codexElectronIpcBridge) {
    globals.__codexElectronIpcBridge = {};
  }
  return globals.__codexElectronIpcBridge;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

async function websocketMessageText(data: WSMessageReceive): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Blob) {
    return await data.text();
  }
  return new TextDecoder().decode(data);
}

function sendWebSocketMessage(
  socket: WSContext,
  message: MainToRendererMessage,
): void {
  if (socket.readyState === OPEN_WEBSOCKET_READY_STATE) {
    socket.send(JSON.stringify(message));
  }
}

async function getWorkspaceDirectoryEntries({
  directoryPath,
  directoriesOnly,
}: {
  directoryPath: string | null;
  directoriesOnly: boolean;
}): Promise<WorkspaceDirectoryEntries> {
  const requestedPath = directoryPath?.trim() || os.homedir();
  const resolvedPath = path.resolve(requestedPath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error(`Directory not found: ${requestedPath}`);
  }

  const entries = (await fs.readdir(resolvedPath, { withFileTypes: true }))
    .flatMap((entry): WorkspaceDirectoryEntry[] => {
      const type = entry.isDirectory() ? "directory" : "file";
      if (directoriesOnly && type !== "directory") {
        return [];
      }

      return [
        {
          name: entry.name,
          path: path.join(resolvedPath, entry.name),
          type,
        },
      ];
    })
    .sort(compareWorkspaceDirectoryEntries);

  const rootPath = path.parse(resolvedPath).root;
  const parentPath =
    resolvedPath === rootPath ? null : path.dirname(resolvedPath);

  return {
    directoryPath: resolvedPath,
    parentPath,
    entries,
  };
}

function ensureElectronLikeProcessContext(): void {
  process.env.BUILD_FLAVOR = "prod";

  const versions = process.versions as NodeJS.ProcessVersions & {
    electron?: string;
  };
  if (!versions.electron) {
    Object.defineProperty(versions, "electron", {
      value: "41.2.0",
      configurable: true,
      enumerable: true,
      writable: false,
    });
  }

  const processWithElectronFields = process as NodeJS.Process & {
    _linkedBinding?: unknown;
    getSystemVersion?: () => string;
    resourcesPath?: string;
    type?: string;
  };
  // Bun exposes this Node-internal hook but returns undefined for unknown
  // bindings. Electron callers expect an unsupported binding to be absent.
  processWithElectronFields._linkedBinding = undefined;
  const systemVersion =
    process.platform === "darwin"
      ? execFileSync("/usr/bin/sw_vers", ["-productVersion"], {
          encoding: "utf8",
        }).trim()
      : os.release();
  processWithElectronFields.getSystemVersion ??= () => systemVersion;
  processWithElectronFields.resourcesPath ??= path.resolve(
    __dirname,
    "../../scratch/asar",
  );
  processWithElectronFields.type ??= "browser";
}

async function startIpcBridgeServer(options: ServerOptions): Promise<void> {
  const bridgeState = getIpcMainBridgeState();
  const app = new Hono<ServerEnvironment>();
  const sockets = new Map<unknown, SocketConnection>();

  const uploadRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-web-uploads-"),
  );
  const webviewRoot = path.resolve(__dirname, "../../scratch/asar/webview");
  const allowedAppOrigins = getCodexWebOrigins();

  function getRequestAppOrigin(context: Context<ServerEnvironment>): string {
    return resolveCodexWebOrigin(
      context.req.url,
      context.req.header("x-forwarded-host") ?? context.req.header("host"),
      allowedAppOrigins,
    );
  }

  async function authenticateRequest(
    context: Context<ServerEnvironment>,
  ): Promise<CentralAuthState | null> {
    if (!options.authEnabled) {
      return { enabled: false };
    }

    const cookie = context.req.header("cookie") ?? "";
    const session = await getCentralAuthSession(cookie);
    if (!session) {
      return null;
    }

    return { enabled: true, cookie, session };
  }

  async function requireCentralAuthApi(
    context: Context<ServerEnvironment>,
    next: Next,
  ) {
    context.header("cache-control", "private, no-store");
    context.header("vary", "Cookie");
    const auth = await authenticateRequest(context);
    if (!auth) {
      const appOrigin = getRequestAppOrigin(context);
      return context.json(
        {
          error: "Unauthorized",
          loginUrl: getCentralAuthLoginUrl(appOrigin, appOrigin),
        },
        401,
      );
    }

    context.set("centralAuth", auth);
    await next();
  }

  async function requireCentralAuthPage(
    context: Context<ServerEnvironment>,
    next: Next,
  ) {
    const auth = await authenticateRequest(context);
    if (!auth) {
      const appOrigin = getRequestAppOrigin(context);
      context.header("cache-control", "private, no-store");
      context.header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      context.header("referrer-policy", "no-referrer");
      context.header("vary", "Cookie");
      context.header("x-content-type-options", "nosniff");
      return context.html(
        renderLoginPage(getCentralAuthLoginUrl(context.req.url, appOrigin)),
      );
    }

    context.set("centralAuth", auth);
    context.header("cache-control", "private, no-store");
    context.header("vary", "Cookie");
    await next();
  }

  async function requireCodexWebOrigin(
    context: Context<ServerEnvironment>,
    next: Next,
  ) {
    const auth = context.get("centralAuth");
    if (
      auth.enabled &&
      !isCodexWebOrigin(
        context.req.header("origin"),
        getRequestAppOrigin(context),
      )
    ) {
      return context.json({ error: "Forbidden" }, 403);
    }
    await next();
  }

  async function requireCodexWebRequestSource(
    context: Context<ServerEnvironment>,
    next: Next,
  ) {
    const auth = context.get("centralAuth");
    const appOrigin = getRequestAppOrigin(context);
    if (
      auth.enabled &&
      !isCodexWebOrigin(context.req.header("origin"), appOrigin) &&
      !isCodexWebOrigin(context.req.header("referer"), appOrigin)
    ) {
      return context.json({ error: "Forbidden" }, 403);
    }
    await next();
  }

  function clearSocketMessagePorts(connection: SocketConnection): void {
    for (const port of connection.messagePorts.values()) {
      port.disconnect();
    }
    connection.messagePorts.clear();
  }

  function clearSocketRevalidation(rawSocket: unknown): void {
    const connection = sockets.get(rawSocket);
    if (connection?.revalidationTimer) {
      clearTimeout(connection.revalidationTimer);
      connection.revalidationTimer = null;
    }
  }

  function scheduleSocketRevalidation(rawSocket: unknown): void {
    const connection = sockets.get(rawSocket);
    if (!connection?.authCookie) {
      return;
    }

    connection.revalidationTimer = setTimeout(() => {
      void getCentralAuthSession(connection.authCookie!).then((session) => {
        const currentConnection = sockets.get(rawSocket);
        if (currentConnection !== connection) {
          return;
        }

        connection.revalidationTimer = null;
        if (!session) {
          connection.socket.close(
            UNAUTHORIZED_WEBSOCKET_CLOSE_CODE,
            "authentication expired",
          );
          return;
        }

        scheduleSocketRevalidation(rawSocket);
      });
    }, SESSION_REVALIDATION_INTERVAL_MS);
  }

  function dispatchPostMessage(
    channel: string,
    message: unknown,
    ports: WebSocketMessagePort[],
    sourceUrl?: string,
  ): void {
    const handler = bridgeState.handleRendererPostMessage;
    if (handler) {
      handler(channel, message, ports, sourceUrl);
      return;
    }

    console.error(
      `[ipc-bridge] no ipcMain postMessage handler for channel ${channel}`,
    );
    for (const port of ports) {
      port.close();
    }
  }

  app.use("/__backend/*", requireCentralAuthApi);
  app.use("/@fs/*", requireCentralAuthApi);
  app.use("/@fs/*", requireCodexWebRequestSource);
  app.use("/__backend/upload", requireCodexWebOrigin);
  app.use("/__backend/ipc", requireCodexWebOrigin);

  app.use("*", async (context, next) => {
    const requestPath = context.req.path;
    if (
      requestPath.startsWith("/__backend/") ||
      requestPath.startsWith("/@fs/") ||
      requestPath.startsWith("/assets/") ||
      requestPath === "/favicon.svg" ||
      requestPath === "/manifest.json"
    ) {
      await next();
      return;
    }

    return requireCentralAuthPage(context, next);
  });

  app.post("/__backend/upload", async (context) => {
    const contentType = context.req.header("content-type")?.toLowerCase();
    if (!contentType?.startsWith("multipart/form-data")) {
      return context.json({ error: "expected multipart upload body" }, 400);
    }

    const formData = await context.req.raw.formData();
    const parts: Bun.FormDataEntryValue[] = [];
    formData.forEach((part) => parts.push(part));
    const files = [];
    for (const part of parts) {
      if (!(part instanceof File)) {
        continue;
      }

      const uploadedPath = path.join(uploadRoot, randomUUID());
      await Bun.write(uploadedPath, part);
      files.push({
        label: part.name.trim() || "upload",
        path: uploadedPath,
        fsPath: uploadedPath,
      });
    }

    return context.json({ files });
  });

  app.get(
    "/__backend/ipc",
    upgradeWebSocket((context) => {
      const auth = context.get("centralAuth");
      const authCookie = auth.enabled ? auth.cookie : null;

      return {
        onOpen(_event, socket) {
          sockets.set(socket.raw, {
            authCookie,
            messagePorts: new Map(),
            revalidationTimer: null,
            socket,
          });
          scheduleSocketRevalidation(socket.raw);
        },
        onClose(_event, socket) {
          const connection = sockets.get(socket.raw);
          if (connection) {
            clearSocketMessagePorts(connection);
          }
          clearSocketRevalidation(socket.raw);
          sockets.delete(socket.raw);
        },
        onError(_event, socket) {
          const connection = sockets.get(socket.raw);
          if (connection) {
            clearSocketMessagePorts(connection);
          }
          clearSocketRevalidation(socket.raw);
          sockets.delete(socket.raw);
        },
        async onMessage(event, socket) {
          const connection = sockets.get(socket.raw);
          if (!connection) {
            return;
          }

          let message: RendererToMainMessage;
          try {
            message = JSON.parse(
              await websocketMessageText(event.data),
            ) as RendererToMainMessage;
          } catch (error) {
            console.error("[ipc-bridge] invalid JSON payload", error);
            return;
          }

          if (message.type === "ipc-renderer-send") {
            bridgeState.handleRendererSend?.(message.channel, message.args);
            return;
          }

          if (message.type === "ipc-renderer-post-message") {
            if (new Set(message.portIds).size !== message.portIds.length) {
              console.error(
                "[ipc-bridge] duplicate transferred MessagePort id",
              );
              return;
            }

            const ports = message.portIds.map((portId) => {
              const existingPort = connection.messagePorts.get(portId);
              if (existingPort) {
                existingPort.disconnect();
              }
              const port = new WebSocketMessagePort(
                portId,
                (payload) => {
                  sendWebSocketMessage(socket, payload);
                },
                () => connection.messagePorts.delete(portId),
              );
              connection.messagePorts.set(portId, port);
              return port;
            });

            dispatchPostMessage(
              message.channel,
              message.message,
              ports,
              message.sourceUrl,
            );
            return;
          }

          if (message.type === "message-port-message") {
            connection.messagePorts
              .get(message.portId)
              ?.receiveMessage(message.data);
            return;
          }

          if (message.type === "message-port-close") {
            connection.messagePorts.get(message.portId)?.disconnect();
            return;
          }

          if (message.type === "workspace-directory-entries-request") {
            const { requestId } = message;
            getWorkspaceDirectoryEntries(message)
              .then((result) => {
                sendWebSocketMessage(socket, {
                  type: "workspace-directory-entries-result",
                  requestId,
                  ok: true,
                  result,
                });
              })
              .catch((error) => {
                sendWebSocketMessage(socket, {
                  type: "workspace-directory-entries-result",
                  requestId,
                  ok: false,
                  errorMessage: errorMessage(error),
                });
              });
            return;
          }

          if (message.type === "ipc-renderer-invoke") {
            const { channel, requestId, args } = message;
            Promise.resolve(
              bridgeState.handleRendererInvoke?.(channel, args) ??
                Promise.reject(
                  new Error(
                    `[ipc-bridge] no ipcMain.handle for channel ${channel}`,
                  ),
                ),
            )
              .then((result) => {
                sendWebSocketMessage(socket, {
                  type: "ipc-renderer-invoke-result",
                  requestId,
                  ok: true,
                  result,
                });
              })
              .catch((error) => {
                sendWebSocketMessage(socket, {
                  type: "ipc-renderer-invoke-result",
                  requestId,
                  ok: false,
                  errorMessage: errorMessage(error),
                });
              });
          }
        },
      };
    }),
  );

  app.use(
    "/@fs/*",
    serveStatic({
      root: "/",
      rewriteRequestPath: (requestPath) => requestPath.slice("/@fs".length),
    }),
  );

  app.all("/@fs/*", (context) => context.json({ error: "Not Found" }, 404));

  app.use(
    "/*",
    serveStatic({
      root: webviewRoot,
    }),
  );
  app.get("*", serveStatic({ root: webviewRoot, path: "index.html" }));

  app.notFound((context) => {
    return context.json({ error: "Not Found" }, 404);
  });

  app.onError((error, context) => {
    console.error("[ipc-bridge] request failed", error);
    return context.json({ error: "Internal Server Error" }, 500);
  });

  bridgeState.broadcastToRenderer = (message: MainToRendererMessage): void => {
    for (const connection of sockets.values()) {
      sendWebSocketMessage(connection.socket, message);
    }
  };

  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: app.fetch,
    websocket,
    maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
  });

  console.log(`IPC bridge listening at ws://${options.host}:${options.port}`);
  if (options.authEnabled) {
    console.log(`Central authentication enabled via ${CENTRAL_AUTH_ORIGIN}`);
    console.log(`Allowed app origins: ${allowedAppOrigins.join(", ")}`);
  } else {
    console.warn(
      "WARNING: central authentication is disabled for this loopback-only server",
    );
  }

  let stopping = false;
  const stopServer = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    bridgeState.broadcastToRenderer = undefined;
    for (const [rawSocket, connection] of sockets) {
      clearSocketMessagePorts(connection);
      clearSocketRevalidation(rawSocket);
      connection.socket.close(1001, "server shutting down");
    }
    sockets.clear();
    await server.stop(true);
    await fs.rm(uploadRoot, { recursive: true, force: true });
  };

  process.once("SIGINT", () => {
    void stopServer().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stopServer().finally(() => process.exit(0));
  });

  ensureElectronLikeProcessContext();

  const packageJson = JSON.parse(
    await fs.readFile(
      path.resolve(__dirname, "../../scratch/asar/package.json"),
      "utf8",
    ),
  );

  globalThis.__CODEX_SHIM_VALUES__ = {
    version: packageJson.version,
  };

  const matches = await glob("../../scratch/asar/.vite/build/main-*.js", {
    nodir: true,
    cwd: __dirname,
  });

  if (matches.length === 0) {
    throw new Error("no main bundle found");
  }

  if (matches.length > 1) {
    throw new Error("multiple main bundles found");
  }

  const module = require(matches[0]!);
  module.runMainAppStartup();
}

async function main(args: string[]) {
  const options = parseServerArgs(args);

  await startIpcBridgeServer(options);
}

main(process.argv.slice(2));
