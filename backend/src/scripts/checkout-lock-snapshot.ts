import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      now() AS captured_at,
      activity.pid,
      activity.state,
      activity.wait_event_type,
      activity.wait_event,
      locks.locktype,
      locks.mode,
      locks.granted,
      locks.relation::regclass::text AS relation,
      pg_blocking_pids(activity.pid) AS blocked_by,
      regexp_replace(left(coalesce(activity.query, ''), 500), '\\s+', ' ', 'g') AS query_fingerprint
    FROM pg_stat_activity activity
    LEFT JOIN pg_locks locks ON locks.pid = activity.pid
    WHERE activity.datname = current_database()
      AND activity.pid <> pg_backend_pid()
    ORDER BY activity.pid, locks.granted, locks.locktype, locks.mode
  `;
  console.log(JSON.stringify({
    event: "checkout.lock_snapshot",
    count: rows.length,
    rows
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
