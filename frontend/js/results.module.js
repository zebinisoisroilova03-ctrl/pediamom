// results.module.js (FINAL, SPA-friendly)
// ✅ Fixes:
// 1) export initResultsModule() bor (dashboard.js dagi error ketadi)
// 2) filter change'da qayta-qayta onAuthStateChanged qo'ymaydi (memory leak yo'q)
// 3) page'dan chiqib ketganda DOM null bo'lsa crash qilmaydi
// 4) o'chirilgan child natijalari UI'da ham, chart'da ham ko'rinmaydi
// 5) child tanlanmaguncha trend umuman chiqmaydi (hint chiqadi)
// 6) type === "" (All Types) holatida blood + vitamin bitta chartda ko'rsatiladi

import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  deleteDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let uid = null;
let unsubAuth = null;

let trendChart = null;
let currentEditDocId = null;
let childrenMap = {};

let listenersAttached = false;

/* ======================
   PUBLIC API (Dashboard calls this)
====================== */
export function initResultsModule() {
  // SPA: page DOM hali render bo'lganini tekshiramiz
  const resultsList = document.getElementById("resultsList");
  const childFilter = document.getElementById("childFilter");
  const typeFilter = document.getElementById("typeFilter");
  const editForm = document.getElementById("editForm");
  const closeEdit = document.getElementById("closeEdit");
  const overlay = document.getElementById("overlay");

  if (!resultsList || !childFilter || !typeFilter || !editForm || !closeEdit || !overlay) {
    // Results page DOM yo'q bo'lsa init qilmaymiz
    return;
  }

  // Auth listener (faqat 1 marta)
  if (unsubAuth) unsubAuth();

  unsubAuth = onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    uid = user.uid;

    // Children dropdown load
    await loadChildrenIntoFilter(uid);

    // UI events (faqat 1 marta attach)
    if (!listenersAttached) {
      attachStaticListeners();
      listenersAttached = true;
    }

    // First render
    await loadResults(uid);
    await updateTrendChart(uid);
  });
}

/* ======================
   OPTIONAL (if you want later)
====================== */
export function destroyResultsModule() {
  // auth unsubscribe
  if (unsubAuth) {
    unsubAuth();
    unsubAuth = null;
  }

  // chart cleanup
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }

  uid = null;
  currentEditDocId = null;
  childrenMap = {};
  listenersAttached = false;
}

/* ======================
   STATIC LISTENERS
====================== */
function attachStaticListeners() {
  const childFilter = document.getElementById("childFilter");
  const typeFilter = document.getElementById("typeFilter");

  const editForm = document.getElementById("editForm");
  const closeEdit = document.getElementById("closeEdit");
  const overlay = document.getElementById("overlay");

  // Filters (NO more onAuthStateChanged inside)
  childFilter.addEventListener("change", async () => {
    if (!uid) return;
    await loadResults(uid);
    await updateTrendChart(uid);
  });

  typeFilter.addEventListener("change", async () => {
    if (!uid) return;
    await loadResults(uid);
    await updateTrendChart(uid);
  });

  // Edit save
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!uid || !currentEditDocId) return;

    const formData = new FormData(editForm);
    const updatedValues = {};
    formData.forEach((v, k) => (updatedValues[k] = Number(v)));

    try {
      await updateDoc(doc(db, "medical_results", currentEditDocId), {
        values: updatedValues
      });

      closeEditModal();
      showMessage("Analysis updated!", "success");

      await loadResults(uid);
      await updateTrendChart(uid);
    } catch (err) {
      console.error(err);
      showMessage("Error updating analysis!", "error");
    }
  });

  // Close modal
  closeEdit.addEventListener("click", closeEditModal);
  overlay.addEventListener("click", closeEditModal);
}

/* ======================
   HELPERS: MODAL + MESSAGE
====================== */
function closeEditModal() {
  const editModal = document.getElementById("editModal");
  const overlay = document.getElementById("overlay");
  if (editModal) editModal.style.display = "none";
  if (overlay) overlay.style.display = "none";
}

