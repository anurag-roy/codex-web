#!/usr/bin/env bun

declare global {
  var __CODEX_SHIM_VALUES__: {
    version: string;
  };
}

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs as parseCliArgs } from "node:util";
import { Hono } from "hono";
import { serveStatic, upgradeWebSocket, websocket } from "hono/bun";
import type { WSContext, WSMessageReceive } from "hono/ws";
import { glob } from "glob";

type ServerOptions = {
  host: string;
  port: number;
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
  handleRendererSend?: (channel: string, args: unknown[]) => void;
};

const OPEN_WEBSOCKET_READY_STATE = 1;
const MAX_REQUEST_BODY_SIZE = 1024 ** 4;

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  server [--host <host>] [--port <port>]",
      "",
      "Defaults:",
      "  --host 127.0.0.1",
      "  --port 8214",
      "",
      "Examples:",
      "  bun run server",
      "  bun run server --port 9000",
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
    },
    strict: true,
  });

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  return {
    host: parsed.values.host ?? "127.0.0.1",
    port: parsed.values.port ? parsePort(parsed.values.port) : 8214,
  };
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
    resourcesPath?: string;
    type?: string;
  };
  // Bun exposes this Node-internal hook but returns undefined for unknown
  // bindings. Electron callers expect an unsupported binding to be absent.
  processWithElectronFields._linkedBinding = undefined;
  processWithElectronFields.resourcesPath ??= path.resolve(
    __dirname,
    "../../scratch/asar",
  );
  processWithElectronFields.type ??= "browser";
}

async function startIpcBridgeServer(options: ServerOptions): Promise<void> {
  const bridgeState = getIpcMainBridgeState();
  const app = new Hono();
  const sockets = new Map<unknown, WSContext>();

  const uploadRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-web-uploads-"),
  );
  const webviewRoot = path.resolve(__dirname, "../../scratch/asar/webview");

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
    upgradeWebSocket(() => ({
      onOpen(_event, socket) {
        sockets.set(socket.raw, socket);
      },
      onClose(_event, socket) {
        sockets.delete(socket.raw);
      },
      onError(_event, socket) {
        sockets.delete(socket.raw);
      },
      async onMessage(event, socket) {
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
    })),
  );

  app.use(
    "/@fs/*",
    serveStatic({
      root: "/",
      rewriteRequestPath: (requestPath) => requestPath.slice("/@fs".length),
    }),
  );

  app.all("/@fs/*", (context) => context.json({ error: "Not Found" }, 404));

  app.use("/*", serveStatic({ root: webviewRoot }));
  app.get("*", serveStatic({ root: webviewRoot, path: "index.html" }));

  app.notFound((context) => {
    return context.json({ error: "Not Found" }, 404);
  });

  app.onError((error, context) => {
    console.error("[ipc-bridge] request failed", error);
    return context.json({ error: "Internal Server Error" }, 500);
  });

  bridgeState.broadcastToRenderer = (message: MainToRendererMessage): void => {
    for (const socket of sockets.values()) {
      sendWebSocketMessage(socket, message);
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

  let stopping = false;
  const stopServer = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    bridgeState.broadcastToRenderer = undefined;
    for (const socket of sockets.values()) {
      socket.close(1001, "server shutting down");
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
