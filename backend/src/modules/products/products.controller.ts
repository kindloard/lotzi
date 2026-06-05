import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { Response } from "express";
import { RequestTimer, requestTimer } from "../../common/request-timing";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import {
  CreateProductDto,
  ReorderProductImagesDto,
  ReplaceProductImageDto,
  UpdateProductDto
} from "./dto/products.dto";
import { ProductsService } from "./products.service";

@Controller("v1/merchant/products")
@UseGuards(AccessTokenGuard)
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query("storeId") storeId?: string) {
    return this.products.list(request.auth!, storeIdFromRequest(request, storeId));
  }

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: CreateProductDto
  ) {
    const timer = requestTimer(request);
    const idempotencyKey = request.header("Idempotency-Key") ?? request.header("idempotency-key");
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        apiVersion: "v1",
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key is required for product creation.",
        retryable: false
      });
    }
    try {
      return await this.products.create(request.auth!, dto, idempotencyKey.trim(), timer);
    } finally {
      this.finishProductTiming("product.create", request, response, timer);
    }
  }

  @Patch(":productId")
  @UseGuards(CsrfGuard)
  async update(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("productId") productId: string,
    @Body() dto: UpdateProductDto
  ) {
    const timer = requestTimer(request);
    try {
      return await this.products.update(request.auth!, productId, dto, timer);
    } finally {
      this.finishProductTiming("product.update", request, response, timer);
    }
  }

  @Patch(":productId/images/order")
  @UseGuards(CsrfGuard)
  reorderImages(
    @Req() request: AuthenticatedRequest,
    @Param("productId") productId: string,
    @Body() dto: ReorderProductImagesDto
  ) {
    return this.products.reorderImages(request.auth!, productId, dto);
  }

  @Post(":productId/images/:imageId/replace")
  @UseGuards(CsrfGuard)
  replaceImage(
    @Req() request: AuthenticatedRequest,
    @Param("productId") productId: string,
    @Param("imageId") imageId: string,
    @Body() dto: ReplaceProductImageDto
  ) {
    return this.products.replaceImage(request.auth!, productId, imageId, dto);
  }

  @Delete(":productId/images/:imageId")
  @UseGuards(CsrfGuard)
  deleteImage(
    @Req() request: AuthenticatedRequest,
    @Param("productId") productId: string,
    @Param("imageId") imageId: string,
    @Query("storeId") storeId?: string
  ) {
    return this.products.deleteImage(request.auth!, productId, imageId, storeIdFromRequest(request, storeId));
  }

  private finishProductTiming(
    operation: string,
    request: AuthenticatedRequest,
    response: Response,
    timer: RequestTimer
  ) {
    const totalMs = timer.finishTotal();
    response.setHeader("Server-Timing", timer.serverTiming());
    if (totalMs <= 300) {
      return;
    }
    this.logger.warn(JSON.stringify({
      event: "product.save_slow",
      operation,
      requestId: request.requestId,
      durationMs: totalMs
    }));
  }
}

function storeIdFromRequest(request: AuthenticatedRequest, queryStoreId?: string) {
  const header = request.header("x-store-id");
  const storeId = queryStoreId ?? header;
  if (!storeId) {
    throw new BadRequestException({
      apiVersion: "v1",
      code: "STORE_REQUIRED",
      message: "storeId is required.",
      retryable: false
    });
  }
  return storeId;
}
