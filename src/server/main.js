#!/usr/bin/env bun
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const hono_1 = require("hono");
const bun_1 = require("hono/bun");
const glob_1 = require("glob");
function workspaceDirectoryEntryTypeRank(entry) {
    return entry.type === "directory" ? 0 : 1;
}
function workspaceDirectoryEntryHiddenRank(entry) {
    return entry.name.startsWith(".") ? 1 : 0;
}
function compareWorkspaceDirectoryEntries(left, right) {
    return (workspaceDirectoryEntryTypeRank(left) -
        workspaceDirectoryEntryTypeRank(right) ||
        workspaceDirectoryEntryHiddenRank(left) -
            workspaceDirectoryEntryHiddenRank(right) ||
        left.name.localeCompare(right.name));
}
const OPEN_WEBSOCKET_READY_STATE = 1;
const MAX_REQUEST_BODY_SIZE = 1024 ** 4;
function printUsage() {
    console.log([
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
    ].join("\n"));
}
function parsePort(raw) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid port: ${raw}`);
    }
    return parsed;
}
function parseServerArgs(args) {
    const parsed = (0, node_util_1.parseArgs)({
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
function getIpcMainBridgeState() {
    const globals = globalThis;
    if (!globals.__codexElectronIpcBridge) {
        globals.__codexElectronIpcBridge = {};
    }
    return globals.__codexElectronIpcBridge;
}
function errorMessage(error) {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }
    return String(error);
}
async function websocketMessageText(data) {
    if (typeof data === "string") {
        return data;
    }
    if (data instanceof Blob) {
        return await data.text();
    }
    return new TextDecoder().decode(data);
}
function sendWebSocketMessage(socket, message) {
    if (socket.readyState === OPEN_WEBSOCKET_READY_STATE) {
        socket.send(JSON.stringify(message));
    }
}
async function getWorkspaceDirectoryEntries({ directoryPath, directoriesOnly, }) {
    const requestedPath = directoryPath?.trim() || node_os_1.default.homedir();
    const resolvedPath = node_path_1.default.resolve(requestedPath);
    const stat = await promises_1.default.stat(resolvedPath);
    if (!stat.isDirectory()) {
        throw new Error(`Directory not found: ${requestedPath}`);
    }
    const entries = (await promises_1.default.readdir(resolvedPath, { withFileTypes: true }))
        .flatMap((entry) => {
        const type = entry.isDirectory() ? "directory" : "file";
        if (directoriesOnly && type !== "directory") {
            return [];
        }
        return [
            {
                name: entry.name,
                path: node_path_1.default.join(resolvedPath, entry.name),
                type,
            },
        ];
    })
        .sort(compareWorkspaceDirectoryEntries);
    const rootPath = node_path_1.default.parse(resolvedPath).root;
    const parentPath = resolvedPath === rootPath ? null : node_path_1.default.dirname(resolvedPath);
    return {
        directoryPath: resolvedPath,
        parentPath,
        entries,
    };
}
function ensureElectronLikeProcessContext() {
    const versions = process.versions;
    if (!versions.electron) {
        Object.defineProperty(versions, "electron", {
            value: "41.2.0",
            configurable: true,
            enumerable: true,
            writable: false,
        });
    }
    const processWithElectronFields = process;
    // Bun exposes this Node-internal hook but returns undefined for unknown
    // bindings. Electron callers expect an unsupported binding to be absent.
    processWithElectronFields._linkedBinding = undefined;
    processWithElectronFields.resourcesPath ??= node_path_1.default.resolve(__dirname, "../../scratch/asar");
    processWithElectronFields.type ??= "browser";
}
async function startIpcBridgeServer(options) {
    const bridgeState = getIpcMainBridgeState();
    const app = new hono_1.Hono();
    const sockets = new Map();
    const uploadRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "codex-web-uploads-"));
    const webviewRoot = node_path_1.default.resolve(__dirname, "../../scratch/asar/webview");
    app.post("/__backend/upload", async (context) => {
        const contentType = context.req.header("content-type")?.toLowerCase();
        if (!contentType?.startsWith("multipart/form-data")) {
            return context.json({ error: "expected multipart upload body" }, 400);
        }
        const formData = await context.req.raw.formData();
        const parts = [];
        formData.forEach((part) => parts.push(part));
        const files = [];
        for (const part of parts) {
            if (!(part instanceof File)) {
                continue;
            }
            const uploadedPath = node_path_1.default.join(uploadRoot, (0, node_crypto_1.randomUUID)());
            await Bun.write(uploadedPath, part);
            files.push({
                label: part.name.trim() || "upload",
                path: uploadedPath,
                fsPath: uploadedPath,
            });
        }
        return context.json({ files });
    });
    app.get("/__backend/ipc", (0, bun_1.upgradeWebSocket)(() => ({
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
            let message;
            try {
                message = JSON.parse(await websocketMessageText(event.data));
            }
            catch (error) {
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
                Promise.resolve(bridgeState.handleRendererInvoke?.(channel, args) ??
                    Promise.reject(new Error(`[ipc-bridge] no ipcMain.handle for channel ${channel}`)))
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
    })));
    app.use("/@fs/*", (0, bun_1.serveStatic)({
        root: "/",
        rewriteRequestPath: (requestPath) => requestPath.slice("/@fs".length),
    }));
    app.all("/@fs/*", (context) => context.json({ error: "Not Found" }, 404));
    app.use("/*", (0, bun_1.serveStatic)({ root: webviewRoot }));
    app.get("*", (0, bun_1.serveStatic)({ root: webviewRoot, path: "index.html" }));
    app.notFound((context) => {
        return context.json({ error: "Not Found" }, 404);
    });
    app.onError((error, context) => {
        console.error("[ipc-bridge] request failed", error);
        return context.json({ error: "Internal Server Error" }, 500);
    });
    bridgeState.broadcastToRenderer = (message) => {
        for (const socket of sockets.values()) {
            sendWebSocketMessage(socket, message);
        }
    };
    const server = Bun.serve({
        hostname: options.host,
        port: options.port,
        fetch: app.fetch,
        websocket: bun_1.websocket,
        maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    });
    console.log(`IPC bridge listening at ws://${options.host}:${options.port}`);
    let stopping = false;
    const stopServer = async () => {
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
        await promises_1.default.rm(uploadRoot, { recursive: true, force: true });
    };
    process.once("SIGINT", () => {
        void stopServer().finally(() => process.exit(0));
    });
    process.once("SIGTERM", () => {
        void stopServer().finally(() => process.exit(0));
    });
    ensureElectronLikeProcessContext();
    const packageJson = JSON.parse(await promises_1.default.readFile(node_path_1.default.resolve(__dirname, "../../scratch/asar/package.json"), "utf8"));
    globalThis.__CODEX_SHIM_VALUES__ = {
        version: packageJson.version,
    };
    const matches = await (0, glob_1.glob)("../../scratch/asar/.vite/build/main-*.js", {
        nodir: true,
        cwd: __dirname,
    });
    if (matches.length === 0) {
        throw new Error("no main bundle found");
    }
    if (matches.length > 1) {
        throw new Error("multiple main bundles found");
    }
    const module = require(matches[0]);
    module.runMainAppStartup();
}
async function main(args) {
    const options = parseServerArgs(args);
    await startIpcBridgeServer(options);
}
main(process.argv.slice(2));
//# sourceMappingURL=main.js.map