import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { requestTimer } from "../../common/request-timing";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator";

interface AuthenticatedRequest extends Request {
  auth?: {
    permissions: string[];
  };
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return requestTimer(request).timeSync("rbac", () => this.validateRequest(context, request));
  }

  private validateRequest(context: ExecutionContext, request: AuthenticatedRequest): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass()
      ]) ?? [];

    if (required.length === 0) {
      return true;
    }

    const actual = new Set(request.auth?.permissions ?? []);
    const allowed = required.every((permission) => actual.has(permission));
    if (!allowed) {
      throw new ForbiddenException("Insufficient permissions.");
    }
    return true;
  }
}
