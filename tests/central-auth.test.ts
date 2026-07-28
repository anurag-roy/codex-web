import { describe, expect, test } from "bun:test";
import {
  CENTRAL_AUTH_ORIGIN,
  CODEX_WEB_ORIGIN,
  LOCAL_CODEX_WEB_ORIGIN,
  getCentralAuthLoginUrl,
  getCentralAuthSession,
  getCodexWebOrigins,
  isCodexWebOrigin,
  resolveCodexWebOrigin,
} from "../src/server/central-auth";

const validSession = {
  authenticated: true,
  user: {
    id: "anuragroy11",
    email: "anuragroy11@icloud.com",
    name: "Anurag Roy",
  },
  session: {
    id: "session-id",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

describe("central auth", () => {
  test("forwards the incoming cookie and accepts the owner session", async () => {
    let forwardedCookie: string | null = null;
    const session = await getCentralAuthSession(
      "better-auth.session_token=secret",
      async (input, init) => {
        expect(String(input)).toBe(`${CENTRAL_AUTH_ORIGIN}/api/session`);
        forwardedCookie = new Headers(init?.headers).get("cookie");
        return Response.json(validSession);
      },
    );

    expect(forwardedCookie).toBe("better-auth.session_token=secret");
    expect(session).toEqual(validSession);
  });

  test("rejects a session for any other user", async () => {
    const session = await getCentralAuthSession("cookie=value", async () =>
      Response.json({
        ...validSession,
        user: { ...validSession.user, id: "someone-else" },
      }),
    );

    expect(session).toBeNull();
  });

  test("fails closed when the central service rejects the cookie", async () => {
    const session = await getCentralAuthSession("cookie=value", async () =>
      Response.json({ authenticated: false }, { status: 401 }),
    );

    expect(session).toBeNull();
  });

  test("rejects an expired central session", async () => {
    const session = await getCentralAuthSession("cookie=value", async () =>
      Response.json({
        ...validSession,
        session: {
          ...validSession.session,
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(session).toBeNull();
  });

  test("builds return URLs from the selected app origin", () => {
    const loginUrl = new URL(
      getCentralAuthLoginUrl(
        "http://backend.internal/thread/123?mode=review",
        LOCAL_CODEX_WEB_ORIGIN,
      ),
    );

    expect(loginUrl.origin).toBe(CENTRAL_AUTH_ORIGIN);
    expect(loginUrl.searchParams.get("returnTo")).toBe(
      `${LOCAL_CODEX_WEB_ORIGIN}/thread/123?mode=review`,
    );
  });

  test("resolves only an explicitly allowed request host", () => {
    const origins = getCodexWebOrigins("");

    expect(
      resolveCodexWebOrigin(
        "http://127.0.0.1/thread/123",
        "local.anuragroy.dev",
        origins,
      ),
    ).toBe(LOCAL_CODEX_WEB_ORIGIN);
    expect(
      resolveCodexWebOrigin(
        "http://127.0.0.1/thread/123",
        "attacker.example",
        origins,
      ),
    ).toBe(CODEX_WEB_ORIGIN);
  });

  test("supports an explicit deployment origin allowlist", () => {
    expect(getCodexWebOrigins(LOCAL_CODEX_WEB_ORIGIN)).toEqual([
      LOCAL_CODEX_WEB_ORIGIN,
    ]);
    expect(() => getCodexWebOrigins("https://attacker.example")).toThrow();
  });

  test("only accepts the exact Codex app origin", () => {
    expect(isCodexWebOrigin(CODEX_WEB_ORIGIN)).toBe(true);
    expect(isCodexWebOrigin(`${CODEX_WEB_ORIGIN}/path`)).toBe(true);
    expect(
      isCodexWebOrigin(LOCAL_CODEX_WEB_ORIGIN, LOCAL_CODEX_WEB_ORIGIN),
    ).toBe(true);
    expect(isCodexWebOrigin(CODEX_WEB_ORIGIN, LOCAL_CODEX_WEB_ORIGIN)).toBe(
      false,
    );
    expect(isCodexWebOrigin("https://x.anuragroy.dev")).toBe(false);
    expect(isCodexWebOrigin(undefined)).toBe(false);
  });
});
