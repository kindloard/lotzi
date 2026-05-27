import { Module } from "@nestjs/common";
import { ObservabilityModule } from "../../modules/observability/observability.module";
import { CloudinaryMediaProvider } from "./cloudinary-media.provider";
import { CloudinaryService } from "./cloudinary.service";

@Module({
  imports: [ObservabilityModule],
  providers: [CloudinaryMediaProvider, CloudinaryService],
  exports: [CloudinaryMediaProvider, CloudinaryService]
})
export class CloudinaryModule {}
