import { Writable } from "node:stream";
type RequestOptions = {
    url?: string;
    protocol?: string;
    host?: string;
    hostname?: string;
    port?: number;
    path?: string;
    method?: string;
    headers?: Record<string, string | string[]>;
    redirect?: RequestRedirect;
    credentials?: RequestCredentials;
    referrerPolicy?: ReferrerPolicy;
};
export declare class NetRequest extends Writable {
    private readonly controller;
    private readonly headers;
    private readonly chunks;
    private readonly options;
    private readonly url;
    private response?;
    private headersSent;
    private redirectPending;
    private redirectAllowed;
    constructor(options: string | RequestOptions);
    setHeader(name: string, value: string): void;
    getHeader(name: string): string | undefined;
    removeHeader(name: string): void;
    private assertHeadersMutable;
    _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
    _final(callback: (error?: Error | null) => void): void;
    abort(): void;
    _destroy(error: Error | null, callback: (error?: Error | null) => void): void;
    followRedirect(): void;
    private send;
}
export {};
//# sourceMappingURL=net-request.d.ts.map