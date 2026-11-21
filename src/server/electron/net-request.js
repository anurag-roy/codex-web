"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetRequest = void 0;
const node_stream_1 = require("node:stream");
// Electron's request is a writable stream; its response is a readable stream.
// Keep redirects manual here so preview callers can validate each destination.
class NetRequest extends node_stream_1.Writable {
    controller = new AbortController();
    headers = new Headers();
    chunks = [];
    options;
    url;
    response;
    headersSent = false;
    redirectPending = false;
    redirectAllowed = false;
    constructor(options) {
        super({ autoDestroy: false });
        this.options = typeof options === "string" ? { url: options } : options;
        const { url, protocol = "http:", hostname, host = "localhost", port, path = "/", } = this.options;
        this.url = new URL(url ?? `${protocol}//${hostname ?? host}`);
        if (!url) {
            if (port != null && Number.isFinite(port))
                this.url.port = String(port);
            const target = new URL(path, this.url);
            this.url.pathname = target.pathname;
            this.url.search = target.search;
        }
        if (!["http:", "https:"].includes(this.url.protocol)) {
            throw new TypeError("net.request only supports HTTP and HTTPS URLs");
        }
        for (const [name, value] of Object.entries(this.options.headers ?? {})) {
            for (const item of Array.isArray(value) ? value : [value]) {
                this.headers.append(name, item);
            }
        }
    }
    setHeader(name, value) {
        this.assertHeadersMutable();
        this.headers.set(name, value);
    }
    getHeader(name) {
        return this.headers.get(name) ?? undefined;
    }
    removeHeader(name) {
        this.assertHeadersMutable();
        this.headers.delete(name);
    }
    assertHeadersMutable() {
        if (this.headersSent)
            throw new Error("Request headers have already been sent");
    }
    _write(chunk, _encoding, callback) {
        this.headersSent = true;
        this.chunks.push(Buffer.from(chunk));
        callback();
    }
    _final(callback) {
        this.headersSent = true;
        callback();
        void this.send().catch((error) => {
            if (!this.destroyed)
                this.destroy(error);
        });
    }
    abort() {
        if (this.destroyed)
            return;
        this.destroy();
        this.emit("abort");
    }
    _destroy(error, callback) {
        this.controller.abort();
        this.chunks.length = 0;
        if (this.response &&
            !this.response.readableEnded &&
            !this.response.destroyed) {
            this.response.emit("aborted");
            this.response.destroy();
        }
        callback(error);
    }
    followRedirect() {
        if (!this.redirectPending)
            throw new Error("No redirect is pending");
        this.redirectAllowed = true;
    }
    async send() {
        let url = this.url;
        let method = (this.options.method ?? "GET").toUpperCase();
        let body = this.chunks.length ? Buffer.concat(this.chunks) : undefined;
        this.chunks.length = 0;
        const redirect = this.options.redirect ?? "follow";
        for (let redirects = 0; !this.destroyed; redirects++) {
            const result = await globalThis.fetch(url, {
                method,
                headers: this.headers,
                body,
                redirect: "manual",
                credentials: this.options.credentials,
                referrerPolicy: this.options.referrerPolicy,
                signal: this.controller.signal,
            });
            if (this.destroyed) {
                await result.body?.cancel();
                return;
            }
            const responseHeaders = {};
            result.headers.forEach((value, name) => {
                responseHeaders[name] = [value];
            });
            const cookies = result.headers.getSetCookie();
            if (cookies.length)
                responseHeaders["set-cookie"] = cookies;
            const location = result.headers.get("location");
            if ([301, 302, 303, 307, 308].includes(result.status) && location) {
                await result.body?.cancel();
                if (this.destroyed)
                    return;
                if (redirect === "error")
                    throw new Error("Request redirect is disallowed");
                if (redirects >= 20)
                    throw new Error("Too many request redirects");
                const next = new URL(location, url);
                if (!["http:", "https:"].includes(next.protocol))
                    throw new Error("Invalid redirect protocol");
                const nextMethod = (result.status === 303 && method !== "HEAD") ||
                    ([301, 302].includes(result.status) && method === "POST")
                    ? "GET"
                    : method;
                this.redirectAllowed =
                    redirect === "follow" && this.listenerCount("redirect") === 0;
                this.redirectPending = true;
                try {
                    this.emit("redirect", result.status, nextMethod, next.href, responseHeaders);
                }
                finally {
                    this.redirectPending = false;
                }
                if (this.destroyed)
                    return;
                if (!this.redirectAllowed) {
                    this.abort();
                    return;
                }
                if (url.origin !== next.origin) {
                    for (const name of [
                        "authorization",
                        "proxy-authorization",
                        "cookie",
                        "host",
                    ])
                        this.headers.delete(name);
                }
                if (method !== nextMethod) {
                    body = undefined;
                    for (const name of [
                        "content-type",
                        "content-length",
                        "content-encoding",
                        "content-language",
                        "content-location",
                    ])
                        this.headers.delete(name);
                }
                method = nextMethod;
                url = next;
                continue;
            }
            const response = Object.assign(result.body
                ? // Bun's fetch body stream type does not overlap node:stream/web's
                    // ReadableStream; cast through unknown for Readable.fromWeb.
                    node_stream_1.Readable.fromWeb(result.body)
                : node_stream_1.Readable.from([]), {
                statusCode: result.status,
                statusMessage: result.statusText,
                headers: responseHeaders,
            });
            this.response = response;
            response.once("error", (error) => this.destroy(error));
            response.once("end", () => this.destroy());
            this.emit("response", response);
            return;
        }
    }
}
exports.NetRequest = NetRequest;
//# sourceMappingURL=net-request.js.map