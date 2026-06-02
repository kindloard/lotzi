import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

const runIntegration = process.env.RUN_DB_INTEGRATION === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("merchant onboarding location migration integration", () => {
  let container: StartedTestContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_DB: "lotzi_test",
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_USER: "postgres"
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections"))
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(5432);
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: `postgresql://postgres:postgres@${host}:${port}/lotzi_test`
        }
      }
    });

    await prisma.$executeRawUnsafe(`CREATE TYPE "OnboardingStep" AS ENUM ('BUSINESS', 'BRANDING', 'LEGAL', 'PREFERENCES', 'REVIEW')`);
    await prisma.$executeRawUnsafe(`CREATE TYPE "OnboardingLifecycleState" AS ENUM ('PENDING', 'BUSINESS_DONE', 'BRANDING_DONE', 'LEGAL_DONE', 'PREFS_DONE', 'READY_FOR_REVIEW', 'LAUNCHED', 'APPROVAL_PENDING', 'ACTIVE', 'SUSPENDED')`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "store_onboarding_states" (
        "store_id" UUID PRIMARY KEY,
        "state" "OnboardingLifecycleState" NOT NULL DEFAULT 'PENDING',
        "current_step" "OnboardingStep" NOT NULL DEFAULT 'BUSINESS',
        "completion_percent" INTEGER NOT NULL DEFAULT 0
      )
    `);
  }, 120000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it("applies enum additions and accepts LOCATION state writes", async () => {
    const migration = readFileSync(
      join(process.cwd(), "prisma/migrations/20260523143000_add_onboarding_location_step/migration.sql"),
      "utf8"
    );

    for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(`${statement};`);
    }

    const steps = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
      `SELECT e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'OnboardingStep'
       ORDER BY e.enumsortorder`
    );
    expect(steps.map((row) => row.enumlabel)).toEqual([
      "BUSINESS",
      "BRANDING",
      "LEGAL",
      "LOCATION",
      "PREFERENCES",
      "REVIEW"
    ]);

    const states = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
      `SELECT e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'OnboardingLifecycleState'
       ORDER BY e.enumsortorder`
    );
    expect(states.map((row) => row.enumlabel)).toEqual([
      "PENDING",
      "BUSINESS_DONE",
      "BRANDING_DONE",
      "LEGAL_DONE",
      "LOCATION_DONE",
      "PREFS_DONE",
      "READY_FOR_REVIEW",
      "LAUNCHED",
      "APPROVAL_PENDING",
      "ACTIVE",
      "SUSPENDED"
    ]);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "store_onboarding_states" ("store_id", "state", "current_step", "location_completed_at")
       VALUES ($1::uuid, 'LOCATION_DONE', 'LOCATION', now())`,
      randomUUID()
    );

    const rows = await prisma.$queryRawUnsafe<Array<{ current_step: string; state: string }>>(
      `SELECT "current_step", "state" FROM "store_onboarding_states"`
    );
    expect(rows).toEqual([{ current_step: "LOCATION", state: "LOCATION_DONE" }]);
  }, 120000);
});
