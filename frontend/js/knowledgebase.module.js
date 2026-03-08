import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentCategory = "";
let currentArticles = [];
let listenersAttached = false;

export function initKnowledgeBaseModule() {
  const homeView = document.getElementById("kbHomeView");
  const listView = document.getElementById("kbListView");
  const detailView = document.getElementById("kbDetailView");

  if (!homeView || !listView || !detailView) return;

  if (!listenersAttached) {
    attachStaticListeners();
    listenersAttached = true;
  }

  showHomeView();
}

export function destroyKnowledgeBaseModule() {
  currentCategory = "";
  currentArticles = [];
  listenersAttached = false;
}

function attachStaticListeners() {
  document.querySelectorAll(".kb-category-card").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const category = btn.dataset.category;
      if (!category) return;

      currentCategory = category;
      await loadArticlesByCategory(category);
    });
  });

  const backToHome = document.getElementById("kbBackToHome");
  if (backToHome) {
    backToHome.addEventListener("click", () => {
      showHomeView();
    });
  }

  const backToList = document.getElementById("kbBackToList");
  if (backToList) {
    backToList.addEventListener("click", () => {
      showListView();
    });
  }
}

async function loadArticlesByCategory(category) {
  const listContainer = document.getElementById("kbArticlesList");
  const title = document.getElementById("kbCategoryTitle");

  if (!listContainer || !title) return;

  listContainer.innerHTML = `<p>Loading...</p>`;

  const q = query(
    collection(db, "knowledge_base"),
    where("category", "==", category),
    where("status", "==", "published"),
    orderBy("order", "asc")
  );

  const snap = await getDocs(q);

  currentArticles = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data()
  }));

  title.textContent = getCategoryTitle(category);
  renderArticlesList();
  showListView();
}

function renderArticlesList() {
  const listContainer = document.getElementById("kbArticlesList");
  if (!listContainer) return;

  if (currentArticles.length === 0) {
    listContainer.innerHTML = `<p class="kb-empty">No articles found in this category yet.</p>`;
    return;
  }

  listContainer.innerHTML = currentArticles.map((article) => `
    <button class="kb-article-card" data-id="${article.id}">
      <h4>${escapeHtml(article.title)}</h4>
      <p>${escapeHtml(article.summary || "")}</p>
    </button>
  `).join("");

  document.querySelectorAll(".kb-article-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const articleId = btn.dataset.id;
      const article = currentArticles.find(a => a.id === articleId);
      if (article) renderArticleDetail(article);
    });
  });
}

function renderArticleDetail(article) {
  const title = document.getElementById("kbDetailTitle");
  const summary = document.getElementById("kbDetailSummary");
  const warning = document.getElementById("kbDetailWarning");
  const content = document.getElementById("kbDetailContent");

  if (!title || !summary || !warning || !content) return;

  title.textContent = article.title || "";
  summary.textContent = article.summary || "";

  if (article.warning) {
    warning.textContent = article.warning;
    warning.classList.remove("hidden");
  } else {
    warning.textContent = "";
    warning.classList.add("hidden");
  }

  content.innerHTML = formatContent(article.content || "");
  showDetailView();
}

function showHomeView() {
  toggleViews("home");
}

function showListView() {
  toggleViews("list");
}

function showDetailView() {
  toggleViews("detail");
}

function toggleViews(view) {
  const homeView = document.getElementById("kbHomeView");
  const listView = document.getElementById("kbListView");
  const detailView = document.getElementById("kbDetailView");

  if (!homeView || !listView || !detailView) return;

  homeView.classList.toggle("hidden", view !== "home");
  listView.classList.toggle("hidden", view !== "list");
  detailView.classList.toggle("hidden", view !== "detail");
}

function getCategoryTitle(category) {
  if (category === "harmful") return "Harmful Medicines";
  if (category === "immunity") return "Immunity Tips";
  if (category === "vaccines") return "Vaccines Info";
  return "Knowledge Base";
}

function formatContent(text) {
  return escapeHtml(text)
    .split("\n")
    .filter(Boolean)
    .map(line => `<p>${line}</p>`)
    .join("");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}