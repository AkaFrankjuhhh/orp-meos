const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("discord worker uses organization porto operator number for lead nickname context", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");

  assert.match(code, /organization\.porto\?\.operatorVehicleNumber/);
  assert.doesNotMatch(code, /unit\.vehicleNumber === "30-00"/);
});

test("mentor tests are not hard-coded to defensie only", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");

  assert.doesNotMatch(code, /organization\.key === "defensie" && Boolean\(mentorTestsStore\)/);
  assert.match(code, /mentorTestsStore && mentorRanks\.length/);
});
