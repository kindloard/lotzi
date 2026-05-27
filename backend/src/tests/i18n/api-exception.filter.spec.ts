import { BadRequestException, ForbiddenException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { normalizeException } from "@/common/api-exception.filter";

describe("ApiExceptionFilter i18n error contract", () => {
  it("preserves stable codes and params from object responses", () => {
    const error = new BadRequestException({
      code: "PRODUCT_SKU_EXISTS",
      message: "A product with this SKU already exists.",
      params: { sku: "ABC-1" }
    });

    expect(normalizeException(error, HttpStatus.BAD_REQUEST)).toEqual({
      code: "PRODUCT_SKU_EXISTS",
      message: "A product with this SKU already exists.",
      params: { sku: "ABC-1" }
    });
  });

  it("maps legacy auth exceptions to frontend translation codes", () => {
    const error = new UnauthorizedException("Invalid credentials.");

    expect(normalizeException(error, HttpStatus.UNAUTHORIZED)).toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Invalid credentials."
    });
  });

  it("maps CSRF failures to CSRF_INVALID", () => {
    const error = new ForbiddenException("Invalid CSRF token.");

    expect(normalizeException(error, HttpStatus.FORBIDDEN)).toMatchObject({
      code: "CSRF_INVALID",
      message: "Invalid CSRF token."
    });
  });

  it("normalizes validation arrays into fieldErrors", () => {
    const error = new BadRequestException({
      message: ["email must be an email"],
      error: "Bad Request",
      statusCode: 400
    });

    expect(normalizeException(error, HttpStatus.BAD_REQUEST)).toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: [{ code: "VALIDATION_FAILED", message: "email must be an email", path: "form" }]
    });
  });

  it("sanitizes Prisma schema drift errors", () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "The column `products.unit_group` does not exist in the current database.",
      { code: "P2022", clientVersion: "5.20.0" }
    );

    expect(normalizeException(error, HttpStatus.SERVICE_UNAVAILABLE)).toEqual({
      code: "DATABASE_SCHEMA_OUT_OF_DATE",
      message: "Database schema is out of date. Run the latest migrations or product catalog repair before retrying."
    });
  });
});
