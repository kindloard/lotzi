import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v2 as cloudinary } from "cloudinary";

@Injectable()
export class CloudinaryService {
  constructor(config: ConfigService) {
    cloudinary.config({
      cloud_name: config.get<string>("CLOUDINARY_CLOUD_NAME"),
      api_key: config.get<string>("CLOUDINARY_API_KEY"),
      api_secret: config.get<string>("CLOUDINARY_API_SECRET")
    });
  }

  createStoreUploadSignature(storeId: string, purpose: "products" | "stores") {
    const folder = `stores/${this.safePathSegment(storeId)}/${purpose}`;
    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      cloudinary.config().api_secret ?? ""
    );

    return {
      cloudName: cloudinary.config().cloud_name,
      apiKey: cloudinary.config().api_key,
      folder,
      timestamp,
      signature
    };
  }

  private safePathSegment(value: string): string {
    const segment = value.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!segment) {
      throw new Error("Invalid Cloudinary path segment.");
    }
    return segment;
  }
}
