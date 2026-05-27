import { UploadPurpose, UploadRenditionKind } from "@prisma/client";
import { PERMISSIONS } from "../../modules/rbac/permissions";
import { UploadPolicyRegistry } from "../../modules/uploads/upload-policy.registry";

describe("UploadPolicyRegistry", () => {
  it("exposes the production product image policy contract", () => {
    const registry = new UploadPolicyRegistry();
    const policy = registry.get(UploadPurpose.PRODUCT_IMAGE);

    expect(policy.scope).toBe("STORE");
    expect(policy.requiredPermissions).toContain(PERMISSIONS.PRODUCT_MANAGE);
    expect(policy.maxBytes).toBe(12 * 1024 * 1024);
    expect(policy.maxPixels).toBe(40_000_000);
    expect(policy.minWidth).toBeUndefined();
    expect(policy.minHeight).toBeUndefined();
    expect(policy.aspectRatio).toBeUndefined();
    expect(policy.renditions.map((rendition) => rendition.kind)).toEqual([
      UploadRenditionKind.THUMBNAIL,
      UploadRenditionKind.CARD,
      UploadRenditionKind.DETAIL,
      UploadRenditionKind.JPEG_FALLBACK,
      UploadRenditionKind.ZOOM
    ]);
    expect(policy.renditions.filter((rendition) => rendition.warmOnUpload).map((rendition) => rendition.kind)).toEqual([
      UploadRenditionKind.THUMBNAIL,
      UploadRenditionKind.CARD,
      UploadRenditionKind.DETAIL,
      UploadRenditionKind.JPEG_FALLBACK
    ]);
  });
});
