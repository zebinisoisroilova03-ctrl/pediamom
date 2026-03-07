import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

  // ✅ AUTH PAGE (login / register) — faqat ruxsat bo‘lsa ko‘rsat
  const authPage = document.getElementById("authPage");
  if (authPage) {
    authPage.style.display = "block";
  }

  // ✅ INDEX (landing) — faqat ruxsat bo‘lsa ko‘rsat
  if (isIndex) {
    const app = document.getElementById("app");
    if (app) app.style.display = "block";
  }
});


/* =======================
   REGISTER
======================= */
const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    createUserWithEmailAndPassword(auth, email, password)
      .then(() => {
        window.location.href = "./dashboard.html";
      })
      .catch((err) => alert(err.message));
  });
}


/* =======================
   LOGIN
======================= */
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    signInWithEmailAndPassword(auth, email, password)
      .then(() => {
        window.location.href = "./dashboard.html";
      })
      .catch((err) => alert(err.message));
  });
}


/* =======================
   LOGOUT
======================= */
const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    signOut(auth).then(() => {
      window.location.href = "../index.html";
    });
  });
}