function showMessage(text, type = "success", duration = 3000) {
  const messageBox = document.getElementById("messageBox");
  if (!messageBox) return;

  const icon = type === "success" ? "✅" : "❌";
  messageBox.innerHTML = `<span class="icon">${icon}</span> ${text}`;
  messageBox.className = type + " show";

  let hideTimeout = setTimeout(() => {
    messageBox.classList.remove("show");
  }, duration);

  messageBox.onmouseover = () => clearTimeout(hideTimeout);
  messageBox.onmouseleave = () => {
    hideTimeout = setTimeout(() => {
      messageBox.classList.remove("show");
    }, 1500);
  };
}

/* ======================
   LOAD CHILDREN -> FILTER
====================== */
async function loadChildrenIntoFilter(parentId) {
  const childFilter = document.getElementById("childFilter");
  if (!childFilter) return;

  const snap = await getDocs(
    query(collection(db, "children"), where("parentId", "==", parentId))
  );

  childrenMap = {};
  childFilter.innerHTML = `<option value="">All Children</option>`;

  snap.forEach((d) => {
    childrenMap[d.id] = d.data().name;
    const option = document.createElement("option");
    option.value = d.id;
    option.textContent = d.data().name;
    childFilter.appendChild(option);
  });
}

/* ======================
   LOAD RESULTS
====================== */
async function loadResults(parentId) {
  const resultsList = document.getElementById("resultsList");
  const childFilter = document.getElementById("childFilter");
  const typeFilter = document.getElementById("typeFilter");

  // ✅ SPA guard
  if (!resultsList || !childFilter || !typeFilter) return;

  resultsList.innerHTML = "";

  const snapshot = await getDocs(
    query(collection(db, "medical_results"), where("parentId", "==", parentId))
  );

  snapshot.forEach((docItem) => {
    const result = docItem.data();

    // ✅ filterlar
    if (childFilter.value && result.childId !== childFilter.value) return;
    if (typeFilter.value && result.type !== typeFilter.value) return;

    // ✅ bola o'chgan bo'lsa UI'da ko'rsatmaymiz
    if (!childrenMap[result.childId]) return;

    const li = document.createElement("li");

    const valuesHTML = Object.entries(result.values || {})
      .map(
        ([key, value]) => `
          <span class="value-chip">
            ${key}: <strong>${value}</strong>
          </span>
        `
      )
      .join("");

    li.innerHTML = `
      <div class="info">
        <div class="card-header">
          <span class="child-name">${childrenMap[result.childId]}</span>
          <span class="type-badge ${result.type}">${result.type}</span>
        </div>

        <div class="values">${valuesHTML}</div>

        <div class="date">
          📅 ${result.createdAt?.toDate?.().toLocaleString?.() || "N/A"}
        </div>
      </div>

      <div class="actions">
        <button data-id="${docItem.id}" class="editBtn">✏️ Edit</button>
        <button data-id="${docItem.id}" class="deleteBtn">🗑 Delete</button>
      </div>
    `;

    resultsList.appendChild(li);
  });

  // Buttons (after render)
  bindEditButtons();
  bindDeleteButtons(parentId);
}

/* ======================
   EDIT BUTTONS
====================== */
function bindEditButtons() {
  const editModal = document.getElementById("editModal");
  const overlay = document.getElementById("overlay");
  const editFields = document.getElementById("editFields");

  if (!editModal || !overlay || !editFields) return;

  document.querySelectorAll(".editBtn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const docId = e.currentTarget.dataset.id;
      currentEditDocId = docId;

      const docSnap = await getDocs(
        query(collection(db, "medical_results"), where("__name__", "==", docId))
      );
      if (docSnap.empty) return;

      const docData = docSnap.docs[0].data();

      editFields.innerHTML = "";
      for (const key in (docData.values || {})) {
        const div = document.createElement("div");
        div.innerHTML = `
          <label>${key}:</label>
          <input type="number" name="${key}" value="${docData.values[key]}" required>
        `;
        editFields.appendChild(div);
      }

      editModal.style.display = "block";
      overlay.style.display = "block";
    });
  });
}

