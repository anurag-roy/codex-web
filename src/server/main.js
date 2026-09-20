#!/usr/bin/env bun
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const hono_1 = require("hono");
const bun_1 = require("hono/bun");
const glob_1 = require("glob");
const central_auth_js_1 = require("./central-auth.js");
const login_page_js_1 = require("./login-page.js");
class WebSocketMessagePort {
    portId;
    sendToRenderer;
    onClosed;
    closed = false;
    listeners = new Map();
    constructor(portId, sendToRenderer, onClosed) {
        this.portId = portId;
        this.sendToRenderer = sendToRenderer;
        this.onClosed = onClosed;
    }
    on(event, listener) {
        const listeners = this.listeners.get(event) ?? new Set();
        listeners.add(listener);
        this.listeners.set(event, listeners);
        return this;
    }
    postMessage(data) {
        if (this.closed) {
            return;
        }
        this.sendToRenderer({
            type: "message-port-message",
            portId: this.portId,
            data,
        });
    }
    start() { }
    close() {
        if (!this.markClosed()) {
            return;
        }
        this.sendToRenderer({
            type: "message-port-close",
            portId: this.portId,
        });
    }
    receiveMessage(data) {
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
    disconnect() {
        if (!this.markClosed()) {
            return;
        }
        this.emit("close");
    }
    emit(event, ...args) {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(...args);
        }
    }
    markClosed() {
        if (this.closed) {
            return false;
        }
        this.closed = true;
        this.onClosed();
        return true;
    }
}
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
const SESSION_REVALIDATION_INTERVAL_MS = 30_000;
const UNAUTHORIZED_WEBSOCKET_CLOSE_CODE = 4401;
function printUsage() {
    console.log([
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
        throw new Error("--unsafe-disable-auth can only be used on a loopback host");
    }
    return {
        authEnabled,
        host,
        port: parsed.values.port ? parsePort(parsed.values.port) : 8214,
    };
}
function isLoopbackHost(host) {
    return host === "127.0.0.1" || host === "::1" || host === "localhost";
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
    process.env.BUILD_FLAVOR = "prod";
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
    const systemVersion = process.platform === "darwin"
        ? (0, node_child_process_1.execFileSync)("/usr/bin/sw_vers", ["-productVersion"], {
            encoding: "utf8",
        }).trim()
        : node_os_1.default.release();
    processWithElectronFields.getSystemVersion ??= () => systemVersion;
    processWithElectronFields.resourcesPath ??= node_path_1.default.resolve(__dirname, "../../scratch/asar");
    processWithElectronFields.type ??= "browser";
}
async function startIpcBridgeServer(options) {
    const bridgeState = getIpcMainBridgeState();
    const app = new hono_1.Hono();
    const sockets = new Map();
    const rendererSockets = new Map();
    const rendererWindowFactory = new Promise((resolve) => {
        bridgeState.setRendererWindowFactory = resolve;
    });
    bridgeState.sendToRenderer = (webContentsId, message) => {
        const socket = rendererSockets.get(webContentsId);
        if (socket) {
            sendWebSocketMessage(socket, message);
        }
    };
    const uploadRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "codex-web-uploads-"));
    const webviewRoot = node_path_1.default.resolve(__dirname, "../../scratch/asar/webview");
    const allowedAppOrigins = (0, central_auth_js_1.getCodexWebOrigins)();
    function getRequestAppOrigin(context) {
        return (0, central_auth_js_1.resolveCodexWebOrigin)(context.req.url, context.req.header("x-forwarded-host") ?? context.req.header("host"), allowedAppOrigins);
    }
    async function authenticateRequest(context) {
        if (!options.authEnabled) {
            return { enabled: false };
        }
        const cookie = context.req.header("cookie") ?? "";
        const session = await (0, central_auth_js_1.getCentralAuthSession)(cookie);
        if (!session) {
            return null;
        }
        return { enabled: true, cookie, session };
    }
    async function requireCentralAuthApi(context, next) {
        context.header("cache-control", "private, no-store");
        context.header("vary", "Cookie");
        const auth = await authenticateRequest(context);
        if (!auth) {
            const appOrigin = getRequestAppOrigin(context);
            return context.json({
                error: "Unauthorized",
                loginUrl: (0, central_auth_js_1.getCentralAuthLoginUrl)(appOrigin, appOrigin),
            }, 401);
        }
        context.set("centralAuth", auth);
        await next();
    }
    async function requireCentralAuthPage(context, next) {
        const auth = await authenticateRequest(context);
        if (!auth) {
            const appOrigin = getRequestAppOrigin(context);
            context.header("cache-control", "private, no-store");
            context.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
            context.header("referrer-policy", "no-referrer");
            context.header("vary", "Cookie");
            context.header("x-content-type-options", "nosniff");
            return context.html((0, login_page_js_1.renderLoginPage)((0, central_auth_js_1.getCentralAuthLoginUrl)(context.req.url, appOrigin)));
        }
        context.set("centralAuth", auth);
        context.header("cache-control", "private, no-store");
        context.header("vary", "Cookie");
        await next();
    }
    async function requireCodexWebOrigin(context, next) {
        const auth = context.get("centralAuth");
        if (auth.enabled &&
            !(0, central_auth_js_1.isCodexWebOrigin)(context.req.header("origin"), getRequestAppOrigin(context))) {
            return context.json({ error: "Forbidden" }, 403);
        }
        await next();
    }
    async function requireCodexWebRequestSource(context, next) {
        const auth = context.get("centralAuth");
        const appOrigin = getRequestAppOrigin(context);
        if (auth.enabled &&
            !(0, central_auth_js_1.isCodexWebOrigin)(context.req.header("origin"), appOrigin) &&
            !(0, central_auth_js_1.isCodexWebOrigin)(context.req.header("referer"), appOrigin)) {
            return context.json({ error: "Forbidden" }, 403);
        }
        await next();
    }
    function clearSocketMessagePorts(connection) {
        for (const port of connection.messagePorts.values()) {
            port.disconnect();
        }
        connection.messagePorts.clear();
    }
    function clearSocketRendererWindow(connection) {
        if (!connection.rendererWindow) {
            return;
        }
        rendererSockets.delete(connection.rendererWindow.webContents.id);
        connection.rendererWindow.destroy();
        connection.rendererWindow = undefined;
    }
    function clearSocketRevalidation(rawSocket) {
        const connection = sockets.get(rawSocket);
        if (connection?.revalidationTimer) {
            clearTimeout(connection.revalidationTimer);
            connection.revalidationTimer = null;
        }
    }
    function scheduleSocketRevalidation(rawSocket) {
        const connection = sockets.get(rawSocket);
        if (!connection?.authCookie) {
            return;
        }
        connection.revalidationTimer = setTimeout(() => {
            void (0, central_auth_js_1.getCentralAuthSession)(connection.authCookie).then((session) => {
                const currentConnection = sockets.get(rawSocket);
                if (currentConnection !== connection) {
                    return;
                }
                connection.revalidationTimer = null;
                if (!session) {
                    connection.socket.close(UNAUTHORIZED_WEBSOCKET_CLOSE_CODE, "authentication expired");
                    return;
                }
                scheduleSocketRevalidation(rawSocket);
            });
        }, SESSION_REVALIDATION_INTERVAL_MS);
    }
    function dispatchPostMessage(channel, message, ports, windowId) {
        const handler = bridgeState.handleRendererPostMessage;
        if (handler) {
            handler(channel, message, ports, windowId);
            return;
        }
        console.error(`[ipc-bridge] no ipcMain postMessage handler for channel ${channel}`);
        for (const port of ports) {
            port.close();
        }
    }
    function createRendererWindowForSocket(socket) {
        // Each tab is a real registered app view, with its own IPC client and ownership.
        return rendererWindowFactory
            .then(async (createWindow) => {
            if (socket.readyState !== OPEN_WEBSOCKET_READY_STATE) {
                return undefined;
            }
            const window = await createWindow();
            if (socket.readyState !== OPEN_WEBSOCKET_READY_STATE) {
                window.destroy();
                return undefined;
            }
            const connection = sockets.get(socket.raw);
            if (!connection || connection.socket !== socket) {
                window.destroy();
                return undefined;
            }
            connection.rendererWindow = window;
            rendererSockets.set(window.webContents.id, socket);
            return window;
        })
            .catch((error) => {
            console.error("[ipc-bridge] failed to create renderer window", error);
            socket.close(1011, "Renderer initialization failed");
            return undefined;
        });
    }
    app.use("/__backend/*", requireCentralAuthApi);
    app.use("/@fs/*", requireCentralAuthApi);
    app.use("/@fs/*", requireCodexWebRequestSource);
    app.use("/__backend/upload", requireCodexWebOrigin);
    app.use("/__backend/ipc", requireCodexWebOrigin);
    app.use("*", async (context, next) => {
        const requestPath = context.req.path;
        if (requestPath.startsWith("/__backend/") ||
            requestPath.startsWith("/@fs/") ||
            requestPath.startsWith("/assets/") ||
            requestPath === "/favicon.svg" ||
            requestPath === "/manifest.json") {
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
    app.get("/__backend/ipc", (0, bun_1.upgradeWebSocket)((context) => {
        const auth = context.get("centralAuth");
        const authCookie = auth.enabled ? auth.cookie : null;
        return {
            onOpen(_event, socket) {
                const connection = {
                    authCookie,
                    messagePorts: new Map(),
                    rendererReady: Promise.resolve(undefined),
                    revalidationTimer: null,
                    socket,
                };
                sockets.set(socket.raw, connection);
                connection.rendererReady = createRendererWindowForSocket(socket);
                scheduleSocketRevalidation(socket.raw);
            },
            onClose(_event, socket) {
                const connection = sockets.get(socket.raw);
                if (connection) {
                    clearSocketMessagePorts(connection);
                    clearSocketRendererWindow(connection);
                }
                clearSocketRevalidation(socket.raw);
                sockets.delete(socket.raw);
            },
            onError(_event, socket) {
                const connection = sockets.get(socket.raw);
                if (connection) {
                    clearSocketMessagePorts(connection);
                    clearSocketRendererWindow(connection);
                }
                clearSocketRevalidation(socket.raw);
                sockets.delete(socket.raw);
            },
            async onMessage(event, socket) {
                const connection = sockets.get(socket.raw);
                if (!connection) {
                    return;
                }
                const window = await connection.rendererReady;
                if (!window ||
                    socket.readyState !== OPEN_WEBSOCKET_READY_STATE ||
                    sockets.get(socket.raw) !== connection) {
                    return;
                }
                let message;
                try {
                    message = JSON.parse(await websocketMessageText(event.data));
                }
                catch (error) {
                    console.error("[ipc-bridge] invalid JSON payload", error);
                    return;
                }
                if (message.type === "ipc-renderer-send") {
                    bridgeState.handleRendererSend?.(message.channel, message.args, window.id);
                    return;
                }
                if (message.type === "ipc-renderer-post-message") {
                    if (new Set(message.portIds).size !== message.portIds.length) {
                        console.error("[ipc-bridge] duplicate transferred MessagePort id");
                        return;
                    }
                    const ports = message.portIds.map((portId) => {
                        const existingPort = connection.messagePorts.get(portId);
                        if (existingPort) {
                            existingPort.disconnect();
                        }
                        const port = new WebSocketMessagePort(portId, (payload) => {
                            sendWebSocketMessage(socket, payload);
                        }, () => connection.messagePorts.delete(portId));
                        connection.messagePorts.set(portId, port);
                        return port;
                    });
                    dispatchPostMessage(message.channel, message.message, ports, window.id);
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
                    Promise.resolve(bridgeState.handleRendererInvoke?.(channel, args, window.id) ??
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
        };
    }));
    app.use("/@fs/*", (0, bun_1.serveStatic)({
        root: "/",
        rewriteRequestPath: (requestPath) => requestPath.slice("/@fs".length),
    }));
    app.all("/@fs/*", (context) => context.json({ error: "Not Found" }, 404));
    app.use("/*", (0, bun_1.serveStatic)({
        root: webviewRoot,
    }));
    app.get("*", (0, bun_1.serveStatic)({ root: webviewRoot, path: "index.html" }));
    app.notFound((context) => {
        return context.json({ error: "Not Found" }, 404);
    });
    app.onError((error, context) => {
        console.error("[ipc-bridge] request failed", error);
        return context.json({ error: "Internal Server Error" }, 500);
    });
    const server = Bun.serve({
        hostname: options.host,
        port: options.port,
        fetch: app.fetch,
        websocket: bun_1.websocket,
        maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    });
    console.log(`IPC bridge listening at ws://${options.host}:${options.port}`);
    if (options.authEnabled) {
        console.log(`Central authentication enabled via ${central_auth_js_1.CENTRAL_AUTH_ORIGIN}`);
        console.log(`Allowed app origins: ${allowedAppOrigins.join(", ")}`);
    }
    else {
        console.warn("WARNING: central authentication is disabled for this loopback-only server");
    }
    let stopping = false;
    const stopServer = async () => {
        if (stopping) {
            return;
        }
        stopping = true;
        bridgeState.sendToRenderer = undefined;
        for (const [rawSocket, connection] of sockets) {
            clearSocketMessagePorts(connection);
            clearSocketRendererWindow(connection);
            clearSocketRevalidation(rawSocket);
            connection.socket.close(1001, "server shutting down");
        }
        sockets.clear();
        rendererSockets.clear();
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