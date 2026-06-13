import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(repoRoot, "site", "assets", "social-card.png");
const tmpDir = "/private/tmp/bolao-dos-follis-social";
const tmpHtmlPath = path.join(tmpDir, "social-card.html");
const heroUrl = pathToFileURL(path.join(repoRoot, "site", "assets", "bolao-hero.png")).href;
const chromePath = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 1200px;
        height: 630px;
        margin: 0;
        overflow: hidden;
      }

      body {
        color: #fffef2;
        font-family: Inter, Arial, Helvetica, sans-serif;
      }

      .card {
        position: relative;
        width: 1200px;
        height: 630px;
        padding: 56px 64px;
        background:
          linear-gradient(90deg, rgba(1, 43, 28, 0.92) 0%, rgba(1, 52, 33, 0.74) 40%, rgba(1, 52, 33, 0.13) 100%),
          linear-gradient(180deg, rgba(0, 28, 22, 0.4) 0%, rgba(0, 28, 22, 0.88) 100%),
          url("${heroUrl}") center / cover no-repeat;
      }

      .content {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        width: 660px;
        height: 100%;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        padding: 12px 18px;
        border: 1px solid rgba(255, 255, 255, 0.42);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.13);
        color: #ffe56d;
        font-size: 28px;
        font-weight: 900;
        line-height: 1;
        text-transform: uppercase;
      }

      h1 {
        margin: 22px 0 18px;
        font-family: Impact, Haettenschweiler, "Arial Black", sans-serif;
        font-size: 118px;
        font-weight: 900;
        line-height: 0.9;
        letter-spacing: 0;
        text-transform: uppercase;
        text-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
      }

      .copy {
        max-width: 600px;
        margin: 0;
        color: rgba(255, 255, 255, 0.92);
        font-size: 34px;
        font-weight: 800;
        line-height: 1.12;
        text-shadow: 0 8px 26px rgba(0, 0, 0, 0.46);
      }

      .chips {
        display: flex;
        gap: 14px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        min-height: 56px;
        padding: 0 22px;
        border-radius: 999px;
        color: #063523;
        font-size: 24px;
        font-weight: 900;
        background: #ffe152;
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.28);
      }

      .chip:nth-child(2) {
        color: #fff;
        background: #0c63c7;
      }

      .stripe {
        position: absolute;
        right: -90px;
        bottom: 54px;
        width: 520px;
        height: 86px;
        transform: rotate(-12deg);
        background: linear-gradient(90deg, #069246 0 34%, #f7df32 34% 66%, #0c63c7 66% 100%);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="content">
        <div>
          <div class="eyebrow">Copa do Mundo 2026</div>
          <h1>Bolão<br />dos Follis</h1>
          <p class="copy">Ranking, palpites e resultados da família.</p>
        </div>
        <div class="chips" aria-hidden="true">
          <span class="chip">Palpites</span>
          <span class="chip">Brasil</span>
          <span class="chip">Taça</span>
        </div>
      </div>
      <div class="stripe" aria-hidden="true"></div>
    </main>
  </body>
</html>`;

await mkdir(tmpDir, { recursive: true });
await writeFile(tmpHtmlPath, html);
await rm(outPath, { force: true });

const child = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--disable-sync",
    "--disable-features=MediaRouter,OptimizationHints",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--virtual-time-budget=1000",
    `--user-data-dir=${path.join(tmpDir, "chrome-profile")}`,
    `--screenshot=${outPath}`,
    "--window-size=1200,630",
    pathToFileURL(tmpHtmlPath).href,
  ],
  { stdio: "ignore" },
);

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const waitForExit = new Promise((resolve) => {
  child.once("exit", (code, signal) => resolve({ code, signal }));
});

let generated = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    const fileStat = await stat(outPath);
    if (fileStat.size > 100_000) {
      generated = true;
      break;
    }
  } catch {
    // Keep waiting until Chrome writes the screenshot.
  }
  await wait(150);
}

if (generated) {
  child.kill("SIGTERM");
  await Promise.race([waitForExit, wait(2_000)]);
  console.log(`Social image generated: ${outPath}`);
  process.exit(0);
}

const exit = await waitForExit;
if (exit.code !== 0) {
  throw new Error(`Failed to generate social image with Chrome at ${chromePath}`);
}

console.log(`Social image generated: ${outPath}`);
