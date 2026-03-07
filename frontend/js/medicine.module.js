import { db, auth } from "./firebase.js";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let userId = null;
let unsubscribe = null;
let deleteTargetId = null;

/* ======================
   INIT
====================== */
export function initMedicineModule() {
  onAuthStateChanged(auth, user => {
    if (!user) return;

    userId = user.uid;

    setupMedicineForm();
    setupConfirmModal();      // global confirmModal
    loadChildrenDropdown();   // realtime dropdown + auto refresh list
    setupChildFilter();       // change filter
    loadMedicineList("");     // default: empty until child selected
  });
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
    // selectni o'zgartirmaymiz
    loadMedicineList(childId);
  };
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
   ✅ deleted child selectda qolib ketmasin
   ✅ har safar hozirgi tanlov bo'yicha list refresh
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

    // Agar oldingi tanlov endi mavjud bo'lmasa -> reset
    if (prevSelected && !existingIds.has(prevSelected)) {
      childSelect.value = "";
    } else {
      childSelect.value = prevSelected; // saqlab qolamiz
    }

    // Dorilarni har doim hozirgi tanlov bo'yicha refresh qilamiz
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
   ✅ child tanlanmasa ro'yxat bo'sh
====================== */
function loadMedicineList(selectedChildId = "") {
  const ul = document.getElementById("medicineList");
  if (!ul || !userId) return;

  if (unsubscribe) unsubscribe();

  // child tanlanmasa: list bo'sh
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