import { auth } from "./firebase.js";
import {
  getFirestore,
  collection,
  query,
  where,
  addDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const db = getFirestore();

let userId = null;
let editId = null;

// Global confirm modal state
let pendingDeleteChildId = null;

export function initChildrenModule() {
  onAuthStateChanged(auth, user => {
    if (!user) return;
    userId = user.uid;

    setupUI();
    loadChildren();
  });
}

/* ======================
   LOAD CHILDREN
====================== */
async function loadChildren() {
  const list = document.getElementById("childList");
  if (!list || !userId) return;

  list.innerHTML = "";

  const q = query(collection(db, "children"), where("parentId", "==", userId));
  const snap = await getDocs(q);

  snap.forEach(docSnap => {
    const c = docSnap.data();

    const li = document.createElement("li");
    li.className = "child-card";

    li.innerHTML = `
      <div class="child-info">
        <span class="child-name">${escapeHtml(c.name ?? "")}</span>
        <span class="divider">|</span>
        <span class="child-age">${Number(c.age ?? 0)} yrs</span>
        <span class="divider">|</span>
        <span class="gender">${escapeHtml(c.gender ?? "")}</span>
      </div>

      <div class="child-actions">
        <button class="editBtn" data-id="${docSnap.id}">Edit</button>
        <button class="deleteBtn" data-id="${docSnap.id}">Delete</button>
      </div>
    `;

    // actions
    li.querySelector(".editBtn").onclick = () => openModal(c, docSnap.id);
    li.querySelector(".deleteBtn").onclick = () => openDeleteConfirm(docSnap.id, c?.name);

    list.appendChild(li);
  });
}

/* ======================
   UI LOGIC
====================== */
function setupUI() {
  const addChildBtn = document.getElementById("addChildBtn");
  const closeChildModal = document.getElementById("closeChildModal");
  const childForm = document.getElementById("childForm");

  if (addChildBtn) addChildBtn.onclick = () => openModal();
  if (closeChildModal) closeChildModal.onclick = () => closeModal();

  if (childForm) {
    childForm.onsubmit = async (e) => {
      e.preventDefault();

      const name = childForm.name.value.trim();
      const age = Number(childForm.age.value);
      const gender = childForm.gender.value;

      if (!name || !age || !gender) return;

      const data = {
        name,
        age,
        gender,
        parentId: userId,
        createdAt: serverTimestamp()
      };

      if (editId) {
        await updateDoc(doc(db, "children", editId), data);
      } else {
        await addDoc(collection(db, "children"), data);
      }

      closeModal();
      loadChildren();
    };
  }

  // ✅ Global confirm modal wiring (once per init)
  wireGlobalConfirmModal();
}

/* ======================
   MODAL HELPERS (ADD/EDIT)
====================== */
function openModal(child = null, id = null) {
  editId = id;

  const modal = document.getElementById("childModal");
  const form = document.getElementById("childForm");
  if (!modal || !form) return;

  modal.classList.remove("hidden");
  const title = document.getElementById("childModalTitle");
  if (title) title.textContent = id ? "Edit Child" : "Add Child";

  form.name.value = child?.name || "";
  form.age.value = child?.age || "";
  form.gender.value = child?.gender || "";
}

function closeModal() {
  editId = null;
  const modal = document.getElementById("childModal");
  if (modal) modal.classList.add("hidden");
}

/* ======================
   DELETE via GLOBAL confirmModal
   Cloud Function cascade delete medicine_list
====================== */
function openDeleteConfirm(childId, childName = "") {
  pendingDeleteChildId = childId;

  const confirmModal = document.getElementById("confirmModal");
  const confirmText = document.getElementById("confirmText");

  if (confirmText) {
    confirmText.textContent = childName
      ? `Delete "${childName}"? This will also remove that child’s medicines.`
      : "Are you sure you want to delete this child?";
  }

  if (confirmModal) confirmModal.classList.remove("hidden");
}

let confirmWired = false;
function wireGlobalConfirmModal() {
  if (confirmWired) return;
  confirmWired = true;

  const confirmModal = document.getElementById("confirmModal");
  const yesBtn = document.getElementById("confirmYes");
  const noBtn = document.getElementById("confirmNo");

  if (!confirmModal || !yesBtn || !noBtn) return;

  noBtn.onclick = () => {
    pendingDeleteChildId = null;
    confirmModal.classList.add("hidden");
  };

  yesBtn.onclick = async () => {
    if (!pendingDeleteChildId) return;

    const id = pendingDeleteChildId;
    pendingDeleteChildId = null;

    // ✅ only delete child doc; Cloud Function will delete medicines
    await deleteDoc(doc(db, "children", id));

    confirmModal.classList.add("hidden");
    loadChildren();
  };
}

/* ======================
   Utils
====================== */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}