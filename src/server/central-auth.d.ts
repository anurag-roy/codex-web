export declare const CENTRAL_AUTH_ORIGIN = "https://auth.anuragroy.dev";
export declare const CODEX_WEB_ORIGIN = "https://codex.anuragroy.dev";
export declare const LOCAL_CODEX_WEB_ORIGIN = "https://local.anuragroy.dev";
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type CentralAuthSession = {
    authenticated: true;
    user: {
        id: string;
        email: string;
        name: string;
    };
    session: {
        id: string;
        expiresAt: string | null;
    };
};
export declare function getCentralAuthSession(cookie: string, fetcher?: Fetcher): Promise<CentralAuthSession | null>;
export declare function getCodexWebOrigins(configuredOrigins?: string | undefined): string[];
export declare function resolveCodexWebOrigin(requestUrl: string | URL, requestHost: string | undefined, allowedOrigins: readonly string[]): string;
export declare function getCentralAuthLoginUrl(requestUrl: string | URL, appOrigin?: string): string;
export declare function isCodexWebOrigin(origin: string | undefined, appOrigin?: string): boolean;
export {};
//# sourceMappingURL=central-auth.d.ts.map