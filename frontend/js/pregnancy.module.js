// pregnancy.module.js
import { auth, db } from "./firebase.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ======================
   5.2 — CALCULATION HELPERS
====================== */

/**
 * Returns a new Date exactly cycleLength days after lastDate.
 * @param {Date} lastDate
 * @param {number} cycleLength
 * @returns {Date}
 */
export function calculateNextPeriod(lastDate, cycleLength) {
  const next = new Date(lastDate);
  next.setDate(next.getDate() + cycleLength);
  return next;
}

/**
 * Calculates the fertile window.
 * ovulationDay = lastDate + (cycleLength - 14)
 * fertileStart = ovulationDay - 5
 * fertileEnd   = ovulationDay + 1
 * @param {Date} lastDate
 * @param {number} cycleLength
 * @returns {{ fertileStart: Date, fertileEnd: Date, ovulationDay: Date }}
 */
export function calculateFertileWindow(lastDate, cycleLength) {
  const ovulationDay = new Date(lastDate);
  ovulationDay.setDate(ovulationDay.getDate() + (cycleLength - 14));

  const fertileStart = new Date(ovulationDay);
  fertileStart.setDate(fertileStart.getDate() - 5);

  const fertileEnd = new Date(ovulationDay);
  fertileEnd.setDate(fertileEnd.getDate() + 1);

  return { fertileStart, fertileEnd, ovulationDay };
}

/* ======================
   5.3 — VALIDATION
====================== */

/**
 * Returns true if n is a valid cycle length (21–35).
 * @param {number} n
 * @returns {boolean}
 */
export function validateCycleLength(n) {
  return n >= 21 && n <= 35;
}

/* ======================
   5.4 — CALENDAR RENDERING
====================== */

/**
 * Returns the CSS class for a given date based on period data.
 * @param {Date} date
 * @param {{ lastPeriodDate: string, cycleLength: number }} periodData
 * @returns {string}
 */
export function getDayClass(date, periodData) {
  if (!periodData || !periodData.lastPeriodDate) return "day-normal";

  const last = new Date(periodData.lastPeriodDate);
  const cycleLength = periodData.cycleLength || 28;

  // Hayz kunlari: within 5 days of lastPeriodDate (days 0–4)
  const diffFromLast = Math.floor((date - last) / (1000 * 60 * 60 * 24));
  if (diffFromLast >= 0 && diffFromLast < 5) return "day-period";

  // Fertile window
  const { fertileStart, fertileEnd } = calculateFertileWindow(last, cycleLength);
  // Normalize times to midnight for comparison
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const fs = new Date(fertileStart.getFullYear(), fertileStart.getMonth(), fertileStart.getDate());
  const fe = new Date(fertileEnd.getFullYear(), fertileEnd.getMonth(), fertileEnd.getDate());

  if (d >= fs && d <= fe) return "day-fertile";

  return "day-normal";
}

/**
 * Renders a monthly calendar grid into #periodCalendarGrid.
 * @param {number} year
 * @param {number} month  0-indexed
 * @param {{ lastPeriodDate: string, cycleLength: number }} periodData
 */
export function renderCalendar(year, month, periodData) {
  const grid = document.getElementById("periodCalendarGrid");
  if (!grid) return;

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let html = "";

  // Day headers
  dayNames.forEach(d => {
    html += `<div class="calendar-day day-header">${d}</div>`;
  });

  // First day of month (0=Sun … 6=Sat), convert to Mon-based (0=Mon … 6=Sun)
  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay === 0) ? 6 : firstDay - 1;

  // Empty cells before first day
  for (let i = 0; i < offset; i++) {
    html += `<div class="calendar-day day-empty"></div>`;
  }

  // Days of month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const cls = getDayClass(date, periodData);
    html += `<div class="calendar-day ${cls}">${d}</div>`;
  }

  grid.innerHTML = html;
}

/* ======================
   5.5 — FIRESTORE
====================== */

/**
 * Saves period data to Firestore (one doc per user).
 * @param {{ userId: string, lastPeriodDate: string, cycleLength: number }} data
 */
export async function savePeriodData(data) {
  const { userId, lastPeriodDate, cycleLength } = data;
  await setDoc(doc(db, "period_data", userId), {
    userId,
    lastPeriodDate,
    cycleLength,
    updatedAt: serverTimestamp()
  });
}

/**
 * Loads period data for the current user from Firestore.
 * @returns {Promise<{ lastPeriodDate: string, cycleLength: number } | null>}
 */
