// motherhealth.module.js
import { auth, db } from "./firebase.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ── Navigation cards ─────────────────────────────────────────────────────── */
function initNavCards() {
  const cards = document.querySelectorAll(".mh-nav-card");
  cards.forEach(card => {
    card.addEventListener("click", () => {
      const targetPage = card.dataset.page;
      if (!targetPage) return;
      const menuItem = document.querySelector(`.menu-item[data-page="${targetPage}"]`);
      if (menuItem) menuItem.click();
    });
  });
}

/* ── Water Intake Card ────────────────────────────────────────────────────── */
export function calculateGlasses(liters) {
  return Math.round(liters * 4);
}

async function initWaterIntakeCard() {
  const user = auth.currentUser;
  if (!user) return;

  const litersInput   = document.getElementById("waterLiters");
  const startInput    = document.getElementById("waterStartHour");
  const endInput      = document.getElementById("waterEndHour");
  const glassesDisplay = document.getElementById("waterGlassesDisplay");
  const errorEl       = document.getElementById("waterError");
  const saveBtn       = document.getElementById("saveWaterBtn");

  if (!litersInput) return;

  // Load existing data
  try {
    const snap = await getDoc(doc(db, "water_intake", user.uid));
    if (snap.exists()) {
      const d = snap.data();
      litersInput.value  = d.dailyLiters  ?? "";
      startInput.value   = d.startHour    ?? "";
      endInput.value     = d.endHour      ?? "";
      if (d.dailyLiters) {
        glassesDisplay.textContent = `≈ ${calculateGlasses(d.dailyLiters)} glasses per day`;
      }
    }
  } catch (e) {
    console.error("Water intake load error:", e);
  }

  // Real-time glasses calculation
  litersInput.addEventListener("input", () => {
    const val = parseFloat(litersInput.value);
    if (!isNaN(val) && val > 0) {
      glassesDisplay.textContent = `≈ ${calculateGlasses(val)} glasses per day`;
    } else {
      glassesDisplay.textContent = "";
    }
  });

  // Save
  saveBtn?.addEventListener("click", async () => {
    const dailyLiters = parseFloat(litersInput.value);
    const startHour   = parseInt(startInput.value, 10);
    const endHour     = parseInt(endInput.value, 10);

    if (isNaN(dailyLiters) || dailyLiters < 0.5 || dailyLiters > 5) {
      errorEl.textContent = "Please enter a valid daily goal (0.5–5 liters)";
      errorEl.style.display = "block";
      return;
    }
    if (isNaN(startHour) || isNaN(endHour) || endHour <= startHour) {
      errorEl.textContent = "End time must be after start time";
      errorEl.style.display = "block";
      return;
    }
    errorEl.style.display = "none";

    try {
      await setDoc(doc(db, "water_intake", user.uid), {
        userId: user.uid,
        dailyLiters,
        startHour,
        endHour,
        updatedAt: serverTimestamp()
      });
      saveBtn.textContent = "✅ Saved";
      setTimeout(() => { saveBtn.textContent = "Save"; }, 1500);
    } catch (e) {
      console.error("Water intake save error:", e);
      errorEl.textContent = "Failed to save. Please try again.";
      errorEl.style.display = "block";
    }
  });
}

/* ── Doctor Appointment Card ──────────────────────────────────────────────── */
async function initAppointmentCard() {
  const user = auth.currentUser;
  if (!user) return;

  const dateInput  = document.getElementById("appointmentDate");
  const warningEl  = document.getElementById("appointmentWarning");
  const saveBtn    = document.getElementById("saveAppointmentBtn");

  if (!dateInput) return;

  // Load existing data
  try {
    const snap = await getDoc(doc(db, "appointments", user.uid));
    if (snap.exists() && snap.data().appointmentDate) {
      dateInput.value = snap.data().appointmentDate;
    }
  } catch (e) {
    console.error("Appointment load error:", e);
  }

  // Save
  saveBtn?.addEventListener("click", async () => {
    const appointmentDate = dateInput.value;
    if (!appointmentDate) {
      warningEl.textContent = "Please select a date";
      warningEl.style.display = "block";
      return;
    }

    // Past date warning (non-blocking)
    const today = new Date().toISOString().split("T")[0];
    if (appointmentDate < today) {
      warningEl.textContent = "The selected date is in the past. Are you sure?";
      warningEl.style.display = "block";
    } else {
      warningEl.style.display = "none";
    }

    try {
      await setDoc(doc(db, "appointments", user.uid), {
        userId: user.uid,
        appointmentDate,
        updatedAt: serverTimestamp()
      });
      saveBtn.textContent = "✅ Saved";
      setTimeout(() => { saveBtn.textContent = "Save"; }, 1500);
    } catch (e) {
      console.error("Appointment save error:", e);
    }
  });
}

/* ── Main init ────────────────────────────────────────────────────────────── */
export function initMotherHealthModule() {
  initNavCards();
  initWaterIntakeCard();
  initAppointmentCard();
}
