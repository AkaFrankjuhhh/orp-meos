"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectPortoOffDutyUnits } = require("../modules/porto-routes");

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
