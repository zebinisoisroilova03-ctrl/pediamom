import { db, auth } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentCategory = "";
let currentArticles = [];
let rootClickHandler = null;

export function initKnowledgeBaseModule() {
  const homeView = document.getElementById("kbHomeView");
  const listView = document.getElementById("kbListView");
  const detailView = document.getElementById("kbDetailView");

  if (!homeView || !listView || !detailView) return;

  attachDelegatedListeners();
  showHomeView();
}

export function destroyKnowledgeBaseModule() {
  const page = document.querySelector(".knowledge-page");
  if (page && rootClickHandler) {
    page.removeEventListener("click", rootClickHandler);
  }

  rootClickHandler = null;
  currentCategory = "";
  currentArticles = [];
}

function attachDelegatedListeners() {
  const page = document.querySelector(".knowledge-page");
  if (!page) return;

  if (rootClickHandler) {
    page.removeEventListener("click", rootClickHandler);
  }

  rootClickHandler = async (e) => {
    const categoryBtn = e.target.closest(".kb-category-card");
    const articleBtn = e.target.closest(".kb-article-card");
    const backHomeBtn = e.target.closest("#kbBackToHome");
    const backListBtn = e.target.closest("#kbBackToList");

    if (categoryBtn) {
      const category = categoryBtn.dataset.category;
      if (!category) return;
      currentCategory = category;
      await loadArticlesByCategory(category);
      return;
    }

    if (articleBtn) {
  const articleId = articleBtn.dataset.id;
  const article = currentArticles.find((a) => a.id === articleId);
  if (article) await renderArticleDetail(article);
  return;
}

    if (backHomeBtn) {
      showHomeView();
      return;
    }

    if (backListBtn) {
      showListView();
    }
  };

  page.addEventListener("click", rootClickHandler);
}

async function loadArticlesByCategory(category) {
  const listContainer = document.getElementById("kbArticlesList");
  const title = document.getElementById("kbCategoryTitle");

  if (!listContainer || !title) return;

  listContainer.innerHTML = `<p>Loading...</p>`;
  title.textContent = getCategoryTitle(category);

  try {
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

    renderArticlesList();
    showListView();
  } catch (error) {
    console.error("Knowledge Base load error:", error);
    listContainer.innerHTML = `
      <p class="kb-empty">
        Could not load articles. Check Firestore data or indexes.
      </p>
    `;
    showListView();
  }
}

function renderArticlesList() {
  const listContainer = document.getElementById("kbArticlesList");
  if (!listContainer) return;

  if (currentArticles.length === 0) {
    listContainer.innerHTML = `
      <p class="kb-empty">No articles found in this category yet.</p>
    `;
    return;
  }

  listContainer.innerHTML = currentArticles.map((article) => `
    <button class="kb-article-card" data-id="${article.id}" type="button">
      <h4>${escapeHtml(article.title)}</h4>
      <p>${escapeHtml(article.summary || "")}</p>
    </button>
  `).join("");
}

async function renderArticleDetail(article) {
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

  // Bookmark button qo‘shamiz
let bookmarkBtn = document.getElementById("kbBookmarkBtn");

if (!bookmarkBtn) {
  bookmarkBtn = document.createElement("button");
  bookmarkBtn.id = "kbBookmarkBtn";
  bookmarkBtn.className = "kb-bookmark-btn";

  // title elementdan keyin qo‘shamiz
  title.insertAdjacentElement("afterend", bookmarkBtn);
}

// Avval bookmark qilinganmi tekshiramiz
const existingBookmark = await isBookmarked(article.id);

bookmarkBtn.textContent = existingBookmark
  ? "⭐ Remove Bookmark"
  : "⭐ Save Article";

bookmarkBtn.onclick = async () => {
  const saved = await toggleBookmark(article.id);

  bookmarkBtn.textContent = saved
    ? "⭐ Remove Bookmark"
    : "⭐ Save Article";
};

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
  if (category === "herbal") return "Natural Herbal Beverages";
  if (category === "nutrition") return "Child Nutrition Tips";
  if (category === "sleep") return "Sleep & Development";
  return "Knowledge Base";
}

function formatContent(text) {
  return escapeHtml(text)
    .split("\n")
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
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

async function isBookmarked(articleId) {
  const user = auth.currentUser;
  if (!user) return null;

  const q = query(
    collection(db, "user_bookmarks"),
    where("userId", "==", user.uid),
    where("articleId", "==", articleId)
  );

  const snap = await getDocs(q);

  return snap.empty ? null : snap.docs[0];
}

async function toggleBookmark(articleId) {
  const user = auth.currentUser;
  if (!user) return false;

  const existingDoc = await isBookmarked(articleId);

  if (existingDoc) {
    await deleteDoc(doc(db, "user_bookmarks", existingDoc.id));
    return false;
  } else {
    await addDoc(collection(db, "user_bookmarks"), {
      userId: user.uid,
      articleId: articleId,
      savedAt: new Date()
    });
    return true;
  }
}