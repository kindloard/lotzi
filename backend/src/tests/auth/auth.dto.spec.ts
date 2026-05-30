import "reflect-metadata";
import { validate } from "class-validator";
import {
  GoogleLinkDto,
  PasswordResetConfirmDto,
  SignupDto
} from "../../modules/auth/dto/auth.dto";

describe("Auth DTO password policy", () => {
  it("rejects signup passwords without a number or symbol", async () => {
    const dto = new SignupDto();
    dto.name = "Buyer";
    dto.email = "buyer@example.com";
    dto.password = "plainpass";

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "password")).toBe(true);
  });

  it("accepts signup passwords with the required baseline complexity", async () => {
    const dto = new SignupDto();
    dto.name = "Buyer";
    dto.email = "buyer@example.com";
    dto.password = "plainpass1";

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "password")).toBe(false);
  });

  it("applies the same policy to password reset confirmation", async () => {
    const dto = new PasswordResetConfirmDto();
    dto.token = "abcdefghijklmnopqrstuvwxyz123456.selector";
    dto.newPassword = "anotherplain";

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "newPassword")).toBe(true);
  });

  it("applies the same policy to Google link password confirmation", async () => {
    const dto = new GoogleLinkDto();
    dto.idToken = "valid-length-google-token";
    dto.password = "plainpass!";

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === "password")).toBe(false);
  });
});
