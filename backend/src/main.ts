import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { initRequestTiming } from "./common/request-timing";
import { RedisService } from "./modules/redis/redis.service";
import compression = require("compression");
import cookieParser = require("cookie-parser");

function isPrivateLanHostname(hostname: string) {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isAllowedDevOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const isDevProtocol = url.protocol === "http:" || url.protocol === "https:";
    const isDevPort = url.port === "3000" || url.port === "3100";
    return isDevProtocol && isDevPort && isPrivateLanHostname(url.hostname);
  } catch {
    return false;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  logAuthInfrastructure(config, app.get(RedisService));
  const allowedOrigins = config.get<string[]>("ALLOWED_ORIGINS", [
    config.get<string>("FRONTEND_URL", "http://localhost:3000")
  ]);
  const isProduction = config.get<string>("NODE_ENV") === "production";
  const isAllowedOrigin = (origin: string) =>
    allowedOrigins.includes(origin) || (!isProduction && isAllowedDevOrigin(origin));

  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void
    ) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS."));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-csrf-token",
      "x-admin-csrf",
      "x-request-id",
      "x-store-id",
      "x-device-timezone",
      "x-device-screen",
      "x-device-language"
    ],
    exposedHeaders: ["x-request-id", "x-access-expires-at", "server-timing", "Server-Timing"],
    maxAge: 600
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          connectSrc: [
            "'self'",
            ...allowedOrigins,
            "https://*.googleapis.com",
            "https://*.firebaseio.com",
            "https://identitytoolkit.googleapis.com",
            "https://securetoken.googleapis.com"
          ],
          imgSrc: ["'self'", "data:", "https:"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: isProduction ? [] : null
        }
      },
      referrerPolicy: { policy: "no-referrer" }
    })
  );
  app.use(cookieParser());
  app.use(compression({ threshold: 1024 }));
  app.use((request: Request, _response: Response, next: NextFunction) => {
    initRequestTiming(request);
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const stateChanging = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
    const origin = request.header("origin");
    if (stateChanging && origin && !isAllowedOrigin(origin)) {
      response.status(403).json({ message: "Origin is not allowed." });
      return;
    }
    next();
  });
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    const requestId = request.header("x-request-id") ?? randomUUID();
    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.use(
    pinoHttp({
      genReqId: (request) => request.headers["x-request-id"]?.toString() ?? randomUUID(),
      redact: ["req.headers.cookie", "req.headers.authorization"]
    })
  );

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  const port = Number(config.get<number | string>("PORT", 4000));
  const host = config.get<string>("HOST", "0.0.0.0");
  await listenOrReportPortConflict(app, port, host);
}

void bootstrap();

async function listenOrReportPortConflict(app: INestApplication, port: number, host: string) {
  try {
    await app.listen(port, host);
  } catch (error) {
    if (!isAddressInUseError(error)) {
      throw error;
    }

    console.error(
      JSON.stringify({
        event: "server.listen_failed",
        code: "EADDRINUSE",
        address: host,
        port,
        message: `Backend port ${port} is already in use.`,
        hint: `Stop the existing backend process or start this service with PORT=<free-port>.`
      })
    );
    await app.close();
    process.exitCode = 1;
  }
}

function isAddressInUseError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE");
}

function logAuthInfrastructure(config: ConfigService, redis: RedisService) {
  const databaseUrl = config.get<string>("DATABASE_URL", "");
  const redisUrl = config.get<string>("REDIS_URL");
  const db = safeUrl(databaseUrl);
  const poolMode = databaseUrl.includes("pgbouncer=true")
    ? "pgbouncer-compatible"
    : databaseUrl.includes("pooler")
      ? "pooler"
      : "direct-or-session";

  console.log(
    JSON.stringify({
      event: "auth.infrastructure",
      dbHost: db?.host ?? "unknown",
      dbPoolMode: poolMode,
      redisConfigured: Boolean(redisUrl),
      redisClientEnabled: redis.isConfigured,
      authCacheMode: redis.isConfigured ? "redis" : "in-process-fallback"
    })
  );
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
