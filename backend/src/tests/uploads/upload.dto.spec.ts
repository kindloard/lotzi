import { validate } from "class-validator";
import { UploadImageDto } from "../../modules/uploads/dto/uploads.dto";

const storeId = "1fc57307-2833-4a96-a7c6-810bcdc2d206";
const clientFileId = "40754379-ea32-44df-9026-b9571d7c7871";
const sha256 = "80f86523226a62f0613cacc0b33768c2109b00bfbbe7e5453160758d115726ed";

describe("UploadImageDto", () => {
  it("accepts scoped product upload idempotency keys", async () => {
    const dto = uploadDto(`upload:v1:${clientFileId}:${sha256}`);

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "idempotencyKey")).toBe(false);
  });

  it("keeps UUID idempotency keys backward compatible", async () => {
    const dto = uploadDto("91973d2a-2511-42b7-bc08-9aa2b2722fb7");

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "idempotencyKey")).toBe(false);
  });

  it("rejects malformed upload idempotency keys", async () => {
    const dto = uploadDto(`upload:v1:${clientFileId}:not-a-hash`);

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "idempotencyKey")).toBe(true);
  });
});

function uploadDto(idempotencyKey: string) {
  const dto = new UploadImageDto();
  dto.purpose = "PRODUCT_IMAGE";
  dto.storeId = storeId;
  dto.draftId = "draft-f254d82b-1a71-4a36-9102-37fe69911992";
  dto.clientFileId = clientFileId;
  dto.idempotencyKey = idempotencyKey;
  dto.declaredMimeType = "image/jpeg";
  return dto;
}
