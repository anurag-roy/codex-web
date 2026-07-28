import { describe, expect, test } from "bun:test";
import { renderLoginPage } from "../src/server/login-page";

describe("login page", () => {
  test("renders a passkey login link without loading app scripts", () => {
    const page = renderLoginPage(
      "https://auth.anuragroy.dev/?returnTo=https%3A%2F%2Flocal.anuragroy.dev%2F",
    );

    expect(page).toContain("Sign in to Codex");
    expect(page).toContain("Continue with passkey");
    expect(page).toContain("https://auth.anuragroy.dev/");
    expect(page).not.toContain("/__backend/ipc");
    expect(page).not.toContain("<script");
  });
});
