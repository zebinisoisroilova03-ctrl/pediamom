import { auth, db } from "./firebase.js";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let userId = null;
let unsubChildren = null;

export function initAddAnalysisModule() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    userId = user.uid;

    // SPA: DOM endi qo'shilgan bo'ladi, shuning uchun init shu yerda
    setupUI();
    loadChildrenDropdownRealtime();
  });
}

/* ======================
   UI SETUP
====================== */
function setupUI() {
  const childSelect = document.getElementById("analysisChildSelect");
  const typeSelect = document.getElementById("typeSelect");

  const bloodFields = document.getElementById("bloodFields");
  const urineFields = document.getElementById("urineFields");
  const vitaminFields = document.getElementById("vitaminFields");

  const form = document.getElementById("medicalForm");
  const messageBox = document.getElementById("messageBox");

  if (!childSelect || !typeSelect || !form || !messageBox) return;

  function showMessage(text, type = "success") {
    messageBox.style.display = "block";
    messageBox.textContent = text;

    messageBox.classList.remove("success", "error");
    messageBox.classList.add(type === "error" ? "error" : "success");

    setTimeout(() => {
      messageBox.style.display = "none";
    }, 3000);
  }

  // Type change
  typeSelect.onchange = () => {
    bloodFields.style.display = "none";
    urineFields.style.display = "none";
    vitaminFields.style.display = "none";

    if (typeSelect.value === "blood") bloodFields.style.display = "flex";
    if (typeSelect.value === "urine") urineFields.style.display = "flex";
    if (typeSelect.value === "vitamin") vitaminFields.style.display = "flex";
  };

  // Save
  form.onsubmit = async (e) => {
    e.preventDefault();

    if (!userId) {
      showMessage("You are not logged in", "error");
      return;
    }

    if (!childSelect.value) {
      showMessage("Please, select a child", "error");
      return;
    }

    if (!typeSelect.value) {
      showMessage("Please, select analysis type", "error");
      return;
    }

    const type = typeSelect.value;
    let values = {};

    // BLOOD
    if (type === "blood") {
      const hemoglobin = document.getElementById("hemoglobin")?.value;
      const iron = document.getElementById("iron")?.value;

      if (!hemoglobin || !iron) {
        showMessage("Please, fill all blood fields", "error");
        return;
      }

      values = {
        hemoglobin: Number(hemoglobin),
        iron: Number(iron)
      };
    }

    // URINE
    if (type === "urine") {
      const protein = document.getElementById("protein")?.value;
      const ph = document.getElementById("ph")?.value;

      if (!protein || !ph) {
        showMessage("Please, fill all urine fields", "error");
        return;
      }

      values = {
        protein: Number(protein),
        ph: Number(ph)
      };
    }

    // VITAMIN
    if (type === "vitamin") {
      const vitaminD = document.getElementById("vitaminD")?.value;
      const vitaminB12 = document.getElementById("vitaminB12")?.value;

      if (!vitaminD || !vitaminB12) {
        showMessage("Please, fill all vitamin fields", "error");
        return;
      }

      values = {
        vitaminD: Number(vitaminD),
        vitaminB12: Number(vitaminB12)
      };
    }

    try {
      await addDoc(collection(db, "medical_results"), {
        childId: childSelect.value,
        parentId: userId,
        type,
        values,
        createdAt: serverTimestamp()
      });

      showMessage("Medical analysis saved successfully ✅");

      form.reset();
      bloodFields.style.display = "none";
      urineFields.style.display = "none";
      vitaminFields.style.display = "none";
    } catch (err) {
      showMessage("Error saving data", "error");
    }
  };
}

/* ======================
   CHILDREN DROPDOWN (REALTIME)
====================== */
function loadChildrenDropdownRealtime() {
  const childSelect = document.getElementById("analysisChildSelect");
  if (!childSelect || !userId) return;

  // avvalgi listener bo'lsa, tozalab yuboramiz
  if (unsubChildren) unsubChildren();

  const q = query(
    collection(db, "children"),
    where("parentId", "==", userId)
  );

  unsubChildren = onSnapshot(q, (snapshot) => {
    const current = childSelect.value;

    childSelect.innerHTML = `<option value="">Select child</option>`;

    snapshot.forEach((docSnap) => {
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = docSnap.data().name;
      childSelect.appendChild(option);
    });

    // avval tanlangan bola hali bor bo'lsa, selectni saqlab qolamiz
    if (current) {
      const stillExists = Array.from(childSelect.options).some(o => o.value === current);
      if (stillExists) childSelect.value = current;
    }
  });
}