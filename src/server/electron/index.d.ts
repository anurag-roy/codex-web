type StubListener = (...args: unknown[]) => void;
declare const appBase: {
    name: string;
    isPackaged: boolean;
    getName(): string;
    getVersion(): string;
    getLocale(): string;
    getSystemLocale(): string;
    getPreferredSystemLanguages(): string[];
    getPath(name: string): string;
    getAppMetrics(): unknown[];
    getAppPath(): string;
    getGPUInfo(infoLevel: string): Promise<{
        gpuDevice: unknown[];
    }>;
    setName(name: string): void;
    setPath(name: string, value: string): void;
    setAppUserModelId(value: string): void;
    requestSingleInstanceLock(): boolean;
    isReady(): boolean;
    whenReady(): Promise<void>;
    commandLine: {
        appendSwitch(name: string, value?: string): void;
        appendArgument(value: string): void;
        getSwitchValue(name: string): string;
        hasSwitch(name: string): boolean;
        removeSwitch(name: string): void;
    };
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    once(event: string, listener: (...args: unknown[]) => void): unknown;
    quit(): void;
    exit(code?: number): void;
    addListener: (event: string, listener: StubListener) => unknown;
    emit: (event: string, ...args: unknown[]) => boolean;
    off: (event: string, listener: StubListener) => unknown;
    removeListener: (event: string, listener: StubListener) => unknown;
};
declare const app: typeof appBase;
declare class BrowserWindow {
    static nextId: number;
    static allWindows: BrowserWindow[];
    static focusedWindow: BrowserWindow | null;
    id: number;
    private destroyed;
    private title;
    private bounds;
    webContents: Record<string, unknown>;
    private readonly emitter;
    constructor(...args: unknown[]);
    static getAllWindows(): BrowserWindow[];
    static getFocusedWindow(): BrowserWindow | null;
    static fromWebContents(webContents: {
        id?: unknown;
    } | null | undefined): BrowserWindow | null;
    on(event: string, listener: StubListener): unknown;
    once(event: string, listener: StubListener): unknown;
    off(event: string, listener: StubListener): unknown;
    removeListener(event: string, listener: StubListener): unknown;
    close(): void;
    destroy(): void;
    isDestroyed(): boolean;
    isFocused(): boolean;
    removeMenu(): void;
    getTitle(): string;
    setTitle(nextTitle: string): void;
    getBounds(): {
        height: number;
        width: number;
        x: number;
        y: number;
    };
    setBounds(nextBounds: {
        height?: number;
        width?: number;
        x?: number;
        y?: number;
    }): void;
    show(): void;
    hide(): void;
    focus(): void;
}
declare class WebContentsView {
    constructor(...args: unknown[]);
}
declare class Menu {
    static applicationMenu: Menu | null;
    items: MenuItem[];
    constructor(items?: MenuItem[]);
    static buildFromTemplate(template: unknown[]): Menu;
    static setApplicationMenu(menu: Menu | null): void;
    static getApplicationMenu(): Menu | null;
    getMenuItemById(id: string): MenuItem | undefined;
    append(item: MenuItem): void;
    insert(pos: number, item: MenuItem): void;
    popup(...args: unknown[]): void;
}
declare class MenuItem {
    checked?: boolean;
    click?: (...args: unknown[]) => unknown;
    enabled?: boolean;
    id?: string;
    label?: string;
    role?: string;
    submenu?: Menu;
    type?: string;
    visible?: boolean;
    constructor(...args: unknown[]);
}
declare class Tray {
    constructor(...args: unknown[]);
}
declare class Notification {
    constructor(...args: unknown[]);
    show(): void;
}
declare const dialog: {
    showMessageBox(...args: unknown[]): Promise<{
        response: number;
    }>;
};
declare const crashReporter: {
    start(...args: unknown[]): void;
};
declare const net: {
    fetch(input: string | URL, init?: RequestInit): Promise<Response>;
    request(...args: unknown[]): {
        getHeader: (name: string) => string | undefined;
        once: (event: string, listener: StubListener) => unknown;
        setHeader: (name: string, value: string) => void;
    };
};
declare const autoUpdater: {
    addListener: (event: string, listener: StubListener) => unknown;
    emit: (event: string, ...args: unknown[]) => boolean;
    off: (event: string, listener: StubListener) => unknown;
    on: (event: string, listener: StubListener) => unknown;
    once: (event: string, listener: StubListener) => unknown;
    removeListener: (event: string, listener: StubListener) => unknown;
};
declare const ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void;
    off: (event: string, listener: StubListener) => unknown;
    on: (event: string, listener: StubListener) => unknown;
    removeHandler: (channel: string) => void;
};
declare const nativeTheme: {
    shouldUseDarkColors: boolean;
    shouldUseHighContrastColors: boolean;
    shouldUseInvertedColorScheme: boolean;
    themeSource: string;
    addListener: (event: string, listener: StubListener) => unknown;
    emit: (event: string, ...args: unknown[]) => boolean;
    off: (event: string, listener: StubListener) => unknown;
    on: (event: string, listener: StubListener) => unknown;
    once: (event: string, listener: StubListener) => unknown;
    removeListener: (event: string, listener: StubListener) => unknown;
};
declare const nativeImage: {
    createEmpty(): {
        isEmpty: () => boolean;
    };
    createFromPath(imagePath: string): {
        isEmpty: () => boolean;
    };
};
declare const powerMonitor: {
    addListener: (event: string, listener: StubListener) => unknown;
    emit: (event: string, ...args: unknown[]) => boolean;
    off: (event: string, listener: StubListener) => unknown;
    on: (event: string, listener: StubListener) => unknown;
    once: (event: string, listener: StubListener) => unknown;
    removeListener: (event: string, listener: StubListener) => unknown;
};
declare const screen: {
    getAllDisplays(): Array<{
        id: number;
        scaleFactor: number;
        size: {
            height: number;
            width: number;
        };
        workArea: {
            height: number;
            width: number;
            x: number;
            y: number;
        };
        workAreaSize: {
            height: number;
            width: number;
        };
        bounds: {
            height: number;
            width: number;
            x: number;
            y: number;
        };
    }>;
    getDisplayMatching(): {
        id: number;
        scaleFactor: number;
        size: {
            height: number;
            width: number;
        };
        workArea: {
            height: number;
            width: number;
            x: number;
            y: number;
        };
        workAreaSize: {
            height: number;
            width: number;
        };
        bounds: {
            height: number;
            width: number;
            x: number;
            y: number;
        };
    };
    getPrimaryDisplay(): {
        id: number;
        scaleFactor: number;
        size: {
            height: number;
            width: number;
        };
        workArea: {
            height: number;
            width: number;
            x: number;
            y: number;
        };
        workAreaSize: {
            height: number;
            width: number;
        };
        bounds: {
            height: number;
            width: number;
            x: number;
            y: number;
        };
    };
    addListener: (event: string, listener: StubListener) => unknown;
    emit: (event: string, ...args: unknown[]) => boolean;
    off: (event: string, listener: StubListener) => unknown;
    on: (event: string, listener: StubListener) => unknown;
    once: (event: string, listener: StubListener) => unknown;
    removeListener: (event: string, listener: StubListener) => unknown;
};
declare const protocol: {
    registerSchemesAsPrivileged(...args: unknown[]): void;
    handle(...args: unknown[]): void;
    registerStringProtocol(...args: unknown[]): void;
};
declare function createSessionStub(label: string): {
    getUserAgent: () => string;
    loadExtension: (extensionPath: string) => Promise<{
        id: string;
        name: string;
        path: string;
        version: string;
    }>;
    off: (event: string, listener: StubListener) => unknown;
    on: (event: string, listener: StubListener) => unknown;
    once: (event: string, listener: StubListener) => unknown;
    protocol: typeof protocol;
    removeListener: (event: string, listener: StubListener) => unknown;
    setPermissionCheckHandler: (...args: unknown[]) => void;
    setPermissionRequestHandler: (...args: unknown[]) => void;
    webRequest: {
        onBeforeRequest: (...args: unknown[]) => void;
        onBeforeSendHeaders: (...args: unknown[]) => void;
    };
};
declare const session: {
    defaultSession: {
        getUserAgent: () => string;
        loadExtension: (extensionPath: string) => Promise<{
            id: string;
            name: string;
            path: string;
            version: string;
        }>;
        off: (event: string, listener: StubListener) => unknown;
        on: (event: string, listener: StubListener) => unknown;
        once: (event: string, listener: StubListener) => unknown;
        protocol: typeof protocol;
        removeListener: (event: string, listener: StubListener) => unknown;
        setPermissionCheckHandler: (...args: unknown[]) => void;
        setPermissionRequestHandler: (...args: unknown[]) => void;
        webRequest: {
            onBeforeRequest: (...args: unknown[]) => void;
            onBeforeSendHeaders: (...args: unknown[]) => void;
        };
    };
    fromPartition(partition: string): ReturnType<typeof createSessionStub>;
};
declare const utilityProcess: {
    fork: undefined;
};
declare const webContents: {
    fromId(id: number): Record<string, unknown> | undefined;
    getAllWebContents(): Record<string, unknown>[];
    getFocusedWebContents(): Record<string, unknown> | null;
};
declare class MessageChannelMain {
    port1: {
        on: (event: string, listener: StubListener) => unknown;
        postMessage: (...args: unknown[]) => void;
        start: () => void;
    };
    port2: {
        on: (event: string, listener: StubListener) => unknown;
        postMessage: (...args: unknown[]) => void;
        start: () => void;
    };
}
declare const electronModule: Record<string, unknown>;
export { app, autoUpdater, BrowserWindow, ipcMain, Menu, MenuItem, MessageChannelMain, net, nativeImage, nativeTheme, Notification, powerMonitor, protocol, screen, session, Tray, utilityProcess, WebContentsView, webContents, crashReporter, dialog, };
export default electronModule;
//# sourceMappingURL=index.d.ts.map