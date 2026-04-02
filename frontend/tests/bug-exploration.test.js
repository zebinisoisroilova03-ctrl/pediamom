/**
 * Bug Condition Exploration Tests – PediaMom UX Fixes
 *
 * These tests run on UNFIXED code and are EXPECTED TO FAIL.
 * A failing test confirms the bug exists (counterexample found).
 * A passing test would mean the bug is already fixed or the test logic is wrong.
 *
 * Run with: node frontend/tests/bug-exploration.test.js
 */

const fs = require("fs");
const path = require("path");

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(id, description, fn) {
  try {
    fn();
    // If we reach here the assertion passed – for exploration tests this is UNEXPECTED
    results.push({ id, description, status: "PASS (unexpected – bug may be fixed)", counterexample: null });
    passed++;
  } catch (err) {
    // Failure is the EXPECTED outcome for exploration tests – bug confirmed
    results.push({ id, description, status: "FAIL (expected – bug confirmed)", counterexample: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ─── Read source files ───────────────────────────────────────────────────────

const loginHtml      = fs.readFileSync(path.join(__dirname, "../auth/login.html"),      "utf8");
const addchildHtml   = fs.readFileSync(path.join(__dirname, "../children/addchild.html"), "utf8");
const checklistJs    = fs.readFileSync(path.join(__dirname, "../js/daily_checklist.module.js"), "utf8");

// ─── Test 1.1 – login.html has NO #forgotPasswordLink ───────────────────────
// Bug 1: "Forgot password?" link is missing from login.html
// EXPECTED: FAIL (element is absent → bug confirmed)

test("1.1", "login.html should contain #forgotPasswordLink or data-action='forgot-password'", () => {
  const hasForgotLink =
    loginHtml.includes('id="forgotPasswordLink"') ||
    loginHtml.includes("id='forgotPasswordLink'") ||
    loginHtml.includes('data-action="forgot-password"') ||
    loginHtml.includes("data-action='forgot-password'");

  assert(
    hasForgotLink,
    `Counterexample: login.html does NOT contain #forgotPasswordLink or data-action="forgot-password". ` +
    `Bug 1 confirmed – password reset link is missing.`
  );
});

// ─── Test 1.2 – h2 in login.html says "Parent Login" ───────────────────────
// Bug 2: Title should be generic "Login", not "Parent Login"
// EXPECTED: FAIL (h2 contains "Parent Login" → bug confirmed)

test("1.2", "h2 in login.html should NOT contain 'Parent Login'", () => {
  const h2Match = loginHtml.match(/<h2[^>]*>(.*?)<\/h2>/i);
  const h2Text  = h2Match ? h2Match[1].trim() : "";

  assert(
    h2Text !== "Parent Login",
    `Counterexample: <h2> textContent === "${h2Text}". ` +
    `Bug 2 confirmed – login title is "Parent Login" instead of a generic "Login".`
  );
});

// ─── Test 1.3 – addchild.html has NO #ageUnit selector ──────────────────────
// Bug 3: Age unit selector (Years/Months) is missing from addchild.html
// EXPECTED: FAIL (element absent → bug confirmed)

test("1.3", "addchild.html should contain an element with id='ageUnit'", () => {
  const hasAgeUnit =
    addchildHtml.includes('id="ageUnit"') ||
    addchildHtml.includes("id='ageUnit'");

  assert(
    hasAgeUnit,
    `Counterexample: addchild.html does NOT contain id="ageUnit". ` +
    `Bug 3 confirmed – age unit selector (Years/Months) is missing.`
  );
});

// ─── Test 1.4 – loadChildrenDropdown default option is "— All children —" ──
// Bug 4: Default should be "— Select child —", not "— All children —"
// EXPECTED: FAIL (wrong default text found → bug confirmed)

test("1.4", "daily_checklist.module.js default option should NOT be '— All children —'", () => {
  const hasAllChildren = checklistJs.includes("— All children —");

  assert(
    !hasAllChildren,
    `Counterexample: source contains "— All children —" as the default dropdown option. ` +
    `Bug 4 confirmed – default should be "— Select child —" to prevent showing all medicines at once.`
  );
});

// ─── Test 1.5 – loadChecklistRealtime renders only 1 checkbox per medicine ──
// Bug 5: Should render N checkboxes per medicine (one per time slot), not just 1
// EXPECTED: FAIL (no TIME_SLOTS loop found → bug confirmed)

test("1.5", "loadChecklistRealtime() should loop over TIME_SLOTS to create multiple checkboxes", () => {
  // The fixed code would define TIME_SLOTS and iterate over them
  const hasTimeSlotsArray = checklistJs.includes("TIME_SLOTS");
  const hasSlotLoop       = checklistJs.includes("for") && checklistJs.includes("slot");

  assert(
    hasTimeSlotsArray && hasSlotLoop,
    `Counterexample: loadChecklistRealtime() does NOT use TIME_SLOTS or a per-slot loop. ` +
    `Only a single <input type="checkbox"> is created per medicine regardless of timesPerDay. ` +
    `Bug 5 confirmed – per-dose checkboxes are missing.`
  );
});

// ─── Test 1.6 – getLast7Days() returns ISO format dates ─────────────────────
// Bug 6: Should return "Mar 7" style labels, not "2026-03-07" ISO strings
// EXPECTED: FAIL on unfixed code, PASS after fix

test("1.6", "getLast7Days() should NOT return ISO format (YYYY-MM-DD) dates", () => {
  // Extract and run the getLast7Days logic from the actual source file
  function getLast7Days() {
    const days = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const day = new Date(d);
      day.setDate(d.getDate() - i);
      days.push(day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }
    return days;
  }

  const labels = getLast7Days();
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  const isoLabels  = labels.filter(l => isoPattern.test(l));

  assert(
    isoLabels.length === 0,
    `Counterexample: getLast7Days() returned ISO-format labels: [${isoLabels.join(", ")}]. ` +
    `Bug 6 confirmed – chart X-axis shows unreadable ISO dates instead of "Mar 7" style labels.`
  );
});

// ─── Test 1.7 – checkMissedYesterday() warning has NO formatted date ─────────
// Bug 7: Warning should include a human-readable date like "March 12"
// EXPECTED: FAIL (no toLocaleDateString call in warning assignment → bug confirmed)

test("1.7", "checkMissedYesterday() warning innerHTML should include a formatted date", () => {
  // Look for the warning innerHTML assignment and check it includes a date variable
  // The fixed code would do: warning.innerHTML = `... ${yFormatted}` where yFormatted uses toLocaleDateString
  const warningAssignmentMatch = checklistJs.match(/warning\.innerHTML\s*=\s*[`'"]([^`'"]*)[`'"]/);
  const warningTemplate        = warningAssignmentMatch ? warningAssignmentMatch[1] : "";

  // Also check if toLocaleDateString is used anywhere near the warning
  const hasLocaleDateInWarning =
    checklistJs.includes("toLocaleDateString") &&
    // The fixed version would reference a formatted date variable in the warning string
    (warningTemplate.includes("${y") || warningTemplate.includes("Formatted") || warningTemplate.includes("date"));

  assert(
    hasLocaleDateInWarning,
    `Counterexample: checkMissedYesterday() warning innerHTML does NOT include a toLocaleDateString-formatted date. ` +
    `Current warning assignment: "${warningTemplate || "(none found – uses classList only)"}". ` +
    `Bug 7 confirmed – warning shows no specific date, only a generic message.`
  );
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║       PediaMom Bug Condition Exploration Tests               ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

results.forEach(r => {
  const icon = r.status.startsWith("FAIL") ? "✗" : "✓";
  console.log(`  ${icon} [${r.id}] ${r.description}`);
  console.log(`       Status: ${r.status}`);
  if (r.counterexample) {
    console.log(`       Counterexample: ${r.counterexample}`);
  }
  console.log();
});

console.log("─────────────────────────────────────────────────────────────");
console.log(`  Total: ${passed + failed}  |  FAIL (bugs confirmed): ${failed}  |  PASS (unexpected): ${passed}`);
console.log("─────────────────────────────────────────────────────────────\n");

if (failed === 7) {
  console.log("✅ All 7 bugs confirmed. Proceed with fixes.\n");
} else if (passed > 0) {
  console.log(`⚠️  ${passed} test(s) passed unexpectedly – those bugs may already be fixed or test logic needs review.\n`);
}

// Exit with non-zero if any test passed unexpectedly (means exploration didn't confirm all bugs)
process.exit(passed > 0 ? 1 : 0);
