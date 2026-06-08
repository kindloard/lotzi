import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, "..");

if (process.platform === "win32" && process.env.LOTZI_SKIP_PRISMA_UNLOCK !== "1") {
  unlockWindowsPrismaEngine();
}

const result = process.platform === "win32"
  ? spawnSync("npx prisma generate", {
      cwd: backendRoot,
      shell: true,
      stdio: "inherit"
    })
  : spawnSync("npx", ["prisma", "generate"], {
      cwd: backendRoot,
      stdio: "inherit"
    });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function unlockWindowsPrismaEngine() {
  const script = `
$root = $args[0]
$escapedRoot = [System.Management.Automation.WildcardPattern]::Escape($root)
$targets = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
  $cmd = $_.CommandLine
  $cmd -and
    $cmd -like "*$escapedRoot*" -and
    (
      ($cmd -like "*nest.js*" -and $cmd -like "*--watch*") -or
      $cmd -like "*dist\\main*" -or
      $cmd -like "*dist/main*"
    )
}

foreach ($target in $targets) {
  Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Output $target.ProcessId
}

for ($i = 0; $i -lt 20; $i++) {
  $remaining = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $cmd = $_.CommandLine
    $cmd -and
      $cmd -like "*$escapedRoot*" -and
      (
        ($cmd -like "*nest.js*" -and $cmd -like "*--watch*") -or
        $cmd -like "*dist\\main*" -or
        $cmd -like "*dist/main*"
      )
  }
  if (-not $remaining) {
    break
  }
  Start-Sleep -Milliseconds 250
}
`;

  const unlock = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, backendRoot],
    { encoding: "utf8", windowsHide: true }
  );

  if (unlock.error) {
    console.warn(`[build] Could not inspect backend dev processes: ${unlock.error.message}`);
    return;
  }

  const stoppedPids = unlock.stdout.trim().split(/\s+/).filter(Boolean);
  if (stoppedPids.length > 0) {
    console.log(`[build] Stopped backend dev process(es) ${stoppedPids.join(", ")} to unlock Prisma.`);
  }
}
