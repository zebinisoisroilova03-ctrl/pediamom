// dashboard.js
import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

          <div class="medicine-child-filter">
            <label for="childSelect">Select child</label>
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
          <option value="urine">Urine</option>
          <option value="vitamin">Vitamin</option>
        </select>

        <div id="bloodFields" style="display:none;">
          <h4>Blood Analysis</h4>
          <input type="number" id="hemoglobin" placeholder="Hemoglobin" />
          <input type="number" id="iron" placeholder="Iron" />
        </div>

        <div id="urineFields" style="display:none;">
          <h4>Urine Analysis</h4>
          <input type="number" id="protein" placeholder="Protein" />
          <input type="number" id="ph" placeholder="pH" />
        </div>

        <div id="vitaminFields" style="display:none;">
          <h4>Vitamin Analysis</h4>
          <input type="number" id="vitaminD" placeholder="Vitamin D" />
          <input type="number" id="vitaminB12" placeholder="Vitamin B12" />
        </div>

        <button type="submit">Save Analysis</button>
      </form>

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
          <option value="urine">Urine</option>
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

    settings: `
      <h1>⚙️ Settings</h1>
      <p>User settings will be here</p>
    `
  };

  /* ======================
     DEFAULT PAGE
  ====================== */
  content.innerHTML = pages.home;

  /* ======================
     MENU NAVIGATION
  ====================== */
  menuItems.forEach(item => {
    item.addEventListener("click", async () => {
      menuItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");

      const pageKey = item.dataset.page;
      if (!pages[pageKey]) return;

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
      }

      if (pageKey === "addanalysis") {
        const module = await import("./addanalysis.module.js");
        module.initAddAnalysisModule();
      }

      if (pageKey === "results") {
        const module = await import("./results.module.js");
        module.initResultsModule();
      }

      if (pageKey === "knowledgebase") {
        const module = await import("./knowledgebase.module.js");
        module.initKnowledgeBaseModule();

      if (typeof module.destroyKnowledgeBaseModule === "function") {
        window.__destroyCurrentPage = module.destroyKnowledgeBaseModule;
      }
      }
    });
  });

  /* ======================
     LOGOUT
  ====================== */
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "../index.html";
    });
  }
});

/* ======================
   AUTH GUARD
====================== */
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "../auth/login.html";
  }
});
