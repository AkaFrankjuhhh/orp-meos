"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("MEOS runtime data can live outside the Git checkout", () => {
  const server = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");

  assert.match(server, /process\.env\.ORP_PORTAL_DATA_PATH/);
  assert.match(envExample, /^ORP_PORTAL_DATA_PATH=\/var\/lib\/orp-meos\/data\.json$/m);
  assert.match(envExample, /^MEOS_CASE_DATA_PATH=\/var\/lib\/orp-meos\/meos-case-data\.json$/m);
});
