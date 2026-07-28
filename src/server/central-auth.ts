export const CENTRAL_AUTH_ORIGIN = "https://auth.anuragroy.dev";
export const CODEX_WEB_ORIGIN = "https://codex.anuragroy.dev";
export const LOCAL_CODEX_WEB_ORIGIN = "https://local.anuragroy.dev";

const DEFAULT_CODEX_WEB_ORIGINS = [
  CODEX_WEB_ORIGIN,
  LOCAL_CODEX_WEB_ORIGIN,
] as const;

const CENTRAL_SESSION_URL = `${CENTRAL_AUTH_ORIGIN}/api/session`;
const OWNER_USER_ID = "anuragroy11";
const SESSION_REQUEST_TIMEOUT_MS = 5_000;
const TRUSTED_APP_DOMAIN = ".anuragroy.dev";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseCentralAuthSession(value: unknown): CentralAuthSession | null {
  if (!isRecord(value) || value.authenticated !== true) {
    return null;
  }

  const { user, session } = value;
  if (!isRecord(user) || !isRecord(session)) {
    return null;
  }

  if (
    user.id !== OWNER_USER_ID ||
    !isNonEmptyString(user.email) ||
    !isNonEmptyString(user.name) ||
    !isNonEmptyString(session.id) ||
    (session.expiresAt !== null && typeof session.expiresAt !== "string")
  ) {
    return null;
  }

  if (session.expiresAt !== null) {
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }
  }

  return value as CentralAuthSession;
}

export async function getCentralAuthSession(
  cookie: string,
  fetcher: Fetcher = globalThis.fetch,
): Promise<CentralAuthSession | null> {
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
  } catch {
    return null;
  }
}

function normalizeCodexWebOrigin(value: string): string {
  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    !origin.hostname.endsWith(TRUSTED_APP_DOMAIN) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      `CODEX_WEB_ORIGINS entries must be HTTPS origins under *${TRUSTED_APP_DOMAIN}: ${value}`,
    );
  }

  return origin.origin;
}

export function getCodexWebOrigins(
  configuredOrigins: string | undefined = process.env.CODEX_WEB_ORIGINS,
): string[] {
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

function normalizedRequestHost(value: string | undefined): string | null {
  const firstValue = value?.split(",", 1)[0]?.trim();
  if (!firstValue) {
    return null;
  }

  try {
    return new URL(`https://${firstValue}`).host;
  } catch {
    return null;
  }
}

export function resolveCodexWebOrigin(
  requestUrl: string | URL,
  requestHost: string | undefined,
  allowedOrigins: readonly string[],
): string {
  if (allowedOrigins.length === 0) {
    throw new Error("At least one Codex web origin is required");
  }

  const requestUrlHost = new URL(requestUrl).host;
  const candidateHosts = new Set(
    [normalizedRequestHost(requestHost), requestUrlHost].filter(
      (host): host is string => Boolean(host),
    ),
  );

  return (
    allowedOrigins.find((origin) => candidateHosts.has(new URL(origin).host)) ??
    allowedOrigins[0]!
  );
}

export function getCentralAuthLoginUrl(
  requestUrl: string | URL,
  appOrigin: string = CODEX_WEB_ORIGIN,
): string {
  const requestedUrl = new URL(requestUrl);
  const returnTo = new URL(appOrigin);
  returnTo.pathname = requestedUrl.pathname;
  returnTo.search = requestedUrl.search;

  const loginUrl = new URL(CENTRAL_AUTH_ORIGIN);
  loginUrl.searchParams.set("returnTo", returnTo.toString());
  return loginUrl.toString();
}

export function isCodexWebOrigin(
  origin: string | undefined,
  appOrigin: string = CODEX_WEB_ORIGIN,
): boolean {
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === appOrigin;
  } catch {
    return false;
  }
}
