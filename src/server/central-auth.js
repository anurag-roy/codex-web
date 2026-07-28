"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_CODEX_WEB_ORIGIN = exports.CODEX_WEB_ORIGIN = exports.CENTRAL_AUTH_ORIGIN = void 0;
exports.getCentralAuthSession = getCentralAuthSession;
exports.getCodexWebOrigins = getCodexWebOrigins;
exports.resolveCodexWebOrigin = resolveCodexWebOrigin;
exports.getCentralAuthLoginUrl = getCentralAuthLoginUrl;
exports.isCodexWebOrigin = isCodexWebOrigin;
exports.CENTRAL_AUTH_ORIGIN = "https://auth.anuragroy.dev";
exports.CODEX_WEB_ORIGIN = "https://codex.anuragroy.dev";
exports.LOCAL_CODEX_WEB_ORIGIN = "https://local.anuragroy.dev";
const DEFAULT_CODEX_WEB_ORIGINS = [
    exports.CODEX_WEB_ORIGIN,
    exports.LOCAL_CODEX_WEB_ORIGIN,
];
const CENTRAL_SESSION_URL = `${exports.CENTRAL_AUTH_ORIGIN}/api/session`;
const OWNER_USER_ID = "anuragroy11";
const SESSION_REQUEST_TIMEOUT_MS = 5_000;
const TRUSTED_APP_DOMAIN = ".anuragroy.dev";
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
}
function parseCentralAuthSession(value) {
    if (!isRecord(value) || value.authenticated !== true) {
        return null;
    }
    const { user, session } = value;
    if (!isRecord(user) || !isRecord(session)) {
        return null;
    }
    if (user.id !== OWNER_USER_ID ||
        !isNonEmptyString(user.email) ||
        !isNonEmptyString(user.name) ||
        !isNonEmptyString(session.id) ||
        (session.expiresAt !== null && typeof session.expiresAt !== "string")) {
        return null;
    }
    if (session.expiresAt !== null) {
        const expiresAt = Date.parse(session.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            return null;
        }
    }
    return value;
}
async function getCentralAuthSession(cookie, fetcher = globalThis.fetch) {
    if (!cookie) {
        return null;
    }
    try {
        const response = await fetcher(CENTRAL_SESSION_URL, {
            cache: "no-store",
            headers: {
                accept: "application/json",
                cookie,
            },
            redirect: "manual",
            signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
            return null;
        }
        return parseCentralAuthSession(await response.json());
    }
    catch {
        return null;
    }
}
function normalizeCodexWebOrigin(value) {
    const origin = new URL(value);
    if (origin.protocol !== "https:" ||
        !origin.hostname.endsWith(TRUSTED_APP_DOMAIN) ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash) {
        throw new Error(`CODEX_WEB_ORIGINS entries must be HTTPS origins under *${TRUSTED_APP_DOMAIN}: ${value}`);
    }
    return origin.origin;
}
function getCodexWebOrigins(configuredOrigins = process.env.CODEX_WEB_ORIGINS) {
    const values = configuredOrigins
        ? configuredOrigins.split(",").map((value) => value.trim())
        : [...DEFAULT_CODEX_WEB_ORIGINS];
    const origins = [
        ...new Set(values.filter(Boolean).map(normalizeCodexWebOrigin)),
    ];
    if (origins.length === 0) {
        throw new Error("CODEX_WEB_ORIGINS must contain at least one origin");
    }
    return origins;
}
function normalizedRequestHost(value) {
    const firstValue = value?.split(",", 1)[0]?.trim();
    if (!firstValue) {
        return null;
    }
    try {
        return new URL(`https://${firstValue}`).host;
    }
    catch {
        return null;
    }
}
function resolveCodexWebOrigin(requestUrl, requestHost, allowedOrigins) {
    if (allowedOrigins.length === 0) {
        throw new Error("At least one Codex web origin is required");
    }
    const requestUrlHost = new URL(requestUrl).host;
    const candidateHosts = new Set([normalizedRequestHost(requestHost), requestUrlHost].filter((host) => Boolean(host)));
    return (allowedOrigins.find((origin) => candidateHosts.has(new URL(origin).host)) ??
        allowedOrigins[0]);
}
function getCentralAuthLoginUrl(requestUrl, appOrigin = exports.CODEX_WEB_ORIGIN) {
    const requestedUrl = new URL(requestUrl);
    const returnTo = new URL(appOrigin);
    returnTo.pathname = requestedUrl.pathname;
    returnTo.search = requestedUrl.search;
    const loginUrl = new URL(exports.CENTRAL_AUTH_ORIGIN);
    loginUrl.searchParams.set("returnTo", returnTo.toString());
    return loginUrl.toString();
}
function isCodexWebOrigin(origin, appOrigin = exports.CODEX_WEB_ORIGIN) {
    if (!origin) {
        return false;
    }
    try {
        return new URL(origin).origin === appOrigin;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=central-auth.js.map