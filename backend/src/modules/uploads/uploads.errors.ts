import { HttpException, HttpStatus } from "@nestjs/common";

export interface V1ErrorBody {
  apiVersion: "v1";
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  details?: Record<string, unknown>;
}

export class V1ApiException extends HttpException {
  constructor(status: HttpStatus, body: Omit<V1ErrorBody, "apiVersion">) {
    super({ apiVersion: "v1", ...body }, status);
  }
}

export function uploadError(
  status: HttpStatus,
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>
) {
  return new V1ApiException(status, { code, message, retryable, details });
}
