import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$6S7P7UFxa5uFpPdjVvrl6A$Aq+dNuRBWr59zoig0EdrRP7K4mJfitJMsNdhpJichi0";

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1
    });
  }

  async verify(password: string, hash?: string | null): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? DUMMY_PASSWORD_HASH, password);
    } catch {
      await argon2.verify(DUMMY_PASSWORD_HASH, password).catch(() => false);
      return false;
    }
  }
}
