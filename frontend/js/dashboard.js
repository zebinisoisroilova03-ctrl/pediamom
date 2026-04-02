// dashboard.js
import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ADMIN_UID = "rqPzKRFZ4CM4e5TnKgIhWuN0aVs2";

document.addEventListener("DOMContentLoaded", () => {
  const dashboard = document.getElementById("dashboardPage");
  if (!dashboard) return;

  const menuItems = dashboard.querySelectorAll(".menu-item");
  const content = dashboard.querySelector("#page-content");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!content || menuItems.length === 0) return;

  /* ======================
     PAGE TEMPLATES
  ====================== */
  const pages = {
    home: `
      <h1>Welcome back 👋</h1>
      <div class="cards">
        <div class="card">
          <h3>Children</h3>
          <p>Manage your children profiles</p>
        </div>
        <div class="card">
          <h3>Medicines</h3>
          <p>Track medicine schedules</p>
        </div>
        <div class="card">
          <h3>Checklist</h3>
          <p>Daily medicine tracking</p>
        </div>
      </div>
    `,

children: `<div class="children-page">
  <div class="children-header">
    <h2>My Children</h2>
  </div>

  <ul id="childList"></ul>

  <!-- ADD / EDIT MODAL -->
  <div id="childModal" class="pm-modal hidden">
    <div class="pm-modal-box">
      <h3 id="childModalTitle">Add Child</h3>

      <form id="childForm">
        <input type="text" id="name" placeholder="Child name" required />
        <input type="number" id="age" placeholder="Age" required />

        <select id="gender" required>
          <option value="">Select gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>

        <div class="pm-modal-actions">
          <button type="submit" class="pm-primary">Save</button>
          <button type="button" id="closeChildModal">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ADD CHILD BUTTON -->
  <button id="addChildBtn" class="pm-primary add-child-btn">➕ Add Child</button>
</div>

`,
    medicines: `
      <div class="medicine_list">
        <div class="container">
          <h2>Medicine List</h2>

          <div class="medicine-tabs">
            <button class="tab-btn active" data-tab="child-medicines">💊 Child Medicines</button>
            <button class="tab-btn" data-tab="my-supplements">🌿 My Supplements</button>
          </div>

          <div class="tab-content active" data-tab="child-medicines">
            <div class="medicine-child-filter">
              <label for="medicineChildSelect">Select child</label>
              <select id="medicineChildSelect">
                <option value="">— Select child —</option>
              </select>
            </div>

            <form id="addMedicineForm">
              <input type="text" id="medicineName" placeholder="Medicine name" required>
              <input type="text" id="dosage" placeholder="Dosage" required>
              <input type="number" id="timesPerDay" placeholder="Times per day" min="1" required>
              <button type="submit">Add Medicine</button>
            </form>

            <ul id="medicineList"></ul>
          </div>

          <div class="tab-content" data-tab="my-supplements">
            <form id="addSupplementForm">
              <input type="text" id="supplementName" placeholder="Supplement name" required>
              <input type="text" id="supplementDosage" placeholder="Dosage" required>
              <input type="number" id="supplementTimesPerDay" placeholder="Times per day" min="1" required>
              <button type="submit">Add Supplement</button>
            </form>

            <ul id="supplementList"></ul>
          </div>
        </div>
      </div>
    `,

    checklist: `
<div class="dailychecklist">
  <div class="container">
    <h2>Daily Medicine Checklist</h2>

    <div class="medicine-child-filter">
      <label for="childSelect">Select child</label>
      <select id="checklistChildSelect">
        <option value="">— All children —</option>
      </select>
    </div>

    <!-- 👇 HINT -->
    <p id="selectChildHint" class="hint">
      👶 Please select a child to see the checklist
    </p>

    <ul id="dailyChecklist"></ul>

    <div class="chart-box">
      <h3>📊 Weekly Medicine Consistency</h3>
      <canvas id="weeklyChart"></canvas>
    </div>

    <div id="missedWarning" class="warning hidden">
      ⚠️ Yesterday you missed your medicines
    </div>
  </div>
</div>
`,

    knowledgebase: `
  <div class="knowledge-page">
    <div class="kb-container">
      <div class="kb-header">
        <h2>Knowledge Base</h2>
        <p>Helpful educational content for parents</p>
      </div>

      <div id="kbHomeView">
        <div class="kb-categories">
          <button class="kb-category-card" data-category="harmful">
            <span class="kb-icon">⚠️</span>
            <h3>Harmful Medicines</h3>
            <p>Important warnings about unsafe medicine use for children.</p>
          </button>

          <button class="kb-category-card" data-category="immunity">
            <span class="kb-icon">🛡️</span>
            <h3>Immunity Tips</h3>
            <p>Simple ways to support your child’s immunity and daily health.</p>
          </button>

          <button class="kb-category-card" data-category="vaccines">
            <span class="kb-icon">💉</span>
            <h3>Vaccines Info</h3>
            <p>Basic vaccine education and guidance for parents.</p>
          </button>

          <button class="kb-category-card" data-category="herbal">
            <span class="kb-icon">🌿</span>
            <h3>Natural Herbal Beverages</h3>
            <p>Safe and beneficial herbal drinks for children's health.</p>
          </button>

          <button class="kb-category-card" data-category="nutrition">
            <span class="kb-icon">🥗</span>
            <h3>Child Nutrition Tips</h3>
            <p>Practical nutrition advice for healthy child development.</p>
          </button>

          <button class="kb-category-card" data-category="sleep">
            <span class="kb-icon">😴</span>
            <h3>Sleep & Development</h3>
            <p>Understanding sleep patterns and their role in child growth.</p>
          </button>
        </div>
      </div>

      <div id="kbListView" class="hidden">
        <div class="kb-topbar">
          <button id="kbBackToHome" class="kb-back-btn">← Back</button>
          <h3 id="kbCategoryTitle"></h3>
        </div>
        <div id="kbArticlesList" class="kb-articles-list"></div>
      </div>

      <div id="kbDetailView" class="hidden">
        <div class="kb-topbar">
          <button id="kbBackToList" class="kb-back-btn">← Back</button>
        </div>

        <article class="kb-article-detail">
          <h3 id="kbDetailTitle"></h3>
          <p id="kbDetailSummary" class="kb-summary"></p>

          <div id="kbDetailWarning" class="kb-warning hidden"></div>

          <div id="kbDetailContent" class="kb-content"></div>
        </article>
      </div>
    </div>
  </div>
`,

    savedarticles: `
<div class="saved-articles-page">
  <h2>⭐ Saved Articles</h2>
  <div id="savedArticlesGrid" class="saved-articles-grid"></div>
</div>
`,

    addanalysis: `
  <div class="addanalysis">
    <div class="container">

      <div class="header">
        <h2>Add Medical Analysis</h2>
        <div id="messageBox" style="display:none;"></div>
      </div>

      <form id="medicalForm" novalidate>

        <label>Child</label>
        <select id="analysisChildSelect">
          <option value="">Select child</option>
        </select>

        <label>Analysis Type</label>
        <select id="typeSelect">
          <option value="">Select type</option>
          <option value="blood">Blood</option>
          <option value="vitamin">Vitamin</option>
        </select>

        <div id="bloodFields" style="display:none;">
          <h4>Blood Analysis</h4>
          <input type="number" id="hemoglobin" placeholder="Hemoglobin" />
          <input type="number" id="ferritin" name="ferritin" placeholder="Ferritin" />
        </div>

        <div id="vitaminFields" style="display:none;">
          <h4>Vitamin Analysis</h4>
          <input type="number" id="vitaminD" placeholder="Vitamin D" />
          <input type="number" id="vitaminB12" placeholder="Vitamin B12" />
        </div>

        <button type="submit">Save Analysis</button>
      </form>
      <div id="aiSummaryBlock" style="display:none"></div>

    </div>
  </div>
`,
    results: `
  <div class="results-page">
    <div class="container">
      <h2>Medical Results History & Trends</h2>

      <div class="filters">
        <label for="childFilter">Filter by Child:</label>
        <select id="childFilter">
          <option value="">All Children</option>
        </select>

        <label for="typeFilter">Filter by Type:</label>
        <select id="typeFilter">
          <option value="">All Types</option>
          <option value="blood">Blood</option>
          <option value="vitamin">Vitamin</option>
        </select>
      </div>

      <div id="messageBox"></div>

      <div class="content">
        <div class="results">
          <h3>Analysis Results</h3>
          <ul id="resultsList"></ul>
        </div>

        <div class="chart">
          <h3>Trend Chart</h3>
          <p id="trendHint" class="hint">👶 Please select a child to see the trend</p>
          <canvas id="trendChart"></canvas>
        </div>
      </div>

      <div id="editModal">
        <h3>Edit Analysis</h3>
        <form id="editForm">
          <div id="editFields"></div>
          <div class="modal-buttons">
            <button type="submit">Save</button>
            <button type="button" id="closeEdit">Cancel</button>
          </div>
        </form>
      </div>

      <div id="overlay"></div>
    </div>
  </div>
`,

    motherhealth: `
  <div class="mother-health-page">
    <div class="container">
      <h2>Mother Health Tracker</h2>
      <div id="motherHealthContent"></div>
    </div>
  </div>
`,

    admin: `
  <div class="admin-page">
    <div class="admin-header">
      <h2>👑 Admin Panel</h2>
      <button id="adminAddBtn" class="admin-add-btn">➕ Add Article</button>
    </div>
    <div class="admin-search-bar">
      <input id="adminSearch" placeholder="Search articles..." />
      <select id="adminCategoryFilter">
        <option value="">All Categories</option>
        <option value="harmful">Harmful</option>
        <option value="immunity">Immunity</option>
        <option value="vaccines">Vaccines</option>
        <option value="herbal">Herbal</option>
        <option value="nutrition">Nutrition</option>
        <option value="sleep">Sleep</option>
      </select>
    </div>
    <div id="adminArticlesList"></div>
  </div>
`,

    motherhealth: `
<div class="motherhealth-page">
  <div class="mh-header">
    <h2>👩 Mother Health</h2>
    <p>Your health, your journey</p>
  </div>
  <div class="mh-nav-cards">
    <div class="mh-nav-card" data-page="pregnancy">
      <span class="mh-icon">🤰</span>
      <h3>Pregnancy & Period</h3>
      <p>Track your pregnancy journey and menstrual cycle</p>
    </div>
    <div class="mh-nav-card" data-page="medicines">
      <span class="mh-icon">💊</span>
      <h3>My Supplements</h3>
      <p>Manage your vitamins and supplements</p>
    </div>
  </div>

  <div class="mh-cards-grid">
    <div class="mh-card" id="waterIntakeCard">
      <h3>💧 Daily Water Goal</h3>
      <label>Daily goal (liters)</label>
      <input type="number" id="waterLiters" step="0.1" min="0.5" max="5" placeholder="e.g. 2.0" />
      <p id="waterGlassesDisplay" class="mh-glasses-display"></p>
      <label>Start hour (0–23)</label>
      <input type="number" id="waterStartHour" min="0" max="23" placeholder="e.g. 7" />
      <label>End hour (0–23)</label>
      <input type="number" id="waterEndHour" min="0" max="23" placeholder="e.g. 22" />
      <p id="waterError" class="mh-error"></p>
      <button id="saveWaterBtn">Save</button>
    </div>

    <div class="mh-card" id="appointmentCard">
      <h3>🏥 Next Doctor Appointment</h3>
      <label>Appointment date</label>
      <input type="date" id="appointmentDate" />
      <p id="appointmentWarning" class="mh-error"></p>
      <button id="saveAppointmentBtn">Save</button>
    </div>
  </div>
</div>
`,

    pregnancy: `
<div class="pregnancy-page">
  <div class="pregnancy-header">
    <h2>🤰 Pregnancy &amp; Period Calendar</h2>
    <p>Track your pregnancy journey and menstrual cycle</p>
  </div>

  <div class="pregnancy-info-cards">
    <div class="pregnancy-info-card">
      <h3>📋 Overview</h3>
      <p>Monitor your pregnancy progress and key milestones week by week.</p>
    </div>
    <div class="pregnancy-info-card">
      <h3>📅 This Week</h3>
      <p>Your baby is growing. Stay hydrated and take your prenatal vitamins.</p>
    </div>
    <div class="pregnancy-info-card">
      <h3>🏆 Milestones</h3>
      <p>Track important milestones throughout your pregnancy journey.</p>
    </div>
    <div class="pregnancy-info-card">
      <h3>🩺 Symptoms</h3>
      <p style="color:#64748b;font-size:14px;">Note any symptoms in your health journal.</p>
    </div>
    <div class="pregnancy-info-card">
      <h3>🤖 AI Advice</h3>
      <p style="color:#64748b;font-size:14px;">AI-powered pregnancy advice coming soon. Stay tuned!</p>
    </div>
  </div>

  <div class="period-calendar-section pregnancy-form-container">
    <h3>🗓️ Period Calendar</h3>

    <div class="period-inputs">
      <div>
        <label for="lastPeriodDate" style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Last Period Date</label>
        <input type="date" id="lastPeriodDate" />
      </div>
      <div>
        <label for="cycleLength" style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Cycle Length (21–35 days)</label>
        <input type="number" id="cycleLength" min="21" max="35" value="28" />
      </div>
      <div style="display:flex;align-items:flex-end;">
        <button id="savePeriodBtn">Save</button>
      </div>
    </div>

    <div class="calendar-nav">
      <button id="calendarPrev">&#8592; Prev</button>
      <span id="calendarTitle" style="font-weight:600;font-size:16px;color:#1e293b;"></span>
      <button id="calendarNext">Next &#8594;</button>
    </div>

    <div id="periodCalendarGrid" class="calendar-grid"></div>

    <div id="nextPeriodInfo" class="next-period-info"></div>
  </div>
</div>
`,

    settings: `
<div class="settings-page">
  <div class="settings-header">
    <h2>⚙️ Settings</h2>
    <p>Manage your account and preferences</p>
  </div>

  <div class="settings-section">
    <h3>👤 Profile Settings</h3>
    <div class="settings-field">
      <label>Display Name</label>
      <input type="text" id="settingsDisplayName" placeholder="Your name" />
    </div>
    <div class="settings-field">
      <label>Email</label>
      <input type="email" id="settingsEmail" placeholder="your@email.com" readonly />
    </div>
    <button id="saveProfileBtn" class="settings-save-btn">Save Profile</button>
  </div>

  <div class="settings-section">
    <h3>🔒 Change Password</h3>
    <div class="settings-field">
      <label>Current Password</label>
      <input type="password" id="currentPassword" placeholder="Current password" />
    </div>
    <div class="settings-field">
      <label>New Password</label>
      <input type="password" id="newPassword" placeholder="New password" />
    </div>
    <div class="settings-field">
      <label>Confirm New Password</label>
      <input type="password" id="confirmPassword" placeholder="Confirm new password" />
    </div>
    <p id="passwordError" class="settings-error" style="display:none;"></p>
    <button id="changePasswordBtn" class="settings-save-btn">Change Password</button>
  </div>

  <div class="settings-section">
    <h3>🔔 Notifications</h3>
    <div class="settings-toggle-row">
      <span>Enable Notifications</span>
      <label class="toggle-switch">
        <input type="checkbox" id="notificationsToggle" />
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <div class="settings-section">
    <h3>📱 Telegram Notifications</h3>
    <p style="font-size:13px;color:#64748b;margin-bottom:12px;">
      Get medicine, vaccine, water and appointment reminders on your phone via Telegram.
      First, start our bot: <a href="https://t.me/PediaMomBot" target="_blank" style="color:#3b82f6;">@PediaMomBot</a>
      — it will show your Chat ID.
    </p>
    <div class="settings-field">
      <label>Your Telegram Chat ID</label>
      <input type="text" id="telegramChatId" placeholder="e.g. 123456789" />
      <p id="telegramChatIdError" class="settings-error" style="display:none;">Please enter your Telegram Chat ID</p>
    </div>
    <button id="saveTelegramBtn" class="settings-save-btn">Save</button>
  </div>

  <div class="settings-section">
    <h3>🎨 App Preferences</h3>
    <div class="settings-field">
      <label>Language</label>
      <select id="languageSelect">
        <option value="en">English</option>
      </select>
    </div>
    <div class="settings-toggle-row">
      <span>Dark Mode</span>
      <label class="toggle-switch">
        <input type="checkbox" id="darkModeToggle" />
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <div class="settings-section danger-zone">
    <h3>⚠️ Danger Zone</h3>
    <p style="color:#64748b;font-size:14px;margin-bottom:16px;">Permanently delete your account and all associated data.</p>
    <button id="deleteAccountBtn" class="settings-danger-btn">Delete Account</button>
  </div>

  <div id="settingsMessage" class="settings-message" style="display:none;"></div>
</div>
`
  };

  /* ======================
     DEFAULT PAGE
  ====================== */
  content.innerHTML = pages.home;

 
/* ======================
   AUTH + ROLE CHECK
====================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../auth/login.html";
    return;
  }

  const adminMenu = document.getElementById("adminMenu");
  if (!adminMenu) return;

  // default: hide
  adminMenu.classList.add("hidden");

  // faqat bitta UID admin
  if (user.uid === ADMIN_UID) {
    adminMenu.classList.remove("hidden");
  }
});
  /* ======================
   MENU NAVIGATION
====================== */
menuItems.forEach(item => {
  item.addEventListener("click", async () => {
    menuItems.forEach(i => i.classList.remove("active"));
    item.classList.add("active");

    const pageKey = item.dataset.page;
    if (!pages[pageKey]) return;

    // ✅ Old page cleanup
    if (window.__destroyCurrentPage) {
      try {
        window.__destroyCurrentPage();
      } catch (e) {
        console.warn(e);
      }
      window.__destroyCurrentPage = null;
    }

    content.innerHTML = pages[pageKey];

    // 🔥 INIT MODULES
    if (pageKey === "children") {
      const module = await import("./children.module.js");
      module.initChildrenModule();
    }

    if (pageKey === "medicines") {
      const module = await import("./medicine.module.js");
      module.initMedicineModule();
    }

    if (pageKey === "checklist") {
      const module = await import("./daily_checklist.module.js");
      module.initDailyChecklist();

      if (typeof module.destroyDailyChecklist === "function") {
        window.__destroyCurrentPage = module.destroyDailyChecklist;
      }
    }

    if (pageKey === "addanalysis") {
      const module = await import("./addanalysis.module.js");
      module.initAddAnalysisModule();
    }

    if (pageKey === "results") {
      const module = await import("./results.module.js");
      module.initResultsModule();

      if (typeof module.destroyResultsModule === "function") {
        window.__destroyCurrentPage = module.destroyResultsModule;
      }
    }

    if (pageKey === "pregnancy") {
      const module = await import("./pregnancy.module.js");
      module.initPregnancyModule();
    }

    if (pageKey === "motherhealth") {
  const module = await import("./motherhealth.module.js");
  module.initMotherHealthModule();
}

    if (pageKey === "knowledgebase") {
      const module = await import("./knowledgebase.module.js");
      module.initKnowledgeBaseModule();

      if (typeof module.destroyKnowledgeBaseModule === "function") {
        window.__destroyCurrentPage = module.destroyKnowledgeBaseModule;
      }
    }

    if (pageKey === "savedarticles") {
      const module = await import("./savedarticles.module.js");
      module.initSavedArticlesModule();
    }

    if (pageKey === "admin") {
      const module = await import("./admin.module.js");
      module.initAdminModule();
    }
  });
});
  /* ======================
     LOGOUT
  ====================== */
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      const modal = document.getElementById("logoutModal");
      if (modal) modal.classList.remove("hidden");
    });

    document.getElementById("logoutConfirmYes")?.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "../index.html";
    });

    document.getElementById("logoutConfirmNo")?.addEventListener("click", () => {
      document.getElementById("logoutModal")?.classList.add("hidden");
    });

    document.getElementById("logoutModal")?.addEventListener("click", (e) => {
      if (e.target === document.getElementById("logoutModal")) {
        document.getElementById("logoutModal").classList.add("hidden");
      }
    });
  }
});

