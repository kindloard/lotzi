import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../database/prisma.service";
import { RedisService } from "../../modules/redis/redis.service";
import { MerchantDashboardModule } from "../../modules/merchant-dashboard/merchant-dashboard.module";

describe("MerchantDashboardModule", () => {
  it("compiles the authenticated dashboard provider graph", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              ACCESS_TOKEN_TTL_SECONDS: 900,
              COOKIE_SAME_SITE: "lax",
              JWT_KEY_ID: "test",
              NODE_ENV: "test",
              REFRESH_TOKEN_TTL_DAYS: 30
            })
          ]
        }),
        MerchantDashboardModule
      ]
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(RedisService)
      .useValue({
        del: jest.fn(),
        get: jest.fn(),
        setEx: jest.fn()
      })
      .compile();

    await moduleRef.close();
  });
});
