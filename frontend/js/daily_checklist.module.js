import { db, auth } from "./firebase.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let userId = null;
let selectedChildId = "";
let chartInstance = null;
let unsubscribeChecklist = null;
let unsubscribeChildren = null;

const today = new Date().toISOString().split("T")[0];

/* ======================
   INIT
====================== */
export function initDailyChecklist() {
  onAuthStateChanged(auth, user => {
    if (!user) return;

    userId = user.uid;

    loadChildrenDropdown();
    setupChildFilter();

    toggleStats(false); // child tanlanmaguncha chart + warning yashirin
  });
}

/* ✅ Dashboard page change bo‘lganda chaqirish uchun */
export function destroyDailyChecklist() {
  cleanupListeners();
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

/* ======================
   CHILD DROPDOWN
====================== */
function loadChildrenDropdown() {
  const select = document.getElementById("checklistChildSelect");
  if (!select) return;

  const q = query(collection(db, "children"), where("parentId", "==", userId));

  // ✅ old listener bo‘lsa o‘chirib yuboramiz
  if (unsubscribeChildren) unsubscribeChildren();

  unsubscribeChildren = onSnapshot(q, snap => {
    // ✅ Agar sahifa DOM’dan ketgan bo‘lsa, listener’ni to‘xtatamiz
    const stillThere = document.getElementById("checklistChildSelect");
    if (!stillThere) {
      if (unsubscribeChildren) unsubscribeChildren();
      unsubscribeChildren = null;
      return;
    }

    select.innerHTML = `<option value="">— Select child —</option>`;

    snap.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.data().name;
      select.appendChild(opt);
    });
  });
}

function setupChildFilter() {
  const select = document.getElementById("checklistChildSelect");
  if (!select) return;

  select.onchange = () => {
    selectedChildId = select.value;

    cleanupListeners();

    // ✅ Bola tanlanmagan holat: checklist yashirin
    if (select.value === "") {
      toggleStats(false);
      return;
    }

    toggleStats(true);
    loadChecklistRealtime();
    drawWeeklyChart();
    checkMissedYesterday();
  };
}

function cleanupListeners() {
  if (unsubscribeChecklist) {
    unsubscribeChecklist();
    unsubscribeChecklist = null;
  }
  if (unsubscribeChildren) {
    unsubscribeChildren();
    unsubscribeChildren = null;
  }
}

/* ======================
   DAILY CHECKLIST
====================== */
const TIME_SLOTS = ["Morning", "Afternoon", "Evening", "Night"];

function loadChecklistRealtime() {
  let ul = document.getElementById("dailyChecklist");
  if (!ul) return;

  let q = query(collection(db, "medicine_list"), where("parentId", "==", userId));

  if (selectedChildId) {
    q = query(
      collection(db, "medicine_list"),
      where("parentId", "==", userId),
      where("childId", "==", selectedChildId)
    );
  }

  unsubscribeChecklist = onSnapshot(q, async snap => {
    // ✅ Har callbackda qayta tekshiramiz: DOM bormi?
    ul = document.getElementById("dailyChecklist");
    if (!ul) {
      if (unsubscribeChecklist) unsubscribeChecklist();
      unsubscribeChecklist = null;
      return;
    }

    ul.innerHTML = "";

    for (const med of snap.docs) {
      const data = med.data();
      const timesPerDay = Number(data.timesPerDay) || 1;
      const slots = TIME_SLOTS.slice(0, timesPerDay);

      for (const slot of slots) {
        // Query log for this specific medicine + date + time_slot
        const logQ = query(
          collection(db, "medicine_logs"),
          where("parentId", "==", userId),
          where("medicineId", "==", med.id),
          where("date", "==", today),
          where("time_slot", "==", slot)
        );

        const logSnap = await getDocs(logQ);
        const taken = !logSnap.empty && logSnap.docs[0].data().taken;

        const li = document.createElement("li");
        li.innerHTML = `
          <label>${data.name} – ${data.dosage} (${slot})</label>
          <input type="checkbox" ${taken ? "checked" : ""}>
        `;

        li.querySelector("input").onchange = async e => {
          if (logSnap.empty) {
            await addDoc(collection(db, "medicine_logs"), {
              parentId: userId,
              medicineId: med.id,
              childId: data.childId || "",
              date: today,
              time_slot: slot,
              taken: e.target.checked,
              updatedAt: serverTimestamp()
            });
          } else {
            await updateDoc(doc(db, "medicine_logs", logSnap.docs[0].id), {
              taken: e.target.checked,
              updatedAt: serverTimestamp()
            });
          }

          drawWeeklyChart();
          checkMissedYesterday();
        };

        ul.appendChild(li);
      }
    }
  });
}

/* ======================
   ⚠️ MISSED YESTERDAY
====================== */
async function checkMissedYesterday() {
  const warning = document.getElementById("missedWarning");
  if (!warning) return;

  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yDate = y.toISOString().split("T")[0];

  let q = query(
    collection(db, "medicine_logs"),
    where("parentId", "==", userId),
    where("date", "==", yDate)
  );

  if (selectedChildId) {
    q = query(
      collection(db, "medicine_logs"),
      where("parentId", "==", userId),
      where("childId", "==", selectedChildId),
      where("date", "==", yDate)
    );
  }

  const snap = await getDocs(q);

  if (snap.empty || snap.docs.every(d => d.data().taken === false)) {
    const yFormatted = y.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    warning.innerHTML = `⚠️ You missed medicines on ${yFormatted}`;
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
}

/* ======================
   📊 WEEKLY CHART
====================== */
async function drawWeeklyChart() {
  const canvas = document.getElementById("weeklyChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (chartInstance) chartInstance.destroy();

  const isodays = getLast7DatesISO();
  const labels = getLast7Days();
  const values = [];

  let medQ = query(collection(db, "medicine_list"), where("parentId", "==", userId));

  if (selectedChildId) {
    medQ = query(
      collection(db, "medicine_list"),
      where("parentId", "==", userId),
      where("childId", "==", selectedChildId)
    );
  }

  const medsSnap = await getDocs(medQ);
  const totalMedicines = medsSnap.size;

  for (const day of isodays) {
    if (totalMedicines === 0) {
      values.push(0);
      continue;
    }

    let logQ = query(
      collection(db, "medicine_logs"),
      where("parentId", "==", userId),
      where("date", "==", day)
    );

    if (selectedChildId) {
      logQ = query(
        collection(db, "medicine_logs"),
        where("parentId", "==", userId),
        where("childId", "==", selectedChildId),
        where("date", "==", day)
      );
    }

    const snap = await getDocs(logQ);
    const taken = snap.docs.filter(d => d.data().taken).length;

    values.push(Math.round((taken / totalMedicines) * 100));
  }

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{ label: "% Taken", data: values }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true, max: 100 } },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => `${context.parsed.y}% of medicines taken`
          }
        }
      }
    }
  });
}

/* ======================
   TOGGLE UI
====================== */
function toggleStats(show) {
  const checklist = document.getElementById("dailyChecklist");
  const chartBox = document.getElementById("weeklyChart")?.closest("div");
  const warning = document.getElementById("missedWarning");
  const hint = document.getElementById("selectChildHint");

  if (checklist) checklist.style.display = show ? "flex" : "none";
  if (chartBox) chartBox.style.display = show ? "block" : "none";
  if (warning) warning.classList.toggle("hidden", !show);

  if (hint) hint.style.display = show ? "none" : "block";
}

/* ======================
   HELPER
====================== */
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