import { auth } from "./firebase.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const db = getFirestore();
const childList = document.getElementById("childList");

/* ===============================
   TOAST MESSAGE
================================ */
const toast = document.getElementById("toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2500);
}

/* ===============================
   DELETE MODAL GLOBAL LOGIC
================================ */
const modal = document.getElementById("deleteModal");
const confirmBtn = document.getElementById("confirmDelete");
const cancelBtn = document.getElementById("cancelDelete");

let deleteTargetId = null;
let deleteTargetLi = null;

// Cancel (No)
cancelBtn.addEventListener("click", () => {
  modal.classList.add("hidden");
  deleteTargetId = null;
  deleteTargetLi = null;
});

// Confirm (Yes)
confirmBtn.addEventListener("click", async () => {
  if (!deleteTargetId) return;

  try {
    await deleteDoc(doc(db, "children", deleteTargetId));
    deleteTargetLi.remove();

    showToast("Child deleted successfully");
  } catch (error) {
    console.error("Error deleting child:", error);
    showToast("Error deleting child");
  }

  modal.classList.add("hidden");
  deleteTargetId = null;
  deleteTargetLi = null;
});

/* ===============================
   AUTH + CHILD LIST
================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const q = query(
    collection(db, "children"),
    where("parentId", "==", user.uid)
  );

  const snapshot = await getDocs(q);
  childList.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const child = docSnap.data();
    const li = document.createElement("li");

    const ageDisplay = child.ageUnit === "months"
      ? `${child.age} months`
      : `${child.age} yrs`;

    li.innerHTML = `
      <div class="child-info">
        <span class="child-name">Name: ${child.name}</span>
        <span class="divider">•</span>
        <span>Age: ${ageDisplay}</span>
        <span class="divider">•</span>
        <span class="gender ${child.gender}">
          Gender: ${child.gender}
        </span>
      </div>

      <div class="child-actions">
        <button class="editBtn" data-id="${docSnap.id}">Edit</button>
        <button class="deleteBtn" data-id="${docSnap.id}">Delete</button>
      </div>
    `;

    /* Edit */
    li.querySelector(".editBtn").addEventListener("click", (e) => {
      const id = e.target.dataset.id;
      window.location.href = `editchild.html?id=${id}`;
    });

    /* Delete → MODAL ochiladi */
    li.querySelector(".deleteBtn").addEventListener("click", (e) => {
      deleteTargetId = e.target.dataset.id;
      deleteTargetLi = li;
      modal.classList.remove("hidden");
    });

    childList.appendChild(li);
  });
});