export async function loadPeriodData() {
  const user = auth.currentUser;
  if (!user) return null;

  const snap = await getDoc(doc(db, "period_data", user.uid));
  if (!snap.exists()) return null;

  const { lastPeriodDate, cycleLength } = snap.data();
  return { lastPeriodDate, cycleLength };
}

/* ======================
   5.1 — INIT
====================== */

/**
 * Sets up interactivity for the info cards section.
 * The cards (Overview, This Week, Milestones, Symptoms, AI Advice) are
 * already in the HTML template; this wires up the Symptoms textarea.
 */
function renderInfoCards() {
  const updateSymptomsBtn = document.getElementById("updateSymptomsBtn");
  if (updateSymptomsBtn) {
    updateSymptomsBtn.addEventListener("click", () => {
      const textarea = document.getElementById("symptomsTextarea");
      if (textarea) {
        // Persist locally (Firestore extension can be added later)
        localStorage.setItem("pediamom_symptoms", textarea.value);
        updateSymptomsBtn.textContent = "✅ Saved";
        setTimeout(() => { updateSymptomsBtn.textContent = "Update"; }, 1500);
      }
    });

    // Restore saved symptoms
    const saved = localStorage.getItem("pediamom_symptoms");
    const textarea = document.getElementById("symptomsTextarea");
    if (saved && textarea) textarea.value = saved;
  }
}

/**
 * Loads saved period data and initialises the calendar UI.
 */
async function initPeriodCalendar() {
  const user = auth.currentUser;
  if (!user) return;

  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth();
  let periodData = null;

  // Load saved data
  try {
    periodData = await loadPeriodData();
    if (periodData) {
      const lastPeriodInput = document.getElementById("lastPeriodDate");
      const cycleLengthInput = document.getElementById("cycleLength");
      if (lastPeriodInput) lastPeriodInput.value = periodData.lastPeriodDate;
      if (cycleLengthInput) cycleLengthInput.value = periodData.cycleLength;
      updateNextPeriodDisplay(periodData);
    }
  } catch (e) {
    console.error("Failed to load period data:", e);
  }

  renderCalendar(currentYear, currentMonth, periodData);
  updateCalendarTitle(currentYear, currentMonth);

  // Save button
  const saveBtn = document.getElementById("savePeriodBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const lastPeriodInput = document.getElementById("lastPeriodDate");
      const cycleLengthInput = document.getElementById("cycleLength");

      const lastPeriodDate = lastPeriodInput ? lastPeriodInput.value : "";
      const cycleLength = cycleLengthInput ? parseInt(cycleLengthInput.value, 10) : 28;

      if (!lastPeriodDate) {
        alert("Please enter the last period date.");
        return;
      }

      if (!validateCycleLength(cycleLength)) {
        alert("Cycle length must be between 21 and 35 days.");
        return;
      }

      try {
        await savePeriodData({ userId: user.uid, lastPeriodDate, cycleLength });
        periodData = { lastPeriodDate, cycleLength };
        renderCalendar(currentYear, currentMonth, periodData);
        updateNextPeriodDisplay(periodData);
        saveBtn.textContent = "✅ Saved";
        setTimeout(() => { saveBtn.textContent = "Save"; }, 1500);
      } catch (e) {
        console.error("Failed to save period data:", e);
        alert("Failed to save. Please try again.");
      }
    });
  }

  // Prev month
  const prevBtn = document.getElementById("calendarPrev");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
      renderCalendar(currentYear, currentMonth, periodData);
      updateCalendarTitle(currentYear, currentMonth);
    });
  }

  // Next month
  const nextBtn = document.getElementById("calendarNext");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
      renderCalendar(currentYear, currentMonth, periodData);
      updateCalendarTitle(currentYear, currentMonth);
    });
  }
}

function updateCalendarTitle(year, month) {
  const title = document.getElementById("calendarTitle");
  if (!title) return;
  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
  title.textContent = `${monthNames[month]} ${year}`;
}

function updateNextPeriodDisplay(periodData) {
  const el = document.getElementById("nextPeriodInfo");
  if (!el || !periodData || !periodData.lastPeriodDate) return;

  const last = new Date(periodData.lastPeriodDate);
  const next = calculateNextPeriod(last, periodData.cycleLength || 28);
  const formatted = next.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  el.textContent = `📅 Next period expected: ${formatted}`;
}

/**
 * Main init function for the Pregnancy page.
 */
export function initPregnancyModule() {
  renderInfoCards();
  initPeriodCalendar();
}
