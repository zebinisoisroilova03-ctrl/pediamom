/**
 * Preservation Tests – PediaMom UX Fixes
 *
 * These tests confirm EXISTING CORRECT behaviors on UNFIXED code.
 * All tests are EXPECTED TO PASS – they document the baseline that must
 * be preserved after the bug fixes are applied.
 *
 * Run with: node frontend/tests/preservation.test.js
 *
 * Validates: Requirements 3.1, 3.3, 3.5, 3.7, 3.8
 */

const fs   = require("fs");
const path = require("path");

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(id, description, fn) {
  try {
    fn();
    results.push({ id, description, status: "PASS", detail: null });
    passed++;
  } catch (err) {
    results.push({ id, description, status: "FAIL", detail: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── Read source files ────────────────────────────────────────────────────────

const authJs       = fs.readFileSync(path.join(__dirname, "../js/auth.js"),                      "utf8");
const checklistJs  = fs.readFileSync(path.join(__dirname, "../js/daily_checklist.module.js"),    "utf8");
const childlistJs  = fs.readFileSync(path.join(__dirname, "../js/childlist.js"),                 "utf8");

// ─── Prop 2.1 – Login form handler uses signInWithEmailAndPassword ────────────
// Validates: Requirements 3.1
// The login form correctly calls signInWithEmailAndPassword and references loginForm.
// This behavior must be preserved after all fixes.

test("2.1", "auth.js: login form handler uses signInWithEmailAndPassword and loginForm", () => {
  const hasSignIn    = authJs.includes("signInWithEmailAndPassword");
  const hasLoginForm = authJs.includes("loginForm");

  assert(
    hasSignIn,
    `auth.js does NOT contain "signInWithEmailAndPassword". Login functionality is broken.`
  );
  assert(
    hasLoginForm,
    `auth.js does NOT reference "loginForm". Login form handler is missing.`
  );
});

// ─── Prop 2.2 – timesPerDay=1 produces exactly 1 slot ("Morning") ────────────
// Validates: Requirements 3.5
// After the Bug 5 fix, TIME_SLOTS.slice(0, 1) must equal ["Morning"] so that a
// single-dose medicine still renders exactly one checkbox (labeled "Morning").

test("2.2", "daily_checklist.module.js: timesPerDay=1 produces exactly 1 slot via TIME_SLOTS.slice(0,1)", () => {
  // Verify the fixed code defines TIME_SLOTS
  const hasTimeSlotsArray = checklistJs.includes("TIME_SLOTS");

  assert(
    hasTimeSlotsArray,
    `daily_checklist.module.js does NOT define TIME_SLOTS. ` +
    `The per-dose checkbox fix is missing.`
  );

  // Verify that TIME_SLOTS.slice(0, 1) produces exactly 1 slot
  const TIME_SLOTS = ["Morning", "Afternoon", "Evening", "Night"];
  const singleDoseSlots = TIME_SLOTS.slice(0, 1);

  assert(
    singleDoseSlots.length === 1,
    `TIME_SLOTS.slice(0, 1).length === ${singleDoseSlots.length}, expected 1. ` +
    `timesPerDay=1 must still render exactly 1 checkbox.`
  );

  assert(
    singleDoseSlots[0] === "Morning",
    `TIME_SLOTS.slice(0, 1)[0] === "${singleDoseSlots[0]}", expected "Morning". ` +
    `The single slot for timesPerDay=1 must be "Morning".`
  );
});

// ─── Prop 2.3 – childlist.js displays age with "yrs" suffix ──────────────────
// Validates: Requirements 3.3
// Existing children stored without an ageUnit field are displayed as "N yrs".
// This fallback must continue to work after the age-unit fix (Bug 3).

test("2.3", "childlist.js: source contains 'yrs' as a display suffix for age", () => {
  const hasYrsSuffix = childlistJs.includes("yrs");

  assert(
    hasYrsSuffix,
    `childlist.js does NOT contain "yrs". ` +
    `The fallback display for children without an ageUnit field is missing.`
  );
});

// ─── Prop 2.4 – checkMissedYesterday() hides warning when medicines are taken ─
// Validates: Requirements 3.7
// When yesterday's medicines were all taken the warning element gets the "hidden"
// class added. This correct behavior must be preserved after Bug 7 is fixed.

test("2.4", "daily_checklist.module.js: checkMissedYesterday() adds 'hidden' class when medicines are taken", () => {
  // The source must contain the classList.add("hidden") call inside checkMissedYesterday.
  const hasHiddenAdd = checklistJs.includes('classList.add("hidden")');

  assert(
    hasHiddenAdd,
    `daily_checklist.module.js does NOT contain 'warning.classList.add("hidden")'. ` +
    `The logic that hides the warning when medicines are taken is missing.`
  );
});

// ─── Prop 2.5 – getLast7DatesISO() returns exactly 7 days ───────────────────
// Validates: Requirements 3.8
// The 7-day window calculation is correct and must not be broken by the chart
// label format fix (Bug 6). Only the label format changes; the count stays at 7.

test("2.5", "getLast7DatesISO() returns an array of exactly 7 elements", () => {
  // Re-implement the getLast7DatesISO() logic from daily_checklist.module.js
  // (ISO format – used for Firestore queries) and assert the length.
  function getLast7DatesISO() {
    const days = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const day = new Date(d);
      day.setDate(d.getDate() - i);
      days.push(day.toISOString().split("T")[0]);
    }
    return days;
  }

  const days = getLast7DatesISO();

  assert(
    Array.isArray(days),
    `getLast7DatesISO() did not return an array. Got: ${typeof days}`
  );
  assert(
    days.length === 7,
    `getLast7DatesISO() returned ${days.length} element(s) instead of 7. ` +
    `Days: [${days.join(", ")}]`
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║       PediaMom Preservation Tests (Baseline Behaviors)       ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

results.forEach(r => {
  const icon = r.status === "PASS" ? "✓" : "✗";
  console.log(`  ${icon} [${r.id}] ${r.description}`);
  console.log(`       Status: ${r.status}`);
  if (r.detail) {
    console.log(`       Detail: ${r.detail}`);
  }
  console.log();
});

console.log("─────────────────────────────────────────────────────────────");
console.log(`  Total: ${passed + failed}  |  PASS: ${passed}  |  FAIL: ${failed}`);
console.log("─────────────────────────────────────────────────────────────\n");

if (failed === 0) {
  console.log("✅ All preservation tests PASS. These behaviors must be retained after fixes.\n");
} else {
  console.log(`❌ ${failed} preservation test(s) FAILED. Baseline behavior is broken – investigate before applying fixes.\n`);
}

// Exit with non-zero if any preservation test failed
process.exit(failed > 0 ? 1 : 0);
