import { db } from "./firebase.js";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let allArticles = [];
let searchDebounceTimer = null;

export function initAdminModule() {
  loadArticles();
  setupSearch();
  setupCategoryFilter();

  const addBtn = document.getElementById("adminAddBtn");
  if (addBtn) {
    addBtn.addEventListener("click", openAddArticleModal);
  }
}

async function loadArticles() {
  try {
    const q = query(collection(db, "knowledge_base"), orderBy("order", "asc"));
    const snapshot = await getDocs(q);
    allArticles = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    applyFilters();
  } catch (err) {
    console.error("loadArticles error:", err);
    const list = document.getElementById("adminArticlesList");
    if (list) list.innerHTML = `<p style="color:#ef4444;padding:20px;">Failed to load articles.</p>`;
  }
}

export function filterArticles(articles, searchQuery, category) {
  const q = (searchQuery || "").toLowerCase().trim();
  const cat = (category || "").trim();
  return articles.filter((a) => {
    const title = (a.title || "").toLowerCase();
    const articleCat = (a.category || "").toLowerCase();
    const matchesQuery = q === "" || title.includes(q) || articleCat.includes(q);
    const matchesCategory = cat === "" || a.category === cat;
    return matchesQuery && matchesCategory;
  });
}

export function renderArticles(articles) {
  const list = document.getElementById("adminArticlesList");
  if (!list) return;

  if (articles.length === 0) {
    list.innerHTML = `<div class="admin-no-results">No articles found</div>`;
    return;
  }

  list.innerHTML = articles.map((a) => `
    <div class="admin-article-item">
      <h4>${escapeHtml(a.title || "Untitled")}</h4>
      <div class="admin-article-meta">
        Category: <strong>${escapeHtml(a.category || "—")}</strong>
        &nbsp;•&nbsp; Order: <strong>${a.order || "—"}</strong>
        &nbsp;•&nbsp; Status: <span style="color:${a.status === 'published' ? '#166534' : '#92400e'};font-weight:600;">${escapeHtml(a.status || "draft").toUpperCase()}</span>
      </div>
      <p style="font-size:14px;color:#475569;margin-bottom:10px;">${escapeHtml(a.summary || "")}</p>
      <div class="admin-article-actions">
        <button class="admin-edit-btn" data-id="${a.id}">✏️ Edit</button>
        <button class="admin-delete-btn" data-id="${a.id}">🗑️ Delete</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".admin-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteArticle(btn.dataset.id));
  });
  list.querySelectorAll(".admin-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => openEditArticleModal(btn.dataset.id));
  });
}

function setupSearch() {
  const searchInput = document.getElementById("adminSearch");
  if (!searchInput) return;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => applyFilters(), 300);
  });
}

function setupCategoryFilter() {
  const categorySelect = document.getElementById("adminCategoryFilter");
  if (!categorySelect) return;
  categorySelect.addEventListener("change", () => applyFilters());
}

function applyFilters() {
  const searchInput = document.getElementById("adminSearch");
  const categorySelect = document.getElementById("adminCategoryFilter");
  const q = searchInput ? searchInput.value : "";
  const category = categorySelect ? categorySelect.value : "";
  renderArticles(filterArticles(allArticles, q, category));
}

export function openAddArticleModal() {
  const existing = document.getElementById("adminArticleModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "adminArticleModal";
  modal.className = "admin-modal-overlay";
  modal.innerHTML = `
    <div class="admin-modal-box">
      <h3>Add New Article</h3>
      <form id="adminArticleForm">
        <input type="text" id="articleTitle" placeholder="Title" required />
        <input type="text" id="articleSummary" placeholder="Summary" required />
        <textarea id="articleContent" placeholder="Content" rows="4" required></textarea>
        <select id="articleCategory" required>
          <option value="">Select category</option>
          <option value="harmful">Harmful</option>
          <option value="immunity">Immunity</option>
          <option value="vaccines">Vaccines</option>
          <option value="herbal">Herbal</option>
          <option value="nutrition">Nutrition</option>
          <option value="sleep">Sleep</option>
        </select>
        <select id="articleStatus">
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <div class="admin-modal-actions">
          <button type="submit" class="admin-add-btn">Save Article</button>
          <button type="button" id="closeAdminModal">Cancel</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("closeAdminModal").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.getElementById("adminArticleForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveNewArticle();
    modal.remove();
  });
}

async function saveNewArticle() {
  try {
    await addDoc(collection(db, "knowledge_base"), {
      title: document.getElementById("articleTitle").value.trim(),
      summary: document.getElementById("articleSummary").value.trim(),
      content: document.getElementById("articleContent").value.trim(),
      category: document.getElementById("articleCategory").value,
      status: document.getElementById("articleStatus").value,
      order: allArticles.length + 1,
      createdAt: serverTimestamp(),
    });
    await loadArticles();
  } catch (err) {
    console.error("saveNewArticle error:", err);
    alert("Failed to save article.");
  }
}

function openEditArticleModal(id) {
  const article = allArticles.find((a) => a.id === id);
  if (!article) return;

  const existing = document.getElementById("adminArticleModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "adminArticleModal";
  modal.className = "admin-modal-overlay";
  modal.innerHTML = `
    <div class="admin-modal-box">
      <h3>Edit Article</h3>
      <form id="adminEditForm">
        <input type="text" id="editTitle" placeholder="Title" value="${escapeHtml(article.title || "")}" required />
        <input type="text" id="editSummary" placeholder="Summary" value="${escapeHtml(article.summary || "")}" required />
        <textarea id="editContent" placeholder="Content" rows="4" required>${escapeHtml(article.content || "")}</textarea>
        <select id="editCategory" required>
          <option value="">Select category</option>
          ${["harmful","immunity","vaccines","herbal","nutrition","sleep"]
            .map((c) => `<option value="${c}" ${article.category === c ? "selected" : ""}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`)
            .join("")}
        </select>
        <select id="editStatus">
          <option value="published" ${article.status === "published" ? "selected" : ""}>Published</option>
          <option value="draft" ${article.status === "draft" ? "selected" : ""}>Draft</option>
        </select>
        <div class="admin-modal-actions">
          <button type="submit" class="admin-add-btn">Update Article</button>
          <button type="button" id="closeAdminModal">Cancel</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("closeAdminModal").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.getElementById("adminEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, "knowledge_base", id), {
        title: document.getElementById("editTitle").value.trim(),
        summary: document.getElementById("editSummary").value.trim(),
        content: document.getElementById("editContent").value.trim(),
        category: document.getElementById("editCategory").value,
        status: document.getElementById("editStatus").value,
        updatedAt: serverTimestamp(),
      });
      await loadArticles();
      modal.remove();
    } catch (err) {
      console.error("updateArticle error:", err);
      alert("Failed to update article.");
    }
  });
}

export async function deleteArticle(id) {
  const confirmed = confirm("Are you sure you want to delete this article?");
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, "knowledge_base", id));
    allArticles = allArticles.filter((a) => a.id !== id);
    applyFilters();
  } catch (err) {
    console.error("deleteArticle error:", err);
    alert("Failed to delete article.");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
