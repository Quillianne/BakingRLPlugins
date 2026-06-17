declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string): {
      digest(encoding: "base64"): string;
    };
  };
}

declare module "node:http" {
  import type { Socket } from "node:net";

  export type IncomingMessage = {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    socket: Socket;
    on(event: "data", listener: (chunk: Uint8Array) => void): void;
    on(event: "end", listener: () => void): void;
  };

  export type ServerResponse = {
    statusCode: number;
    setHeader(name: string, value: string | string[]): void;
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    write(chunk: string | Uint8Array): boolean;
    end(chunk?: string | Uint8Array): void;
    on(event: "close", listener: () => void): void;
  };

  export type Server = {
    listen(port: number, hostname: string, callback?: () => void): Server;
    close(callback?: (error?: Error) => void): Server;
    on(event: "error", listener: (error: Error) => void): Server;
    on(event: "upgrade", listener: (request: IncomingMessage, socket: Socket, head: Uint8Array) => void): Server;
    off(event: "error", listener: (error: Error) => void): Server;
  };

  export function createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void
  ): Server;
}

declare module "node:net" {
  export type Socket = {
    write(chunk: string | Uint8Array): boolean;
    end(chunk?: string | Uint8Array): void;
    destroy(): void;
    on(event: "close", listener: () => void): void;
  };
}
