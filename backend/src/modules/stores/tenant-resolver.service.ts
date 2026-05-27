import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Request } from "express";
import { RbacEngine, StoreAuthorizationContext } from "../rbac/rbac.engine";
import { StoreRepository } from "./repositories/store.repository";

export interface TenantContext extends StoreAuthorizationContext {
  slug?: string;
}

interface RequestWithTenant extends Request {
  auth?: {
    userId: string;
    authzVersion: number;
  };
  tenant?: TenantContext;
}

@Injectable()
export class TenantResolver {
  constructor(
    private readonly stores: StoreRepository,
    private readonly rbac: RbacEngine
  ) {}

  async resolve(request: RequestWithTenant): Promise<TenantContext> {
    const auth = request.auth;
    if (!auth) {
      throw new ForbiddenException("Missing authenticated principal.");
    }

    const storeRef = this.storeRef(request);
    if (!storeRef) {
      throw new ForbiddenException("Missing store context.");
    }

    const store = storeRef.kind === "id"
      ? await this.stores.findById(storeRef.value)
      : await this.stores.findBySlug(storeRef.value);
    if (!store || store.deletedAt) {
      throw new NotFoundException("Store not found.");
    }

    const authorization = await this.rbac.storeAuthorization(
      auth.userId,
      store.id,
      auth.authzVersion
    );
    if (!authorization.isPlatformAdmin && authorization.permissions.length === 0) {
      throw new ForbiddenException("You are not a member of this store.");
    }

    const tenant = {
      ...authorization,
      slug: store.slug
    };
    request.tenant = tenant;
    return tenant;
  }

  private storeRef(request: Request): { kind: "id" | "slug"; value: string } | null {
    const params = request.params as Record<string, string | undefined>;
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const body = request.body as Record<string, unknown> | undefined;

    const paramId = params.storeId ?? params.store_id;
    if (paramId) {
      return { kind: "id", value: paramId };
    }

    const headerId = this.singleHeader(headers["x-store-id"]);
    if (headerId) {
      return { kind: "id", value: headerId };
    }

    const bodyStoreId = typeof body?.storeId === "string" ? body.storeId : undefined;
    if (bodyStoreId) {
      return { kind: "id", value: bodyStoreId };
    }

    const paramSlug = params.storeSlug ?? params.slug;
    if (paramSlug) {
      return { kind: "slug", value: paramSlug };
    }

    const headerSlug = this.singleHeader(headers["x-store-slug"]);
    if (headerSlug) {
      return { kind: "slug", value: headerSlug };
    }

    return null;
  }

  private singleHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
