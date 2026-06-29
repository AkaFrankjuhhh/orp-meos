const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const port = 4137;
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(process, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert.equal(process.exitCode, null, "server exited before it became ready");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await wait(150);
  }
  throw new Error("server did not become ready in time");
}

test("portal boot assets are served under the production CSP", async () => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      APP_BASE_URL: baseUrl,
      STORAGE_MODE: "json",
      DEV_ALLOW_UNAUTH: "false",
      NODE_ENV: "test"
    },
    stdio: "ignore"
  });

  try {
    await waitForServer(server);

    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-security-policy") || "", /script-src 'self'/);

    for (const asset of ["/portal-boot.js", "/portal-client-errors.js", "/portal-loader-failsafe.js", "/boot-failsafe.js"]) {
      const response = await fetch(`${baseUrl}${asset}`);
      assert.equal(response.status, 200, `${asset} should be public`);
      assert.match(response.headers.get("content-type") || "", /text\/javascript/);
    }
  } finally {
    server.kill();
  }
});

test("portal shell uses absolute assets so deep profile routes hydrate", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const assetRefs = [...html.matchAll(/\b(?:href|src)="([^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)].map((match) => match[1]);
  assert.ok(assetRefs.length > 10, "expected portal CSS and JS references");
  for (const ref of assetRefs) {
    assert.ok(ref.startsWith("/"), `${ref} should be absolute for /medewerkers/... routes`);
  }
});

test("I8 create form keeps a browser draft until server save succeeds", () => {
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const i8Code = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "i8.js"), "utf8");
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");

  assert.match(i8Code, /function saveI8Draft\(/);
  assert.match(i8Code, /function restoreI8Draft\(/);
  assert.match(i8Code, /function clearI8Draft\(/);
  assert.match(appCode, /button\.dataset\.i8Tab === "create"\) restoreI8Draft/);
  assert.match(appCode, /if \(!saved\) return;\s+clearI8Draft\(\);/);
  assert.match(html, /personeelsportaal\/i8\.js\?v=20260630-i8-draft-autosave/);
});

test("mentor test Discord embed formats submitted date and time", () => {
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  assert.match(serverCode, /function formatMentorTestDateTime\(/);
  assert.match(serverCode, /timeZone: "Europe\/Amsterdam"/);
  assert.match(serverCode, /name: "Ingediend op", value: formatMentorTestDateTime\(test\.submittedAt\)/);
});

test("side task shell serves DNR and KLu alias assets with a fresh version", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "side-tasks.html"), "utf8");
  assert.match(html, /side-tasks\.css\?v=20260630-dnr-klu-alias/);
  assert.match(html, /side-tasks\.js\?v=20260630-dnr-klu-alias/);
});
