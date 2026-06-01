import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";

export interface ApiFieldError {
  path: string;
  code: string;
  message: string;
  params?: Record<string, number | string>;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  params?: Record<string, number | string>;
  fieldErrors?: ApiFieldError[];
  details?: unknown;
  retryable?: boolean;
  retryAfterSeconds?: number;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & { requestId?: string }>();
    const status = statusForException(exception);
    const body = normalizeException(exception, status);

    response.status(status).json({
      ...body,
      requestId: request.requestId
    });
  }
}

export function normalizeException(exception: unknown, status: number): ApiErrorResponse {
  if (isDatabaseSchemaDriftError(exception)) {
    return {
      code: "DATABASE_SCHEMA_OUT_OF_DATE",
      message: "Database schema is out of date. Run the latest migrations or product catalog repair before retrying."
    };
  }

  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === "object" && response !== null) {
      const candidate = response as Record<string, unknown>;
      const message = messageFromUnknown(candidate.message) ?? exception.message;
      const code = typeof candidate.code === "string" ? candidate.code : codeFor(status, message);
      const fieldErrors = fieldErrorsFromUnknown(candidate.fieldErrors ?? candidate.errors ?? (Array.isArray(candidate.message) ? candidate.message : undefined));
      const params = paramsFromUnknown(candidate.params);
      const details = "details" in candidate ? candidate.details : undefined;
      const retryable = typeof candidate.retryable === "boolean" ? candidate.retryable : undefined;
      const retryAfterSeconds = numberFromUnknown(candidate.retryAfterSeconds);

      return {
        code,
        message,
        ...(params ? { params } : {}),
        ...(fieldErrors.length > 0 ? { fieldErrors } : {}),
        ...(details !== undefined ? { details } : {}),
        ...(retryable !== undefined ? { retryable } : {}),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
      };
    }

    const message = typeof response === "string" ? response : exception.message;
    return { code: codeFor(status, message), message };
  }

  const message = exception instanceof Error ? exception.message : "Internal server error.";
  return {
    code: "INTERNAL_SERVER_ERROR",
    message
  };
}

function messageFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value[0] ?? null;
  }
  return null;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fieldErrorsFromUnknown(value: unknown): ApiFieldError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [{ path: "form", code: "VALIDATION_FAILED", message: item }];
    }
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const path = typeof candidate.path === "string" ? candidate.path : "form";
    const message = typeof candidate.message === "string" ? candidate.message : "Invalid value.";
    const code = typeof candidate.code === "string" ? candidate.code : "VALIDATION_FAILED";
    const params = paramsFromUnknown(candidate.params);
    return [{ path, code, message, ...(params ? { params } : {}) }];
  });
}

function paramsFromUnknown(value: unknown): Record<string, number | string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const params: Record<string, number | string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" || typeof child === "number") {
      params[key] = child;
    }
  }
  return Object.keys(params).length > 0 ? params : null;
}

function codeFor(status: number, message: string): string {
  const normalized = message.toLowerCase();
  if (status === HttpStatus.UNAUTHORIZED && normalized.includes("credential")) {
    return "AUTH_INVALID_CREDENTIALS";
  }
  if (status === HttpStatus.UNAUTHORIZED && normalized.includes("verification code")) {
    return "AUTH_OTP_INVALID";
  }
  if (status === HttpStatus.UNAUTHORIZED && normalized.includes("reset token")) {
    return "AUTH_RESET_TOKEN_INVALID";
  }
  if (status === HttpStatus.UNAUTHORIZED) {
    return "UNAUTHORIZED";
  }
  if (status === HttpStatus.FORBIDDEN && normalized.includes("csrf")) {
    return "CSRF_INVALID";
  }
  if (status === HttpStatus.FORBIDDEN) {
    return "FORBIDDEN";
  }
  if (status === HttpStatus.NOT_FOUND) {
    return "NOT_FOUND";
  }
  if (status === HttpStatus.CONFLICT) {
    return "CONFLICT";
  }
  if (status === HttpStatus.TOO_MANY_REQUESTS) {
    return "RATE_LIMITED";
  }
  if (status === HttpStatus.BAD_REQUEST) {
    return "VALIDATION_FAILED";
  }
  return status >= 500 ? "INTERNAL_SERVER_ERROR" : "GENERIC";
}

function statusForException(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (isDatabaseSchemaDriftError(exception)) {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function isDatabaseSchemaDriftError(exception: unknown): boolean {
  return (
    exception instanceof Prisma.PrismaClientKnownRequestError &&
    (exception.code === "P2021" || exception.code === "P2022")
  );
}