/* ======================
   DELETE BUTTONS
====================== */
function bindDeleteButtons(parentId) {
  document.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const docId = e.currentTarget.dataset.id;

      if (!confirm("Are you sure, you want to delete this analysis?")) return;

      try {
        await deleteDoc(doc(db, "medical_results", docId));
        await loadResults(parentId);
        await updateTrendChart(parentId);
        showMessage("Analysis deleted!", "success");
      } catch (err) {
        console.error(err);
        showMessage("Error deleting analysis!", "error");
      }
    });
  });
}

/* ======================
   CHART
====================== */

// Colors for known metric keys
const DATASET_COLORS = {
  hemoglobin: "rgba(54, 162, 235, 1)",   // blue
  ferritin:   "rgba(255, 99, 132, 1)",   // pink
  vitaminD:   "rgba(255, 159, 64, 1)",   // orange
  vitaminB12: "rgba(153, 102, 255, 1)"   // purple
};

export function drawTrendChart(results, type) {
  const canvas = document.getElementById("trendChart");
  if (!canvas) return null;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // type === "" means All Types; otherwise filter by specific type
  const filtered = type === ""
    ? [...results]
    : results.filter((r) => r.type === type);

  if (filtered.length === 0) {
    if (trendChart) {
      trendChart.destroy();
      trendChart = null;
    }
    return null;
  }

  filtered.sort(
    (a, b) =>
      (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0)
  );

  // Build unified label list (M/D/YYYY format)
  const labelSet = [];
  filtered.forEach((r) => {
    const d = r.createdAt?.toDate?.();
    const label = d
      ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
      : "N/A";
    if (!labelSet.includes(label)) labelSet.push(label);
  });

  // Collect datasets keyed by metric name, aligned to labelSet
  const datasetMap = {};
  filtered.forEach((r) => {
    const d = r.createdAt?.toDate?.();
    const label = d
      ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
      : "N/A";
    const idx = labelSet.indexOf(label);

    for (const key in (r.values || {})) {
      if (!datasetMap[key]) {
        datasetMap[key] = new Array(labelSet.length).fill(null);
      }
      datasetMap[key][idx] = r.values[key];
    }
  });

  const chartDatasets = Object.keys(datasetMap).map((key) => ({
    label: key,
    data: datasetMap[key],
    fill: false,
    tension: 0.3,
    borderColor: DATASET_COLORS[key] || "rgba(100, 100, 100, 1)",
    backgroundColor: DATASET_COLORS[key] || "rgba(100, 100, 100, 0.2)",
    spanGaps: true
  }));

  const chartTitle = type === ""
    ? "All Types Trend"
    : `${type.charAt(0).toUpperCase() + type.slice(1)} Trend`;

  if (trendChart) trendChart.destroy();

  trendChart = new Chart(ctx, {
    type: "line",
    data: { labels: labelSet, datasets: chartDatasets },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: chartTitle
        },
        legend: { display: true, position: "bottom" }
      },
      scales: { y: { beginAtZero: true } }
    }
  });

  return trendChart;
}

/* ======================
   UPDATE TREND CHART
====================== */
async function updateTrendChart(parentId) {
  const childFilter = document.getElementById("childFilter");
  const typeFilter = document.getElementById("typeFilter");
  const trendHint = document.getElementById("trendHint");

  // ✅ SPA guard
  if (!childFilter || !typeFilter) return;

  // ✅ Child tanlanmagan bo'lsa — trend umuman chiqmasin
  if (!childFilter.value) {
    if (trendChart) {
      trendChart.destroy();
      trendChart = null;
    }
    if (trendHint) trendHint.style.display = "block";
    return;
  } else {
    if (trendHint) trendHint.style.display = "none";
  }

  const snapshot = await getDocs(
    query(collection(db, "medical_results"), where("parentId", "==", parentId))
  );

  const allResults = [];

  snapshot.forEach((d) => {
    const data = d.data();

    // ✅ bola o'chirilgan bo'lsa — chartga ham qo'shmaymiz
    if (!childrenMap[data.childId]) return;

    // ✅ tanlangan child bo'yicha
    if (childFilter.value && data.childId !== childFilter.value) return;

    allResults.push(data);
  });

  // Default to "" (All Types) instead of "blood"
  const selectedType = typeFilter.value;
  drawTrendChart(allResults, selectedType);
}
