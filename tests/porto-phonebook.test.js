const test = require("node:test");
const assert = require("node:assert/strict");
const { portoPhonebookPeople } = require("../modules/porto-phonebook");

test("porto phonebook sorts by service number and uses porto phone first", () => {
  const state = {
    people: [
      { id: "2", rank: "Majoor", name: "B", serviceNumber: "71-02", phone: "111" },
      { id: "1", rank: "Kapitein", name: "A", serviceNumber: "70-01", phone: "222", portoPhone: "333" },
      { id: "3", rank: "Marechaussee", name: "C", serviceNumber: "74-01", status: "Ontslagen", phone: "444" }
    ]
  };

  assert.deepEqual(portoPhonebookPeople(state), [
    { id: "1", rank: "Kapitein", name: "A", serviceNumber: "70-01", phone: "333" },
    { id: "2", rank: "Majoor", name: "B", serviceNumber: "71-02", phone: "111" }
  ]);
});
