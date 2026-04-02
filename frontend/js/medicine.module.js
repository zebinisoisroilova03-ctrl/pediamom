import { db, auth } from "./firebase.js";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let userId = null;
let unsubscribe = null;
let unsubscribeSupplements = null;
let deleteTargetId = null;

/* ======================
   INIT
====================== */
export function initMedicineModule() {
  onAuthStateChanged(auth, user => {
    if (!user) return;

    userId = user.uid;

    setupTabs();
    setupMedicineForm();
    setupConfirmModal();      // global confirmModal
    loadChildrenDropdown();   // realtime dropdown + auto refresh list
    setupChildFilter();       // change filter
    loadMedicineList("");     // default: empty until child selected
    loadSupplements(userId);
    setupSupplementForm();
  });
}

/* ======================
   TABS
====================== */
export function setupTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      if (tab === "child-medicines") {
        showChildMedicinesTab();
      } else if (tab === "my-supplements") {
        showSupplementsTab();
      }
    });
  });
}

export function showChildMedicinesTab() {
  const childTab = document.querySelector('.tab-content[data-tab="child-medicines"]');
  const suppTab = document.querySelector('.tab-content[data-tab="my-supplements"]');
  if (childTab) childTab.classList.add("active");
  if (suppTab) suppTab.classList.remove("active");
}

export function showSupplementsTab() {
  const childTab = document.querySelector('.tab-content[data-tab="child-medicines"]');
  const suppTab = document.querySelector('.tab-content[data-tab="my-supplements"]');
  if (childTab) childTab.classList.remove("active");
  if (suppTab) suppTab.classList.add("active");
}

/* ======================
   ADD MEDICINE
====================== */
function setupMedicineForm() {
  const form = document.getElementById("addMedicineForm");
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();

    const name = document.getElementById("medicineName").value.trim();
    const dosage = document.getElementById("dosage").value.trim();
    const timesPerDay = parseInt(document.getElementById("timesPerDay").value, 10);

    const childSelect = document.getElementById("medicineChildSelect");
    const childId = childSelect ? childSelect.value : "";

    if (!childId) {
      alert("Please select a child before adding medicine.");
      return;
    }

    if (!name || !dosage || !timesPerDay) return;

    await addDoc(collection(db, "medicine_list"), {
      parentId: userId,
      childId,
      name,
      dosage,
      timesPerDay,
      createdAt: new Date()
    });

    form.reset();
    loadMedicineList(childId);
  };
}

/* ======================
   SUPPLEMENT FORM
====================== */
function setupSupplementForm() {
  const form = document.getElementById("addSupplementForm");
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();

    const name = document.getElementById("supplementName").value.trim();
    const dosage = document.getElementById("supplementDosage").value.trim();
    const timesPerDay = parseInt(document.getElementById("supplementTimesPerDay").value, 10);

    if (!name || !dosage || !timesPerDay) return;

    await addSupplement(userId, { name, dosage, timesPerDay });
    form.reset();
  };
}

/* ======================
   SUPPLEMENTS — LOAD
====================== */
export function loadSupplements(uid) {
  const ul = document.getElementById("supplementList");
  if (!ul || !uid) return;

  if (unsubscribeSupplements) unsubscribeSupplements();

  const q = query(
    collection(db, "supplements_list"),
    where("userId", "==", uid)
  );

  unsubscribeSupplements = onSnapshot(q, snapshot => {
    ul.innerHTML = "";

    snapshot.forEach(docItem => {
      const data = docItem.data();
      const li = document.createElement("li");

      li.innerHTML = `
        <span class="text">
          ${escapeHtml(data.name)} — ${escapeHtml(data.dosage)} (${Number(data.timesPerDay)}x/day)
        </span>
        <div class="actions">
          <button class="deleteBtn">Delete</button>
        </div>
      `;

      li.querySelector(".deleteBtn").onclick = () => {
        deleteSupplement(docItem.id, data.name);
      };

      ul.appendChild(li);
    });
  });
}

/* ======================
   SUPPLEMENTS — ADD
====================== */
export async function addSupplement(uid, data) {
  await addDoc(collection(db, "supplements_list"), {
    userId: uid,
    name: data.name,
    dosage: data.dosage,
    timesPerDay: data.timesPerDay,
    createdAt: serverTimestamp()
  });
}

/* ======================
   SUPPLEMENTS — DELETE
====================== */
export function deleteSupplement(id, name) {
  deleteTargetId = id;

  const modal = document.getElementById("confirmModal");
  const text = document.getElementById("confirmText");
  if (text) text.textContent = `Delete "${name}"?`;
  if (modal) modal.classList.remove("hidden");

  // Wire up yes button for supplement deletion
  const yesBtn = document.getElementById("confirmYes");
  if (yesBtn) {
    yesBtn.onclick = async () => {
      if (!deleteTargetId) return;
      await deleteDoc(doc(db, "supplements_list", deleteTargetId));
      modal.classList.add("hidden");
      deleteTargetId = null;
    };
  }
}

