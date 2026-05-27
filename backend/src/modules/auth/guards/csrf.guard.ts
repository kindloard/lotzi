import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { requestTimer } from "../../../common/request-timing";
import { CsrfService } from "../../../security/csrf.service";
import { TokenService } from "../../../security/token.service";
import { AuthenticatedRequest } from "../auth.types";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly csrf: CsrfService,
    private readonly tokens: TokenService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return requestTimer(request).timeSync("csrf", () => this.validateRequest(request));
  }

  private validateRequest(request: AuthenticatedRequest): boolean {
    const sessionId = request.auth?.sessionId;
    if (!sessionId) {
      throw new ForbiddenException("Missing authenticated session.");
    }
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const header = request.header("x-csrf-token");
    const cookie = cookies?.[this.tokens.csrfCookieName()];
    if (!header || !cookie || header !== cookie || !this.csrf.verify(header, sessionId)) {
      throw new ForbiddenException("Invalid CSRF token.");
    }
    return true;
  }
}
