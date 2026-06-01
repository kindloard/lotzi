import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

const CATALOG_WS_PATH = "/api/v1/realtime/catalog";
const MAX_CONNECTIONS_PER_IP = 25;
const MAX_SUBSCRIPTIONS_PER_SOCKET = 100;
const MAX_SUBSCRIBE_MESSAGES_PER_MINUTE = 60;
const HEARTBEAT_MS = 30_000;
const COALESCE_MS = 150;

interface CatalogSocketState {
  ip: string;
  isAlive: boolean;
  stores: Set<string>;
  products: Set<string>;
  subscribeWindowStartedAt: number;
  subscribeMessages: number;
}

export interface CatalogRealtimeEvent {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  storeId?: string | null;
  storePublicId?: string | null;
  productId?: string | null;
  productPublicId?: string | null;
  changedFields?: string[];
  snapshot?: Record<string, unknown>;
}

@Injectable()
export class RealtimeCatalogGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeCatalogGateway.name);
  private readonly clients = new Map<WebSocket, CatalogSocketState>();
  private readonly pendingEvents = new Map<string, CatalogRealtimeEvent>();
  private readonly connectionsByIp = new Map<string, number>();
  private server?: WebSocketServer;
  private heartbeat?: NodeJS.Timeout;
  private coalesceTimer?: NodeJS.Timeout;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: ConfigService
  ) {}

  onApplicationBootstrap() {
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer?.();
    if (!httpServer) {
      this.logger.warn("HTTP server unavailable; catalog WebSocket gateway was not attached.");
      return;
    }

    this.server = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
      if (request.url?.split("?")[0] !== CATALOG_WS_PATH) {
        return;
      }
      if (!this.isAllowedOrigin(request.headers.origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      const ip = clientIp(request);
      if ((this.connectionsByIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) {
        socket.write("HTTP/1.1 429 Too Many Requests\r\nRetry-After: 10\r\n\r\n");
        socket.destroy();
        return;
      }
      this.server?.handleUpgrade(request, socket, head, (ws) => {
        this.server?.emit("connection", ws, request);
      });
    });

    this.server.on("connection", (socket, request) => this.handleConnection(socket, request));
    this.heartbeat = setInterval(() => this.checkHeartbeats(), HEARTBEAT_MS);
    this.logger.log(`Catalog WebSocket gateway listening on ${CATALOG_WS_PATH}.`);
  }

  onModuleDestroy() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
    }
    for (const client of this.clients.keys()) {
      client.close();
    }
    this.server?.close();
  }

  broadcast(event: CatalogRealtimeEvent) {
    const key = event.productPublicId
      ? `product:${event.productPublicId}`
      : event.storePublicId
        ? `store:${event.storePublicId}`
        : event.eventId;
    this.pendingEvents.set(key, event);
    if (!this.coalesceTimer) {
      this.coalesceTimer = setTimeout(() => this.flushPendingEvents(), COALESCE_MS);
    }
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage) {
    const ip = clientIp(request);
    this.connectionsByIp.set(ip, (this.connectionsByIp.get(ip) ?? 0) + 1);
    this.clients.set(socket, {
      ip,
      isAlive: true,
      stores: new Set(),
      products: new Set(),
      subscribeMessages: 0,
      subscribeWindowStartedAt: Date.now()
    });

    socket.on("pong", () => {
      const state = this.clients.get(socket);
      if (state) {
        state.isAlive = true;
      }
    });
    socket.on("message", (message) => this.handleMessage(socket, message.toString("utf8")));
    socket.on("close", () => this.removeSocket(socket));
    socket.on("error", () => this.removeSocket(socket));
    this.send(socket, { type: "catalog.realtime.ready", heartbeatMs: HEARTBEAT_MS });
  }

  private handleMessage(socket: WebSocket, raw: string) {
    const state = this.clients.get(socket);
    if (!state || !this.consumeSubscriptionBudget(state)) {
      socket.close(4408, "subscription_rate_limited");
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(raw) as unknown;
    } catch {
      socket.close(4400, "invalid_json");
      return;
    }

    if (!isSubscribeMessage(message)) {
      return;
    }

    const stores = message.stores.map(normalizePublicId).filter(Boolean);
    const products = message.products.map(normalizeProductPublicId).filter(Boolean);
    if (stores.length + products.length > MAX_SUBSCRIPTIONS_PER_SOCKET) {
      socket.close(4408, "too_many_subscriptions");
      return;
    }

    state.stores = new Set(stores);
    state.products = new Set(products);
    this.send(socket, {
      type: "catalog.subscription.updated",
      stores: state.stores.size,
      products: state.products.size
    });
  }

  private consumeSubscriptionBudget(state: CatalogSocketState) {
    const now = Date.now();
    if (now - state.subscribeWindowStartedAt >= 60_000) {
      state.subscribeWindowStartedAt = now;
      state.subscribeMessages = 0;
    }
    state.subscribeMessages += 1;
    return state.subscribeMessages <= MAX_SUBSCRIBE_MESSAGES_PER_MINUTE;
  }

  private flushPendingEvents() {
    const events = Array.from(this.pendingEvents.values());
    this.pendingEvents.clear();
    this.coalesceTimer = undefined;

    for (const event of events) {
      const payload = {
        type: "catalog.product.changed.v1",
        event
      };
      for (const [socket, state] of this.clients) {
        if (socket.readyState !== WebSocket.OPEN) {
          continue;
        }
        const storeMatch = Boolean(event.storePublicId && state.stores.has(event.storePublicId));
        const productMatch = Boolean(event.productPublicId && state.products.has(event.productPublicId));
        if (storeMatch || productMatch) {
          this.send(socket, payload);
        }
      }
    }
  }

  private checkHeartbeats() {
    for (const [socket, state] of this.clients) {
      if (!state.isAlive) {
        socket.terminate();
        this.removeSocket(socket);
        continue;
      }
      state.isAlive = false;
      socket.ping();
    }
  }

  private removeSocket(socket: WebSocket) {
    const state = this.clients.get(socket);
    if (!state) {
      return;
    }
    this.clients.delete(socket);
    const current = this.connectionsByIp.get(state.ip) ?? 0;
    if (current <= 1) {
      this.connectionsByIp.delete(state.ip);
    } else {
      this.connectionsByIp.set(state.ip, current - 1);
    }
  }

  private send(socket: WebSocket, payload: unknown) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (socket.bufferedAmount > 512_000) {
      socket.close(4413, "backpressure_limit");
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  private isAllowedOrigin(origin: string | undefined) {
    if (!origin) {
      return true;
    }
    const configured = this.config.get<string[]>("ALLOWED_ORIGINS", [
      this.config.get<string>("FRONTEND_URL", "http://localhost:3000")
    ]);
    if (configured.includes(origin)) {
      return true;
    }
    if (this.config.get<string>("NODE_ENV") === "production") {
      return false;
    }
    try {
      const url = new URL(origin);
      return (url.protocol === "http:" || url.protocol === "https:") &&
        (url.port === "3000" || url.port === "3100") &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
    } catch {
      return false;
    }
  }
}

function isSubscribeMessage(value: unknown): value is { type: "subscribe"; stores: string[]; products: string[] } {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "subscribe" &&
    Array.isArray((value as { stores?: unknown }).stores) &&
    Array.isArray((value as { products?: unknown }).products)
  );
}

function normalizePublicId(value: string) {
  const normalized = value.trim();
  return /^\d{6}$/.test(normalized) ? normalized : "";
}

function normalizeProductPublicId(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : "";
}

function clientIp(request: IncomingMessage) {
  const forwarded = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return firstForwarded?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}
