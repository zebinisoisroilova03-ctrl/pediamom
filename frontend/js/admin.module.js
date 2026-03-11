import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let articles = [];
let editingId = null;

export async function initAdminModule() {
  const container = document.getElementById("adminContent");
  if (!container) return;

  container.innerHTML = `
    <div class="admin-toolbar">
      <button id="addArticleBtn" class="primary">➕ Add Article</button>
    </div>

    <div id="adminFormWrap" class="hidden"></div>
    <div id="adminArticlesList"></div>
  `;

  const addBtn = document.getElementById("addArticleBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => openArticleForm());
  }

  await loadArticles();
}

async function loadArticles() {
  const list = document.getElementById("adminArticlesList");
  if (!list) return;

  list.innerHTML = `<p>Loading articles...</p>`;

  try {
    const q = query(
      collection(db, "knowledge_base"),
      orderBy("order", "asc")
    );

    const snap = await getDocs(q);

    articles = snap.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }));

    renderArticles();
  } catch (error) {
    console.error("Admin load error:", error);
    list.innerHTML = `<p>Could not load articles.</p>`;
  }
}

function renderArticles() {
  const list = document.getElementById("adminArticlesList");
  if (!list) return;

  if (articles.length === 0) {
    list.innerHTML = `<p>No articles found.</p>`;
    return;
  }

  list.innerHTML = `
    <div class="admin-list">
      ${articles.map((article) => `
        <div class="admin-card">
          <div class="admin-card-top">
            <div>
              <h4>${escapeHtml(article.title || "Untitled")}</h4>
              <p class="admin-meta">
                Category: <strong>${escapeHtml(article.category || "-")}</strong>
                • Order: <strong>${article.order ?? 0}</strong>
                • Status:
                <span class="admin-status ${article.status === "published" ? "published" : "draft"}">
                  ${escapeHtml(article.status || "draft")}
                </span>
              </p>
            </div>
          </div>

          <p class="admin-summary">${escapeHtml(article.summary || "")}</p>

          <div class="admin-actions">
            <button class="editBtn" data-id="${article.id}">Edit</button>
            <button class="deleteBtn" data-id="${article.id}">Delete</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  bindArticleActions();
}

function bindArticleActions() {
  document.querySelectorAll(".editBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const article = articles.find((a) => a.id === id);
      if (article) {
        editingId = id;
        openArticleForm(article);
      }
    });
  });

  document.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const confirmed = confirm("Delete this article?");
      if (!confirmed) return;

      try {
        await deleteDoc(doc(db, "knowledge_base", id));
        await loadArticles();
      } catch (error) {
        console.error("Delete error:", error);
        alert("Could not delete article.");
      }
    });
  });
}

function openArticleForm(article = null) {
  const wrap = document.getElementById("adminFormWrap");
  if (!wrap) return;

  wrap.classList.remove("hidden");

  wrap.innerHTML = `
    <form id="adminArticleForm" class="admin-form">
      <h3>${article ? "Edit Article" : "Add New Article"}</h3>

      <label>Title</label>
      <input type="text" id="adminTitle" value="${escapeAttr(article?.title || "")}" required>

      <label>Category</label>
      <select id="adminCategory" required>
        <option value="harmful" ${article?.category === "harmful" ? "selected" : ""}>Harmful</option>
        <option value="immunity" ${article?.category === "immunity" ? "selected" : ""}>Immunity</option>
        <option value="vaccines" ${article?.category === "vaccines" ? "selected" : ""}>Vaccines</option>
      </select>

      <label>Summary</label>
      <textarea id="adminSummary" rows="2" required>${escapeHtml(article?.summary || "")}</textarea>

      <label>Content</label>
      <textarea id="adminContentText" rows="8" required>${escapeHtml(article?.content || "")}</textarea>

      <label>Warning</label>
      <textarea id="adminWarning" rows="2">${escapeHtml(article?.warning || "")}</textarea>

      <label>Order</label>
      <input type="number" id="adminOrder" value="${article?.order ?? 1}" min="1" required>

      <label>Status</label>
      <select id="adminStatus" required>
        <option value="published" ${article?.status === "published" ? "selected" : ""}>Published</option>
        <option value="draft" ${article?.status === "draft" ? "selected" : ""}>Draft</option>
      </select>

      <div class="admin-form-actions">
        <button type="submit" class="primary">${article ? "Update" : "Save"}</button>
        <button type="button" id="cancelAdminForm">Cancel</button>
      </div>
    </form>
  `;

  const form = document.getElementById("adminArticleForm");
  const cancelBtn = document.getElementById("cancelAdminForm");

  cancelBtn?.addEventListener("click", () => {
    wrap.innerHTML = "";
    wrap.classList.add("hidden");
    editingId = null;
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      title: document.getElementById("adminTitle").value.trim(),
      category: document.getElementById("adminCategory").value,
      summary: document.getElementById("adminSummary").value.trim(),
      content: document.getElementById("adminContentText").value.trim(),
      warning: document.getElementById("adminWarning").value.trim(),
      order: Number(document.getElementById("adminOrder").value),
      status: document.getElementById("adminStatus").value
    };

    if (!payload.title || !payload.summary || !payload.content) {
      alert("Please fill all required fields.");
      return;
    }

    try {
      if (editingId) {
        await updateDoc(doc(db, "knowledge_base", editingId), payload);
      } else {
        await addDoc(collection(db, "knowledge_base"), {
          ...payload,
          createdAt: serverTimestamp()
        });
      }

      wrap.innerHTML = "";
      wrap.classList.add("hidden");
      editingId = null;

      await loadArticles();
    } catch (error) {
      console.error("Save error:", error);
      alert("Could not save article.");
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}