import { HttpException, HttpStatus } from "@nestjs/common";

export interface PaymentErrorBody {
  apiVersion: "v1";
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  details?: Record<string, unknown>;
}

export class PaymentApiException extends HttpException {
  constructor(status: HttpStatus, body: Omit<PaymentErrorBody, "apiVersion">) {
    super({ apiVersion: "v1", ...body }, status);
  }
}

export function paymentError(
  status: HttpStatus,
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
  retryAfterSeconds?: number
) {
  return new PaymentApiException(status, {
    code,
    message,
    retryable,
    details,
    retryAfterSeconds
  });
}
