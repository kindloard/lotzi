type Sample = {
  name: string;
  durationMs: number;
  status: number;
};

const baseUrl = trimTrailingSlash(process.env.AUTH_PERF_BASE_URL ?? "http://localhost:4000/api");
const email = process.env.AUTH_PERF_EMAIL;
const password = process.env.AUTH_PERF_PASSWORD;
const iterations = intEnv("AUTH_PERF_ITERATIONS", 3);
const warmup = intEnv("AUTH_PERF_WARMUP", 1);
const loginP95LimitMs = intEnv("AUTH_PERF_LOGIN_P95_MS", 300);
const sessionP95LimitMs = intEnv("AUTH_PERF_SESSION_P95_MS", 50);

if (!email || !password) {
  console.error("AUTH_PERF_EMAIL and AUTH_PERF_PASSWORD are required.");
  process.exit(2);
}

async function main() {
  const loginSamples: Sample[] = [];
  const sessionSamples: Sample[] = [];

  for (let i = 0; i < warmup + iterations; i += 1) {
    const collect = i >= warmup;
    const login = await timed("login", () =>
      fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-fingerprint": `auth-perf-smoke-${i}`
        },
        body: JSON.stringify({ email, password, remember: true })
      })
    );
    await assertOk(login.response, "login");
    if (collect) {
      loginSamples.push(login.sample);
    }

    const cookie = cookieHeader(login.response.headers);
    if (cookie) {
      const session = await timed("session", () =>
        fetch(`${baseUrl}/auth/session`, {
          headers: {
            cookie,
            "x-device-fingerprint": `auth-perf-smoke-${i}`
          }
        })
      );
      await assertOk(session.response, "session");
      if (collect) {
        sessionSamples.push(session.sample);
      }
    }
  }

  const loginP95 = percentile(loginSamples, 95);
  const sessionP95 = percentile(sessionSamples, 95);
  const result = {
    baseUrl,
    iterations,
    warmup,
    loginP95Ms: loginP95,
    loginP95LimitMs,
    sessionP95Ms: sessionP95,
    sessionP95LimitMs
  };

  console.log(JSON.stringify(result, null, 2));

  if (loginP95 > loginP95LimitMs || sessionP95 > sessionP95LimitMs) {
    process.exitCode = 1;
  }
}

async function timed(name: string, callback: () => Promise<Response>) {
  const startedAt = performance.now();
  const response = await callback();
  return {
    response,
    sample: {
      name,
      status: response.status,
      durationMs: Number((performance.now() - startedAt).toFixed(2))
    }
  };
}

async function assertOk(response: Response, name: string) {
  if (response.ok) {
    return;
  }
  const body = await response.text().catch(() => "");
  throw new Error(`${name} failed with ${response.status}: ${body}`);
}

function cookieHeader(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = getSetCookie ? getSetCookie.call(headers) : [];
  return setCookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function percentile(samples: Sample[], p: number) {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function intEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
