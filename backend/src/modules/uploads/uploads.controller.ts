import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Response } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { UploadImageDto } from "./dto/uploads.dto";
import { UploadEngineService } from "./upload-engine.service";

@Controller("v1/uploads")
export class UploadsController {
  constructor(private readonly engine: UploadEngineService) {}

  @Get("capabilities")
  capabilities() {
    return this.engine.capabilities();
  }

  @Post("images")
  @UseGuards(AccessTokenGuard, CsrfGuard)
  @UseInterceptors(FileInterceptor("file", {
    storage: memoryStorage(),
    limits: {
      fileSize: 12 * 1024 * 1024,
      files: 1
    }
  }))
  async uploadImage(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: UploadImageDto,
    @UploadedFile() file?: Express.Multer.File
  ) {
    const abort = new AbortController();
    request.on("aborted", () => abort.abort());
    const result = await this.engine.uploadImage({
      auth: request.auth!,
      dto,
      file,
      requestId: request.requestId,
      signal: abort.signal
    });
    if (result.serverTiming) {
      response.setHeader("Server-Timing", result.serverTiming);
    }
    return result.body;
  }

  @Post("maintenance/sweep")
  @UseGuards(AccessTokenGuard, CsrfGuard)
  sweep(@Req() request: AuthenticatedRequest, @Body() body: { storeId?: string }) {
    if (!request.auth?.isPlatformAdmin) {
      throw new ForbiddenException({
        apiVersion: "v1",
        code: "UPLOAD_MAINTENANCE_FORBIDDEN",
        message: "Only platform admins can run upload maintenance.",
        retryable: false
      });
    }
    if (!body.storeId) {
      throw new ForbiddenException({
        apiVersion: "v1",
        code: "STORE_REQUIRED",
        message: "storeId is required.",
        retryable: false
      });
    }
    return this.engine.sweepStoreOrphans(body.storeId, { maxAssets: 50, maxMs: 5_000 });
  }
}
