import { auth, db } from "./firebase.js";
import {
  doc, getDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentUser = null;

export function initSettingsModule() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    currentUser = user;
    await loadUserProfile();
    setupEventListeners();
    restorePreferences();
  });
}

async function loadUserProfile() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const nameInput = document.getElementById("settingsDisplayName");
    const emailInput = document.getElementById("settingsEmail");
    const telegramInput = document.getElementById("telegramChatId");
    if (emailInput) emailInput.value = currentUser.email || "";
    if (nameInput) {
      nameInput.value = snap.exists() ? (snap.data().displayName || "") : "";
    }
    if (telegramInput && snap.exists()) {
      telegramInput.value = snap.data().telegramChatId || "";
    }
  } catch (e) {
    console.error("loadUserProfile error:", e);
  }
}

export function validatePasswordMatch(p1, p2) {
  return p1 === p2;
}

export function toggleDarkMode(enabled) {
  if (enabled) {
    document.body.dataset.theme = "dark";
  } else {
    delete document.body.dataset.theme;
  }
  localStorage.setItem("pediamom_darkmode", enabled ? "1" : "0");
}

function restorePreferences() {
  const darkToggle = document.getElementById("darkModeToggle");
  if (darkToggle) {
    const saved = localStorage.getItem("pediamom_darkmode") === "1";
    darkToggle.checked = saved;
    if (saved) document.body.dataset.theme = "dark";
  }
  const notifToggle = document.getElementById("notificationsToggle");
  if (notifToggle) {
    notifToggle.checked = localStorage.getItem("pediamom_notifications") !== "0";
  }
}

function showMessage(text, type = "success") {
  const box = document.getElementById("settingsMessage");
  if (!box) return;
  box.textContent = text;
  box.className = `settings-message ${type}`;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 3000);
}

function setupEventListeners() {
  // Save profile
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", async () => {
      const name = document.getElementById("settingsDisplayName")?.value.trim();
      if (!name) { showMessage("Please enter a display name", "error"); return; }
      try {
        await updateDoc(doc(db, "users", currentUser.uid), { displayName: name });
        showMessage("Profile saved successfully!");
      } catch (e) {
        showMessage("Failed to save profile", "error");
      }
    });
  }

  // Change password
  const changePasswordBtn = document.getElementById("changePasswordBtn");
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener("click", async () => {
      const currentPw = document.getElementById("currentPassword")?.value;
      const newPw = document.getElementById("newPassword")?.value;
      const confirmPw = document.getElementById("confirmPassword")?.value;
      const errorEl = document.getElementById("passwordError");

      if (!currentPw || !newPw || !confirmPw) {
        if (errorEl) { errorEl.textContent = "Please fill all password fields"; errorEl.style.display = "block"; }
        return;
      }
      if (!validatePasswordMatch(newPw, confirmPw)) {
        if (errorEl) { errorEl.textContent = "New passwords do not match"; errorEl.style.display = "block"; }
        return;
      }
      if (errorEl) errorEl.style.display = "none";

      try {
        const credential = EmailAuthProvider.credential(currentUser.email, currentPw);
        await reauthenticateWithCredential(currentUser, credential);
        await updatePassword(currentUser, newPw);
        showMessage("Password changed successfully!");
        document.getElementById("currentPassword").value = "";
        document.getElementById("newPassword").value = "";
        document.getElementById("confirmPassword").value = "";
      } catch (e) {
        if (errorEl) { errorEl.textContent = e.message || "Failed to change password"; errorEl.style.display = "block"; }
      }
    });
  }

  // Dark mode toggle
  const darkToggle = document.getElementById("darkModeToggle");
  if (darkToggle) {
    darkToggle.addEventListener("change", () => toggleDarkMode(darkToggle.checked));
  }

  // Notifications toggle
  const notifToggle = document.getElementById("notificationsToggle");
  if (notifToggle) {
    notifToggle.addEventListener("change", () => {
      localStorage.setItem("pediamom_notifications", notifToggle.checked ? "1" : "0");
    });
  }

  // Delete account
  const deleteBtn = document.getElementById("deleteAccountBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", showDeleteConfirmDialog);
  }

  // Telegram Chat ID save
  const saveTelegramBtn = document.getElementById("saveTelegramBtn");
  if (saveTelegramBtn) {
    saveTelegramBtn.addEventListener("click", async () => {
      const chatIdInput = document.getElementById("telegramChatId");
      const errorEl = document.getElementById("telegramChatIdError");
      const chatId = chatIdInput?.value.trim();

      if (!chatId) {
        if (errorEl) { errorEl.style.display = "block"; }
        return;
      }
      if (errorEl) errorEl.style.display = "none";

      try {
        await updateDoc(doc(db, "users", currentUser.uid), { telegramChatId: chatId });
        showMessage("Telegram Chat ID saved!");
      } catch (e) {
        showMessage("Failed to save Telegram Chat ID", "error");
      }
    });
  }
}

export function showDeleteConfirmDialog() {
  const existing = document.getElementById("deleteAccountModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "deleteAccountModal";
  modal.className = "admin-modal-overlay";
  modal.innerHTML = `
    <div class="admin-modal-box" style="max-width:400px;">
      <h3 style="color:#991b1b;">⚠️ Delete Account</h3>
      <p style="color:#475569;font-size:14px;margin-bottom:16px;">
        This action is permanent and cannot be undone. All your data will be deleted.
        Type <strong>DELETE</strong> to confirm.
      </p>
      <input type="text" id="deleteConfirmInput" placeholder='Type "DELETE" here' style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid #fecaca;font-size:14px;margin-bottom:12px;" />
      <div class="admin-modal-actions">
        <button id="confirmDeleteBtn" style="background:#ef4444;color:#fff;border:none;border-radius:10px;padding:10px;font-weight:600;cursor:pointer;flex:1;">Delete My Account</button>
        <button type="button" id="cancelDeleteBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("cancelDeleteBtn").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
    const input = document.getElementById("deleteConfirmInput")?.value;
    if (input !== "DELETE") {
      alert('Please type "DELETE" exactly to confirm.');
      return;
    }
    modal.remove();
    await deleteAccount();
  });
}

export async function deleteAccount() {
  if (!currentUser) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid));
    await deleteUser(currentUser);
    window.location.href = "../index.html";
  } catch (e) {
    alert("Failed to delete account: " + (e.message || "Please re-login and try again."));
  }
}
