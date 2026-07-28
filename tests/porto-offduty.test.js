"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectPortoOffDutyUnits,
  firstAvailableRegularPortoVehicleNumber
} = require("../modules/porto-routes");

test("porto uitdienst voor een persoon sluit ook dubbele actieve entries van die persoon", () => {
  const state = {
    portoUnits: [
      { id: "u1", memberId: "p1", vehicleNumber: "30-02", active: true },
      { id: "u2", memberId: "p1", vehicleNumber: "30-02", active: true },
      { id: "u3", memberId: "p2", vehicleNumber: "30-02", active: true }
    ]
  };

  const units = collectPortoOffDutyUnits(state, {
    unit: state.portoUnits[0],
    oldVehicleNumber: "30-02",
    offDutyScope: "member",
    operatorVehicleNumber: "30-00"
  });

  assert.deepEqual(units.map((unit) => unit.id), ["u1", "u2"]);
});

test("porto uitdienst voor een roepnummer sluit groep plus dubbele entries van groepsleden", () => {
  const state = {
    portoUnits: [
      { id: "u1", memberId: "p1", vehicleNumber: "30-02", active: true },
      { id: "u2", memberId: "p2", vehicleNumber: "30-02", active: true },
      { id: "u3", memberId: "p1", vehicleNumber: "30-04", active: true },
      { id: "u4", memberId: "p3", vehicleNumber: "30-04", active: true }
    ]
  };

  const units = collectPortoOffDutyUnits(state, {
    unit: state.portoUnits[0],
    oldVehicleNumber: "30-02",
    offDutyScope: "vehicle",
    operatorVehicleNumber: "30-00"
  });

  assert.deepEqual(units.map((unit) => unit.id), ["u1", "u2", "u3"]);
});

test("porto loskoppelen valt niet terug naar speciale voertuigreeksen", () => {
  const state = {
    portoVehicleRanges: [
      { prefix: "30", numbers: ["30-00", "30-01", "30-02"] },
      { prefix: "32", numbers: ["32-01", "32-02"] }
    ],
    portoUnits: [
      { id: "ops", memberId: "ops", vehicleNumber: "30-00", active: true },
      { id: "nh1", memberId: "p1", vehicleNumber: "30-01", active: true },
      { id: "nh2", memberId: "p2", vehicleNumber: "30-02", active: true },
      { id: "siv", memberId: "p3", vehicleNumber: "32-01", active: true }
    ]
  };

  assert.equal(firstAvailableRegularPortoVehicleNumber(state, "30-00"), "");
});

test("porto loskoppelen kiest eerst een vrij regulier roepnummer", () => {
  const state = {
    portoVehicleRanges: [
      { prefix: "30", numbers: ["30-00", "30-01", "30-02"] },
      { prefix: "32", numbers: ["32-01", "32-02"] }
    ],
    portoUnits: [
      { id: "ops", memberId: "ops", vehicleNumber: "30-00", active: true },
      { id: "nh1", memberId: "p1", vehicleNumber: "30-01", active: true },
      { id: "siv", memberId: "p3", vehicleNumber: "32-01", active: true }
    ]
  };

  assert.equal(firstAvailableRegularPortoVehicleNumber(state, "30-00"), "30-02");
});

test("reguliere porto indeling gebruikt nooit het OPS nummer als vrije plek", () => {
  const state = {
    portoVehicleRanges: [
      { prefix: "30", numbers: ["30-00", "30-01", "30-02"] },
      { prefix: "32", numbers: ["32-01", "32-02"] }
    ],
    portoUnits: []
  };

  assert.equal(firstAvailableRegularPortoVehicleNumber(state, "30-00"), "30-01");
});
