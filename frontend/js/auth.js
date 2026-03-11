import { auth } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =======================
   AUTH GUARD
======================= */
onAuthStateChanged(auth, (user) => {
  const path = window.location.pathname;

  const isIndex =
    path.endsWith("/") || path.endsWith("index.html");

  const isLogin = path.includes("login.html");
  const isRegister = path.includes("register.html");
  const isAuthPage = isLogin || isRegister;

  const isDashboard = path.includes("dashboard.html");

  if (!user && isDashboard) {
    window.location.href = "./login.html";
    return;
  }

  if (user && isAuthPage) {
    window.location.href = "./dashboard.html";
    return;
  }

  const authPage = document.getElementById("authPage");
  if (authPage) {
    authPage.style.display = "block";
  }

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

      const email = registerForm.querySelector("#email").value.trim();
      const password = registerForm.querySelector("#password").value;

      try {
        await createUserWithEmailAndPassword(auth, email, password);
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

      const email = loginForm.querySelector("#email").value.trim();
      const password = loginForm.querySelector("#password").value;

      try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = "./dashboard.html";
      } catch (err) {
        console.error("LOGIN ERROR:", err);
        alert(err.message);
      }
    });
  }

  /* ========= LOGOUT ========= */
  const logoutBtn = document.getElementById("logoutBtn");

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "../index.html";
      } catch (err) {
        console.error("LOGOUT ERROR:", err);
      }
    });
  }
});