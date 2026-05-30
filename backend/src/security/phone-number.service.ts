import { BadRequestException, Injectable } from "@nestjs/common";

const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

@Injectable()
export class PhoneNumberService {
  normalizeIndianMobile(input: string): string {
    const digits = input.replace(/\D/g, "");
    const national = digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;

    if (!INDIAN_MOBILE_PATTERN.test(national)) {
      throw new BadRequestException({
        code: "PHONE_INVALID",
        message: "Enter a valid Indian mobile number."
      });
    }

    return `+91${national}`;
  }

  toFast2SmsMobile(normalizedPhone: string): string {
    return this.normalizeIndianMobile(normalizedPhone).slice(3);
  }

  mask(normalizedPhone: string): string {
    const mobile = this.toFast2SmsMobile(normalizedPhone);
    return `+91 ${mobile.slice(0, 2)}XXXXXX${mobile.slice(-2)}`;
  }
}
