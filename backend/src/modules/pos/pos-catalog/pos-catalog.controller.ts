import { BadRequestException, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "@/modules/auth/auth.types";
import { AccessTokenGuard } from "@/modules/auth/guards/access-token.guard";
import { PosCatalogService } from "./pos-catalog.service";

@Controller("v1/stores/:storeId/pos/catalog")
@UseGuards(AccessTokenGuard)
export class PosCatalogController {
  constructor(private readonly posCatalogService: PosCatalogService) {}

  @Post("sync")
  syncCatalog(
    @Req() request: AuthenticatedRequest,
    @Param("storeId") storeId: string
  ) {
    return this.posCatalogService.syncStoreCatalog(request.auth!, storeId);
  }

  @Get()
  listCatalog(
    @Req() request: AuthenticatedRequest,
    @Param("storeId") storeId: string,
    @Query("q") query?: string,
    @Query("limit") limit?: string
  ) {
    return this.posCatalogService.listProducts(request.auth!, storeId, {
      query,
      limit: parseOptionalLimit(limit)
    });
  }

  @Get("search")
  searchCatalog(
    @Req() request: AuthenticatedRequest,
    @Param("storeId") storeId: string,
    @Query("q") query = "",
    @Query("limit") limit?: string
  ) {
    return this.posCatalogService.searchProducts(
      request.auth!,
      storeId,
      query,
      parseOptionalLimit(limit)
    );
  }
}

function parseOptionalLimit(value?: string) {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BadRequestException({
      apiVersion: "v1",
      code: "POS_CATALOG_LIMIT_INVALID",
      message: "limit must be a positive integer."
    });
  }
  return limit;
}
