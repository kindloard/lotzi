import { ConflictException, UnauthorizedException } from "@nestjs/common";

export const AUTH_ACCESS_MISSING = "AUTH_ACCESS_MISSING";
export const AUTH_ACCESS_INVALID = "AUTH_ACCESS_INVALID";
export const AUTH_REFRESH_MISSING = "AUTH_REFRESH_MISSING";
export const AUTH_REFRESH_INVALID = "AUTH_REFRESH_INVALID";
export const AUTH_REFRESH_RACE = "AUTH_REFRESH_RACE";

export type AuthErrorCode =
  | typeof AUTH_ACCESS_MISSING
  | typeof AUTH_ACCESS_INVALID
  | typeof AUTH_REFRESH_MISSING
  | typeof AUTH_REFRESH_INVALID
  | typeof AUTH_REFRESH_RACE;

export function authUnauthorized(code: Exclude<AuthErrorCode, typeof AUTH_REFRESH_RACE>, message: string) {
  return new UnauthorizedException({
    apiVersion: "v1",
    code,
    message
  });
}

export function authRefreshRace(message = "Refresh already rotated in this session.") {
  return new ConflictException({
    apiVersion: "v1",
    code: AUTH_REFRESH_RACE,
    message
  });
}