/* ======================
   CONFIRM MODAL (GLOBAL)
   dashboard.html dagi:
   #confirmModal, #confirmYes, #confirmNo, #confirmText
====================== */
let confirmWired = false;
function setupConfirmModal() {
  if (confirmWired) return;
  confirmWired = true;

  const modal = document.getElementById("confirmModal");
  const yesBtn = document.getElementById("confirmYes");
  const noBtn = document.getElementById("confirmNo");

  if (!modal || !yesBtn || !noBtn) return;

  noBtn.onclick = () => {
    modal.classList.add("hidden");
    deleteTargetId = null;
  };

  yesBtn.onclick = async () => {
    if (!deleteTargetId) return;

    await deleteDoc(doc(db, "medicine_list", deleteTargetId));

    modal.classList.add("hidden");
    deleteTargetId = null;
  };
}

/* ======================
   CHILD DROPDOWN LOAD (REAL-TIME)
====================== */
function loadChildrenDropdown() {
  const childSelect = document.getElementById("medicineChildSelect");
  if (!childSelect || !userId) return;

  const childrenRef = collection(db, "children");
  const q = query(childrenRef, where("parentId", "==", userId));

  onSnapshot(q, snapshot => {
    const prevSelected = childSelect.value;

    childSelect.innerHTML = `<option value="">— Select child —</option>`;

    const existingIds = new Set();
    snapshot.forEach(docItem => {
      existingIds.add(docItem.id);

      const data = docItem.data();
      const option = document.createElement("option");
      option.value = docItem.id;
      option.textContent = data.name;
      childSelect.appendChild(option);
    });

    if (prevSelected && !existingIds.has(prevSelected)) {
      childSelect.value = "";
    } else {
      childSelect.value = prevSelected;
    }

    loadMedicineList(childSelect.value);
  });
}

/* ======================
   CHILD FILTER
====================== */
function setupChildFilter() {
  const childSelect = document.getElementById("medicineChildSelect");
  if (!childSelect) return;

  childSelect.addEventListener("change", () => {
    loadMedicineList(childSelect.value);
  });
}

/* ======================
   REALTIME MEDICINE LIST
====================== */
function loadMedicineList(selectedChildId = "") {
  const ul = document.getElementById("medicineList");
  if (!ul || !userId) return;

  if (unsubscribe) unsubscribe();

  if (!selectedChildId) {
    ul.innerHTML = "";
    return;
  }

  const q = query(
    collection(db, "medicine_list"),
    where("parentId", "==", userId),
    where("childId", "==", selectedChildId)
  );

  unsubscribe = onSnapshot(q, snapshot => {
    ul.innerHTML = "";

    snapshot.forEach(docItem => {
      const data = docItem.data();
      const li = document.createElement("li");

      li.innerHTML = `
        <span class="text">
          ${escapeHtml(data.name)} - ${escapeHtml(data.dosage)} (${Number(data.timesPerDay)}x/day)
        </span>

        <div class="actions">
          <button class="editBtn">Edit</button>
          <button class="deleteBtn">Delete</button>
        </div>
      `;

      // EDIT
      li.querySelector(".editBtn").onclick = () => {
        li.innerHTML = `
          <form class="editForm">
            <input type="text" value="${escapeAttr(data.name)}" required>
            <input type="text" value="${escapeAttr(data.dosage)}" required>
            <input type="number" value="${Number(data.timesPerDay)}" min="1" required>

            <button type="submit" class="saveBtn">Save</button>
            <button type="button" class="cancelBtn">Cancel</button>
          </form>
        `;

        const form = li.querySelector(".editForm");
        form.querySelector(".cancelBtn").onclick = () => loadMedicineList(selectedChildId);

        form.onsubmit = async (e) => {
          e.preventDefault();
          const inputs = form.querySelectorAll("input");

          await updateDoc(doc(db, "medicine_list", docItem.id), {
            name: inputs[0].value.trim(),
            dosage: inputs[1].value.trim(),
            timesPerDay: parseInt(inputs[2].value, 10)
          });
        };
      };

      // DELETE (GLOBAL MODAL)
      li.querySelector(".deleteBtn").onclick = () => {
        deleteTargetId = docItem.id;

        const modal = document.getElementById("confirmModal");
        const text = document.getElementById("confirmText");
        if (text) text.textContent = `Delete "${data.name}"?`;
        if (modal) modal.classList.remove("hidden");

        // Re-wire yes button for medicine deletion
        const yesBtn = document.getElementById("confirmYes");
        if (yesBtn) {
          yesBtn.onclick = async () => {
            if (!deleteTargetId) return;
            await deleteDoc(doc(db, "medicine_list", deleteTargetId));
            modal.classList.add("hidden");
            deleteTargetId = null;
          };
        }
      };

      ul.appendChild(li);
    });
  });
}

/* ======================
   Utils
====================== */
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("\n", " ");
}
