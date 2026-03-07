import { auth } from "./firebase.js";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const db = getFirestore();
const form = document.getElementById("editChildForm");
const nameInput = document.getElementById("name");
const ageInput = document.getElementById("age");
const genderInput = document.getElementById("gender");
const messageBox = document.getElementById("editMessageBox");

// URL dan id olish
const urlParams = new URLSearchParams(window.location.search);
const childId = urlParams.get("id");

// 🔔 Message box function
function showMessage(text, type = "success") {
  messageBox.textContent = text;
  messageBox.className = type;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const docRef = doc(db, "children", childId);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    const child = docSnap.data();
    nameInput.value = child.name;
    ageInput.value = child.age;
    genderInput.value = child.gender;
  } else {
    showMessage("Child not found!", "error");
    setTimeout(() => {
      window.location.href = "childlist.html";
    }, 2000);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      await updateDoc(docRef, {
        name: nameInput.value,
        age: parseInt(ageInput.value),
        gender: genderInput.value
      });

      showMessage("Child updated successfully!", "success");

      // ⏳ 2 sekunddan keyin redirect
      setTimeout(() => {
        window.location.href = "childlist.html";
      }, 2000);

    } catch (error) {
      console.error("Error updating child:", error);
      showMessage("Error updating child", "error");
    }
  });
});
