import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CheckoutOnboardingStartDto,
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

describe("Checkout onboarding DTO coordinates", () => {
  const validPayload = {
    city: "Ambasamudram",
    email: "buyer@example.com",
    line1: "3/923A thamarai street, agasthiyarpatti",
    nextPath: "/cart",
    pincode: "627428",
    recipientPhone: "+91 63836 34873",
    state: "Tamil Nadu"
  };

  it("rounds over-precise map coordinates before validation", async () => {
    const dto = plainToInstance(CheckoutOnboardingStartDto, {
      ...validPayload,
      latitude: 8.712820900714043,
      longitude: 77.421500700102
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).not.toContain("latitude");
    expect(errors.map((error) => error.property)).not.toContain("longitude");
    expect(dto.latitude).toBe(8.7128209);
    expect(dto.longitude).toBe(77.4215007);
  });

  it("still rejects impossible coordinate ranges", async () => {
    const dto = plainToInstance(CheckoutOnboardingStartDto, {
      ...validPayload,
      latitude: 91,
      longitude: 181
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(["latitude", "longitude"]));
  });

  it("requires a valid account email for phone checkout signup", async () => {
    const dto = plainToInstance(CheckoutOnboardingStartDto, {
      ...validPayload,
      email: "not-an-email"
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toContain("email");
  });
});
