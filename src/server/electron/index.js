"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dialog = exports.crashReporter = exports.webContents = exports.WebContentsView = exports.utilityProcess = exports.Tray = exports.session = exports.screen = exports.protocol = exports.powerMonitor = exports.Notification = exports.nativeTheme = exports.nativeImage = exports.net = exports.MessageChannelMain = exports.MenuItem = exports.Menu = exports.ipcMain = exports.BrowserWindow = exports.autoUpdater = exports.app = void 0;
function getIpcMainBridgeState() {
    const globals = globalThis;
    if (!globals.__codexElectronIpcBridge) {
        globals.__codexElectronIpcBridge = {};
    }
    return globals.__codexElectronIpcBridge;
}
function log(method, args) {
    console.log(`[electron-main-stub] ${method}`, args);
}
function createDeepStub(pathLabel) {
    const fn = (...args) => {
        log(`${pathLabel}()`, args);
        return undefined;
    };
    return new Proxy(fn, {
        apply(_target, _thisArg, argArray) {
            log(`${pathLabel}()`, argArray);
            return undefined;
        },
        construct(_target, argArray) {
            log(`new ${pathLabel}()`, argArray);
            return {};
        },
        get(_target, prop) {
            if (prop === "then") {
                return undefined;
            }
            if (prop === Symbol.toPrimitive) {
                return () => pathLabel;
            }
            return createDeepStub(`${pathLabel}.${String(prop)}`);
        },
    });
}
function createEmitterStub(label) {
    const listeners = new Map();
    const api = {
        on(event, listener) {
            log(`${label}.on`, [event, listener]);
            const eventListeners = listeners.get(event) ?? new Set();
            eventListeners.add(listener);
            listeners.set(event, eventListeners);
            return api;
        },
        once(event, listener) {
            log(`${label}.once`, [event, listener]);
            const wrapped = (...args) => {
                api.removeListener(event, wrapped);
                listener(...args);
            };
            return api.on(event, wrapped);
        },
        addListener(event, listener) {
            log(`${label}.addListener`, [event, listener]);
            return api.on(event, listener);
        },
        removeListener(event, listener) {
            log(`${label}.removeListener`, [event, listener]);
            listeners.get(event)?.delete(listener);
            return api;
        },
        off(event, listener) {
            log(`${label}.off`, [event, listener]);
            return api.removeListener(event, listener);
        },
        emit(event, ...args) {
            log(`${label}.emit`, [event, ...args]);
            for (const listener of listeners.get(event) ?? []) {
                listener(...args);
            }
            return true;
        },
    };
    return api;
}
function createMessagePortStub(label) {
    const emitter = createEmitterStub(label);
    return {
        on: emitter.on,
        postMessage(...args) {
            log(`${label}.postMessage`, args);
        },
        start() {
            log(`${label}.start`, []);
        },
    };
}
const rendererUrl = "http://localhost:5175/";
const rendererMainFrame = {
    url: rendererUrl,
};
const rendererWebContentsEmitter = createEmitterStub("ipcMainEvent.sender");
const rendererWebContents = {
    id: 1001,
    mainFrame: rendererMainFrame,
    getURL: () => rendererMainFrame.url,
    isDestroyed: () => false,
    off: rendererWebContentsEmitter.off,
    on: rendererWebContentsEmitter.on,
    once: rendererWebContentsEmitter.once,
    removeListener: rendererWebContentsEmitter.removeListener,
    send: (channel, ...args) => {
        getIpcMainBridgeState().broadcastToRenderer?.({
            type: "ipc-main-event",
            channel,
            args,
        });
    },
};
function createIpcMainEvent(ports = []) {
    const sender = BrowserWindow.fromWebContents(rendererWebContents)
        ?.webContents ??
        rendererWebContents;
    const event = {
        returnValue: undefined,
        processId: 1,
        frameId: 1,
        sender,
        senderFrame: sender.mainFrame,
        ports,
        reply: (channel, ...args) => {
            getIpcMainBridgeState().broadcastToRenderer?.({
                type: "ipc-main-event",
                channel,
                args,
            });
        },
    };
    return event;
}
function createIpcMainStub() {
    const emitter = createEmitterStub("ipcMain");
    const handlers = new Map();
    const bridgeState = getIpcMainBridgeState();
    const pendingPostMessages = new Map();
    const registeredPostMessageChannels = new Set();
    bridgeState.handleRendererPostMessage = (channel, message, ports) => {
        if (registeredPostMessageChannels.has(channel)) {
            emitter.emit(channel, createIpcMainEvent(ports), message);
            return;
        }
        const pending = pendingPostMessages.get(channel) ?? [];
        pending.push({ message, ports });
        pendingPostMessages.set(channel, pending);
    };
    bridgeState.handleRendererInvoke = async (channel, args) => {
        const handler = handlers.get(channel);
        if (!handler) {
            throw new Error(`[electron-main-stub] No ipcMain.handle for ${channel}`);
        }
        const event = createIpcMainEvent();
        return await Promise.resolve(handler(event, ...args));
    };
    bridgeState.handleRendererSend = (channel, args, sourceUrl) => {
        const event = createIpcMainEvent();
        emitter.emit(channel, event, ...args);
    };
    return {
        on(channel, listener) {
            const result = emitter.on(channel, listener);
            registeredPostMessageChannels.add(channel);
            const pending = pendingPostMessages.get(channel);
            if (pending) {
                pendingPostMessages.delete(channel);
                for (const { message, ports } of pending) {
                    emitter.emit(channel, createIpcMainEvent(ports), message);
                }
            }
            return result;
        },
        off: emitter.off,
        handle(channel, handler) {
            log("ipcMain.handle", [channel, handler]);
            handlers.set(channel, handler);
        },
        removeHandler(channel) {
            log("ipcMain.removeHandler", [channel]);
            handlers.delete(channel);
        },
    };
}
let appReady = false;
const commandLineSwitches = new Map();
const commandLineArguments = [];
const appBase = {
    ...createEmitterStub("app"),
    name: "Codex",
    isPackaged: false,
    getName() {
        log("app.getName", []);
        return "Codex";
    },
    getVersion() {
        return globalThis.__CODEX_SHIM_VALUES__.version;
    },
    getLocale() {
        log("app.getLocale", []);
        return "en-US";
    },
    getSystemLocale() {
        log("app.getSystemLocale", []);
        return "en-US";
    },
    getPreferredSystemLanguages() {
        log("app.getPreferredSystemLanguages", []);
        return ["en-US"];
    },
    getPath(name) {
        log("app.getPath", [name]);
        return process.cwd();
    },
    getAppMetrics() {
        log("app.getAppMetrics", []);
        return [];
    },
    getAppPath() {
        log("app.getAppPath", []);
        return process.cwd();
    },
    async getGPUInfo(infoLevel) {
        log("app.getGPUInfo", [infoLevel]);
        return { gpuDevice: [] };
    },
    setName(name) {
        log("app.setName", [name]);
    },
    setPath(name, value) {
        log("app.setPath", [name, value]);
    },
    setAppUserModelId(value) {
        log("app.setAppUserModelId", [value]);
    },
    requestSingleInstanceLock() {
        log("app.requestSingleInstanceLock", []);
        return true;
    },
    isReady() {
        log("app.isReady", []);
        return appReady;
    },
    whenReady() {
        log("app.whenReady", []);
        appReady = true;
        return Promise.resolve();
    },
    commandLine: {
        appendSwitch(name, value) {
            log("app.commandLine.appendSwitch", [name, value]);
            commandLineSwitches.set(name, value ?? "");
        },
        appendArgument(value) {
            log("app.commandLine.appendArgument", [value]);
            commandLineArguments.push(value);
        },
        getSwitchValue(name) {
            log("app.commandLine.getSwitchValue", [name]);
            return commandLineSwitches.get(name) ?? "";
        },
        hasSwitch(name) {
            log("app.commandLine.hasSwitch", [name]);
            return commandLineSwitches.has(name);
        },
        removeSwitch(name) {
            log("app.commandLine.removeSwitch", [name]);
            commandLineSwitches.delete(name);
        },
    },
    on(event, listener) {
        log("app.on", [event, listener]);
        return app;
    },
    once(event, listener) {
        log("app.once", [event, listener]);
        return app;
    },
    quit() {
        log("app.quit", []);
    },
    exit(code) {
        log("app.exit", [code]);
    },
};
const app = new Proxy(appBase, {
    get(target, prop) {
        if (prop in target) {
            return target[prop];
        }
        return createDeepStub(`app.${String(prop)}`);
    },
});
exports.app = app;
class BrowserWindow {
    static nextId = 1;
    static allWindows = [];
    static focusedWindow = null;
    id;
    destroyed = false;
    title = "Codex";
    bounds = { x: 0, y: 0, width: 1280, height: 820 };
    webContents;
    emitter;
    constructor(...args) {
        log("new BrowserWindow", args);
        this.id = BrowserWindow.nextId++;
        this.emitter = createEmitterStub(`BrowserWindow#${this.id}`);
        const webContentsEmitter = createEmitterStub(`BrowserWindow#${this.id}.webContents`);
        this.webContents = new Proxy({
            ...webContentsEmitter,
            id: this.id * 1000 + 1,
            mainFrame: {
                url: "",
            },
            getURL: () => {
                log(`BrowserWindow#${this.id}.webContents.getURL`, []);
                return String(this.webContents.mainFrame?.url ??
                    "");
            },
            isDestroyed: () => this.destroyed,
            loadURL: async (url) => {
                log(`BrowserWindow#${this.id}.webContents.loadURL`, [url]);
                this.webContents.mainFrame.url = url;
            },
            loadFile: async (...loadFileArgs) => {
                log(`BrowserWindow#${this.id}.webContents.loadFile`, loadFileArgs);
            },
            openDevTools: (...openDevToolsArgs) => {
                log(`BrowserWindow#${this.id}.webContents.openDevTools`, openDevToolsArgs);
            },
            send: (...sendArgs) => {
                log(`BrowserWindow#${this.id}.webContents.send`, sendArgs);
                if (sendArgs.length === 0 || typeof sendArgs[0] !== "string") {
                    return;
                }
                const [channel, ...args] = sendArgs;
                getIpcMainBridgeState().broadcastToRenderer?.({
                    type: "ipc-main-event",
                    channel,
                    args,
                });
            },
        }, {
            get: (target, prop) => {
                if (prop in target) {
                    return target[prop];
                }
                return createDeepStub(`BrowserWindow#${this.id}.webContents.${String(prop)}`);
            },
        });
        BrowserWindow.allWindows.push(this);
        BrowserWindow.focusedWindow = this;
        return new Proxy(this, {
            get: (target, prop) => {
                if (prop in target) {
                    return target[prop];
                }
                return createDeepStub(`BrowserWindow#${target.id}.${String(prop)}`);
            },
        });
    }
    static getAllWindows() {
        log("BrowserWindow.getAllWindows", []);
        return BrowserWindow.allWindows.filter((window) => !window.destroyed);
    }
    static getFocusedWindow() {
        log("BrowserWindow.getFocusedWindow", []);
        if (BrowserWindow.focusedWindow && !BrowserWindow.focusedWindow.destroyed) {
            return BrowserWindow.focusedWindow;
        }
        return BrowserWindow.getAllWindows()[0] ?? null;
    }
    static fromWebContents(webContents) {
        log("BrowserWindow.fromWebContents", [webContents]);
        if (!webContents) {
            return null;
        }
        return (BrowserWindow.getAllWindows().find((window) => window.webContents === webContents ||
            window.webContents.id === webContents.id) ?? null);
    }
    on(event, listener) {
        return this.emitter.on(event, listener);
    }
    once(event, listener) {
        return this.emitter.once(event, listener);
    }
    off(event, listener) {
        return this.emitter.off(event, listener);
    }
    removeListener(event, listener) {
        return this.emitter.removeListener(event, listener);
    }
    async loadURL(url) {
        log(`BrowserWindow#${this.id}.loadURL`, [url]);
        this.webContents.mainFrame.url = url;
    }
    close() {
        log(`BrowserWindow#${this.id}.close`, []);
        this.emitter.emit("close", {
            preventDefault: () => undefined,
        });
        this.destroy();
    }
    destroy() {
        log(`BrowserWindow#${this.id}.destroy`, []);
        this.destroyed = true;
        if (BrowserWindow.focusedWindow === this) {
            BrowserWindow.focusedWindow = null;
        }
        this.emitter.emit("closed");
    }
    isDestroyed() {
        log(`BrowserWindow#${this.id}.isDestroyed`, []);
        return this.destroyed;
    }
    isFocused() {
        log(`BrowserWindow#${this.id}.isFocused`, []);
        return BrowserWindow.focusedWindow === this && !this.destroyed;
    }
    removeMenu() {
        log(`BrowserWindow#${this.id}.removeMenu`, []);
    }
    getTitle() {
        log(`BrowserWindow#${this.id}.getTitle`, []);
        return this.title;
    }
    setTitle(nextTitle) {
        log(`BrowserWindow#${this.id}.setTitle`, [nextTitle]);
        this.title = nextTitle;
    }
    getBounds() {
        log(`BrowserWindow#${this.id}.getBounds`, []);
        return { ...this.bounds };
    }
    setBounds(nextBounds) {
        log(`BrowserWindow#${this.id}.setBounds`, [nextBounds]);
        this.bounds = {
            x: nextBounds.x ?? this.bounds.x,
            y: nextBounds.y ?? this.bounds.y,
            width: nextBounds.width ?? this.bounds.width,
            height: nextBounds.height ?? this.bounds.height,
        };
    }
    show() {
        log(`BrowserWindow#${this.id}.show`, []);
    }
    hide() {
        log(`BrowserWindow#${this.id}.hide`, []);
    }
    focus() {
        log(`BrowserWindow#${this.id}.focus`, []);
        BrowserWindow.focusedWindow = this;
        this.emitter.emit("focus");
    }
}
exports.BrowserWindow = BrowserWindow;
class WebContentsView {
    constructor(...args) {
        log("new WebContentsView", args);
    }
}
exports.WebContentsView = WebContentsView;
class Menu {
    static applicationMenu = null;
    items = [];
    constructor(items = []) {
        this.items = items;
    }
    static buildFromTemplate(template) {
        log("Menu.buildFromTemplate", [template]);
        const items = template.map((entry) => new MenuItem(entry));
        return new Menu(items);
    }
    static setApplicationMenu(menu) {
        log("Menu.setApplicationMenu", [menu]);
        Menu.applicationMenu = menu;
    }
    static getApplicationMenu() {
        log("Menu.getApplicationMenu", []);
        return Menu.applicationMenu;
    }
    getMenuItemById(id) {
        log("Menu.getMenuItemById", [id]);
        const queue = [...this.items];
        while (queue.length > 0) {
            const candidate = queue.shift();
            if (!candidate) {
                continue;
            }
            if (candidate.id === id) {
                return candidate;
            }
            if (candidate.submenu) {
                queue.push(...candidate.submenu.items);
            }
        }
        return undefined;
    }
    append(item) {
        log("Menu.append", [item]);
        this.items.push(item);
    }
    insert(pos, item) {
        log("Menu.insert", [pos, item]);
        const index = Math.max(0, Math.min(pos, this.items.length));
        this.items.splice(index, 0, item);
    }
    popup(...args) {
        log("Menu.popup", args);
    }
}
exports.Menu = Menu;
class MenuItem {
    checked;
    click;
    enabled;
    id;
    label;
    role;
    submenu;
    type;
    visible;
    constructor(...args) {
        log("new MenuItem", args);
        const [options] = args;
        if (!options || typeof options !== "object") {
            return;
        }
        this.checked =
            typeof options.checked === "boolean" ? options.checked : undefined;
        this.click =
            typeof options.click === "function"
                ? options.click
                : undefined;
        this.enabled =
            typeof options.enabled === "boolean" ? options.enabled : undefined;
        this.id = typeof options.id === "string" ? options.id : undefined;
        this.label = typeof options.label === "string" ? options.label : undefined;
        this.role = typeof options.role === "string" ? options.role : undefined;
        this.type = typeof options.type === "string" ? options.type : undefined;
        this.visible =
            typeof options.visible === "boolean" ? options.visible : undefined;
        const submenu = options.submenu;
        if (Array.isArray(submenu)) {
            this.submenu = Menu.buildFromTemplate(submenu);
            return;
        }
        if (submenu instanceof Menu) {
            this.submenu = submenu;
        }
    }
}
exports.MenuItem = MenuItem;
class Tray {
    constructor(...args) {
        log("new Tray", args);
    }
}
exports.Tray = Tray;
class Notification {
    constructor(...args) {
        log("new Notification", args);
    }
    show() {
        log("Notification.show", []);
    }
}
exports.Notification = Notification;
const dialog = {
    async showMessageBox(...args) {
        log("dialog.showMessageBox", args);
        return { response: 0 };
    },
};
exports.dialog = dialog;
const crashReporter = {
    start(...args) {
        log("crashReporter.start", args);
    },
};
exports.crashReporter = crashReporter;
const net = {
    async fetch(input, init) {
        // log("net.fetch", [input, init]);
        if (typeof globalThis.fetch === "function") {
            return globalThis.fetch(input, init);
        }
        return new Response("", { status: 204 });
    },
    request(...args) {
        // log("net.request", args);
        const headers = new Map();
        const request = {
            setHeader(name, value) {
                // log("net.request.setHeader", [name, value]);
                headers.set(name.toLowerCase(), value);
            },
            getHeader(name) {
                // log("net.request.getHeader", [name]);
                return headers.get(name.toLowerCase());
            },
            once(event, listener) {
                // log("net.request.once", [event, listener]);
                return request;
            },
        };
        return request;
    },
};
exports.net = net;
const autoUpdater = createEmitterStub("autoUpdater");
exports.autoUpdater = autoUpdater;
const ipcMain = createIpcMainStub();
exports.ipcMain = ipcMain;
const nativeTheme = {
    ...createEmitterStub("nativeTheme"),
    shouldUseDarkColors: false,
    shouldUseHighContrastColors: false,
    shouldUseInvertedColorScheme: false,
    themeSource: "system",
};
exports.nativeTheme = nativeTheme;
const nativeImage = {
    createEmpty() {
        log("nativeImage.createEmpty", []);
        return {
            isEmpty: () => true,
        };
    },
    createFromPath(imagePath) {
        log("nativeImage.createFromPath", [imagePath]);
        return {
            isEmpty: () => !imagePath,
        };
    },
};
exports.nativeImage = nativeImage;
const powerMonitor = createEmitterStub("powerMonitor");
exports.powerMonitor = powerMonitor;
const screen = {
    ...createEmitterStub("screen"),
    getAllDisplays() {
        log("screen.getAllDisplays", []);
        return [this.getPrimaryDisplay()];
    },
    getDisplayMatching() {
        log("screen.getDisplayMatching", []);
        return this.getPrimaryDisplay();
    },
    getPrimaryDisplay() {
        log("screen.getPrimaryDisplay", []);
        return {
            id: 1,
            scaleFactor: 2,
            size: { width: 1440, height: 900 },
            workArea: { x: 0, y: 0, width: 1440, height: 900 },
            workAreaSize: { width: 1440, height: 900 },
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
        };
    },
};
exports.screen = screen;
const protocol = {
    registerSchemesAsPrivileged(...args) {
        log("protocol.registerSchemesAsPrivileged", args);
    },
    handle(...args) {
        log("protocol.handle", args);
    },
    registerStringProtocol(...args) {
        log("protocol.registerStringProtocol", args);
    },
};
exports.protocol = protocol;
function createSessionStub(label) {
    const emitter = createEmitterStub(label);
    const cookiesEmitter = createEmitterStub(`${label}.cookies`);
    return {
        cookies: {
            async get(...args) {
                log(`${label}.cookies.get`, args);
                return [];
            },
            off: cookiesEmitter.off,
            on: cookiesEmitter.on,
            once: cookiesEmitter.once,
            async remove(...args) {
                log(`${label}.cookies.remove`, args);
            },
            removeListener: cookiesEmitter.removeListener,
            async set(...args) {
                log(`${label}.cookies.set`, args);
            },
        },
        async loadExtension(extensionPath) {
            log(`${label}.loadExtension`, [extensionPath]);
            return {
                id: "stub-extension",
                name: "Stub Extension",
                path: extensionPath,
                version: "0.0.0",
            };
        },
        getUserAgent() {
            log(`${label}.getUserAgent`, []);
            return "Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36";
        },
        off: emitter.off,
        on: emitter.on,
        once: emitter.once,
        protocol,
        removeListener: emitter.removeListener,
        setPermissionCheckHandler(...args) {
            log(`${label}.setPermissionCheckHandler`, args);
        },
        setPermissionRequestHandler(...args) {
            log(`${label}.setPermissionRequestHandler`, args);
        },
        webRequest: {
            onBeforeRequest(...args) {
                log(`${label}.webRequest.onBeforeRequest`, args);
            },
            onBeforeSendHeaders(...args) {
                log(`${label}.webRequest.onBeforeSendHeaders`, args);
            },
        },
    };
}
const partitionSessions = new Map();
const session = {
    defaultSession: createSessionStub("session.defaultSession"),
    fromPartition(partition) {
        log("session.fromPartition", [partition]);
        let partitionSession = partitionSessions.get(partition);
        if (!partitionSession) {
            partitionSession = createSessionStub(`session.fromPartition(${partition})`);
            partitionSessions.set(partition, partitionSession);
        }
        return partitionSession;
    },
};
exports.session = session;
const utilityProcess = {
    fork: undefined,
};
exports.utilityProcess = utilityProcess;
const webContents = {
    fromId(id) {
        log("webContents.fromId", [id]);
        return BrowserWindow.getAllWindows().find((window) => window.webContents.id === id)?.webContents;
    },
    getAllWebContents() {
        log("webContents.getAllWebContents", []);
        return BrowserWindow.getAllWindows().map((window) => window.webContents);
    },
    getFocusedWebContents() {
        log("webContents.getFocusedWebContents", []);
        return BrowserWindow.getFocusedWindow()?.webContents ?? null;
    },
};
exports.webContents = webContents;
class MessageChannelMain {
    port1 = createMessagePortStub("MessageChannelMain.port1");
    port2 = createMessagePortStub("MessageChannelMain.port2");
}
exports.MessageChannelMain = MessageChannelMain;
const electronModule = new Proxy({
    app,
    BrowserWindow,
    ipcMain,
    autoUpdater,
    crashReporter,
    MessageChannelMain,
    Menu,
    MenuItem,
    net,
    nativeImage,
    nativeTheme,
    Notification,
    powerMonitor,
    protocol,
    screen,
    session,
    Tray,
    utilityProcess,
    WebContentsView,
    webContents,
    dialog,
}, {
    get(target, prop) {
        if (prop in target) {
            return target[prop];
        }
        return createDeepStub(`electron.${String(prop)}`);
    },
});
exports.default = electronModule;
//# sourceMappingURL=index.js.map