import { auth } from "./firebase.js";
import { db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  setDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


/* =======================
   AUTH GUARD (FINAL)
======================= */
onAuthStateChanged(auth, (user) => {
  const path = window.location.pathname;

  const isIndex =
    path.endsWith("/") || path.endsWith("index.html");

  const isLogin = path.includes("login.html");
  const isRegister = path.includes("register.html");
  const isAuthPage = isLogin || isRegister;

  const isDashboard = path.includes("dashboard.html");

  // 🚫 login bo‘lmagan user dashboardga kira olmaydi
  if (!user && isDashboard) {
    window.location.href = "./login.html";
    return;
  }

  // 🚫 login bo‘lgan user login/registerga kirmaydi
  if (user && isAuthPage) {
    window.location.href = "./dashboard.html";
    return;
  }

  // ✅ AUTH PAGE
  const authPage = document.getElementById("authPage");
  if (authPage) {
    authPage.style.display = "block";
  }

  // ✅ INDEX
  if (isIndex) {
    const app = document.getElementById("app");
    if (app) app.style.display = "block";
  }
});

/* =======================
   DOM READY
======================= */
document.addEventListener("DOMContentLoaded", () => {

  /* ========= REGISTER ========= */
  const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = registerForm.querySelector("#email").value;
    const password = registerForm.querySelector("#password").value;

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = userCredential.user;

      console.log("Creating Firestore doc for:", user.uid);

      await setDoc(
        doc(db, "users", user.uid),
        {
          email: user.email,
          role: "parent",
          createdAt: serverTimestamp()
        }
      );

      console.log("Firestore document successfully created");

      window.location.href = "./dashboard.html";

    } catch (err) {
      console.error("REGISTER ERROR:", err);
      alert(err.message);
    }
  });
}
  /* ========= LOGIN ========= */
  const loginForm = document.getElementById("loginForm");

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = loginForm.querySelector("#email").value;
      const password = loginForm.querySelector("#password").value;

      try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = "./dashboard.html";
      } catch (err) {
        alert(err.message);
      }
    });
  }

});