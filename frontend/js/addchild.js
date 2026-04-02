import { auth } from "./firebase.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const db = getFirestore();

const form = document.getElementById("childForm");
const messageBox = document.getElementById("addChildMessageBox");

// 🔔 Message box helper
function showMessage(text, type = "success") {
  messageBox.textContent = text;
  messageBox.className = type;
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("name").value;
    const age = Number(document.getElementById("age").value);
    const gender = document.getElementById("gender").value;
    const ageUnit = document.getElementById("ageUnit").value;

    try {
      await addDoc(collection(db, "children"), {
        name,
        age,
        gender,
        ageUnit,
        parentId: user.uid,
        createdAt: serverTimestamp()
      });

      showMessage("✅ Child added successfully!", "success");
      form.reset();

      // ⏳ 2 soniyadan keyin childlist page
      setTimeout(() => {
        window.location.href = "childlist.html";
      }, 2000);

    } catch (err) {
      console.error(err);
      showMessage("❌ Error adding child", "error");
    }
  });
});
