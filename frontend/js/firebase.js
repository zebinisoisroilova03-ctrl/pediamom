import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDMHgudY2eM0YQYN48Fyqybpa374sgmdg4",
  authDomain: "pediamom-bff4a.firebaseapp.com",
  projectId: "pediamom-bff4a",
  storageBucket: "pediamom-bff4a.firebasestorage.app",
  messagingSenderId: "399639001682",
  appId: "1:399639001682:web:3961238b7374880659fd8b",
  measurementId: "G-HTCXNWQ8ML"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
