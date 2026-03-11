import { auth, db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function initPregnancyModule() {
  const container = document.getElementById("pregnancyContent");
  if (!container) return;

  const user = auth.currentUser;
  if (!user) return;

  container.innerHTML = `<p>Loading...</p>`;

  try {
    const q = query(
      collection(db, "pregnancy_profiles"),
      where("userId", "==", user.uid)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      renderSetupForm(container);
      return;
    }

    const profileDoc = snap.docs[0];
    const profile = profileDoc.data();

    // ✅ auto refresh week / trimester / dueDate
    const recalculated = calculatePregnancyData(profile.lmpDate);

    const needsRefresh =
      profile.currentWeek !== recalculated.currentWeek ||
      profile.trimester !== recalculated.trimester ||
      profile.dueDate !== recalculated.dueDate;

    if (needsRefresh) {
      await updateDoc(doc(db, "pregnancy_profiles", profileDoc.id), {
        currentWeek: recalculated.currentWeek,
        trimester: recalculated.trimester,
        dueDate: recalculated.dueDate,
        updatedAt: serverTimestamp()
      });

      profile.currentWeek = recalculated.currentWeek;
      profile.trimester = recalculated.trimester;
      profile.dueDate = recalculated.dueDate;
    }

    renderPregnancyDashboard(container, profile, profileDoc.id);
  } catch (error) {
    console.error("Pregnancy load error:", error);
    container.innerHTML = `
      <div class="pregnancy-card">
        <h3>Could not load pregnancy profile</h3>
        <p>Please try again later.</p>
      </div>
    `;
  }
}

function renderSetupForm(container) {
  container.innerHTML = `
    <div class="pregnancy-card">
      <h3>Set up your pregnancy profile</h3>
      <form id="pregnancySetupForm">
        <label>Last Menstrual Period (LMP)</label>
        <input type="date" id="lmpDate" required>

        <label>Notes (optional)</label>
        <textarea id="pregnancyNotes" rows="4" placeholder="Any notes..."></textarea>

        <button type="submit">Save</button>
      </form>
    </div>
  `;

  const form = document.getElementById("pregnancySetupForm");
  if (form) {
    form.addEventListener("submit", handleCreateProfile);
  }
}

async function handleCreateProfile(e) {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user) return;

  const lmpDate = document.getElementById("lmpDate")?.value || "";
  const notes = document.getElementById("pregnancyNotes")?.value.trim() || "";

  if (!lmpDate) {
    alert("Please select LMP date.");
    return;
  }

  const today = new Date();
  const selected = new Date(lmpDate);

  today.setHours(0, 0, 0, 0);
  selected.setHours(0, 0, 0, 0);

  if (selected > today) {
    alert("LMP date cannot be in the future.");
    return;
  }

  const calc = calculatePregnancyData(lmpDate);

  await addDoc(collection(db, "pregnancy_profiles"), {
    userId: user.uid,
    lmpDate,
    dueDate: calc.dueDate,
    currentWeek: calc.currentWeek,
    trimester: calc.trimester,
    notes,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  initPregnancyModule();
}

function renderPregnancyDashboard(container, profile, docId) {
  const weekly = getWeeklyContent(profile.currentWeek);

  container.innerHTML = `
    <div class="pregnancy-grid">
      <div class="pregnancy-card">
        <h3>Overview</h3>
        <p><strong>LMP:</strong> ${escapeHtml(profile.lmpDate || "-")}</p>
        <p><strong>Due Date:</strong> ${escapeHtml(profile.dueDate || "-")}</p>
        <p><strong>Current Week:</strong> ${profile.currentWeek || "-"}</p>
        <p><strong>Trimester:</strong> ${escapeHtml(profile.trimester || "-")}</p>
        <button id="editLmpBtn" type="button">Edit LMP</button>
      </div>

      <div class="pregnancy-card">
  <h3>This Week</h3>
  <p><strong>Baby development:</strong> ${escapeHtml(weekly.baby)}</p>
  <p><strong>Mother changes:</strong> ${escapeHtml(weekly.mother)}</p>
  <p><strong>Tip:</strong> ${escapeHtml(weekly.tip)}</p>
</div>

      <div class="pregnancy-card">
        <h3>Milestones</h3>
        <ul class="pregnancy-milestones">
          <li>Week 12 — End of first trimester</li>
          <li>Week 20 — Mid-pregnancy scan</li>
          <li>Week 28 — Third trimester starts</li>
          <li>Week 36 — Final weeks preparation</li>
        </ul>
      </div>

      <div id="editLmpCard" class="pregnancy-card hidden">
        <h3>Edit LMP</h3>
        <form id="editLmpForm">
          <label>Last Menstrual Period (LMP)</label>
          <input type="date" id="editLmpDate" value="${escapeHtml(profile.lmpDate || "")}" required>

          <div class="pregnancy-form-actions">
            <button type="submit">Update LMP</button>
            <button type="button" id="cancelEditLmp">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const editLmpBtn = document.getElementById("editLmpBtn");
  const editLmpCard = document.getElementById("editLmpCard");
  const cancelEditLmp = document.getElementById("cancelEditLmp");
  const editLmpForm = document.getElementById("editLmpForm");

  editLmpBtn?.addEventListener("click", () => {
    editLmpCard?.classList.remove("hidden");
  });

  cancelEditLmp?.addEventListener("click", () => {
    editLmpCard?.classList.add("hidden");
  });

  editLmpForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const newLmpDate = document.getElementById("editLmpDate")?.value || "";
    if (!newLmpDate) {
      alert("Please select LMP date.");
      return;
    }

    const today = new Date();
    const selected = new Date(newLmpDate);

    today.setHours(0, 0, 0, 0);
    selected.setHours(0, 0, 0, 0);

    if (selected > today) {
      alert("LMP date cannot be in the future.");
      return;
    }

    const recalculated = calculatePregnancyData(newLmpDate);

    await updateDoc(doc(db, "pregnancy_profiles", docId), {
      lmpDate: newLmpDate,
      dueDate: recalculated.dueDate,
      currentWeek: recalculated.currentWeek,
      trimester: recalculated.trimester,
      updatedAt: serverTimestamp()
    });

    initPregnancyModule();
  });
}

function calculatePregnancyData(lmpDate) {
  const lmp = new Date(lmpDate);
  const today = new Date();

  lmp.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffMs = today - lmp;
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1);

  const due = new Date(lmp);
  due.setDate(due.getDate() + 280);

  let trimester = "First";
  if (currentWeek >= 14 && currentWeek <= 27) trimester = "Second";
  if (currentWeek >= 28) trimester = "Third";

  return {
    currentWeek,
    trimester,
    dueDate: due.toISOString().split("T")[0]
  };
}

function getWeeklyContent(week) {
  const weeklyData = {
    1: {
      baby: "Pregnancy has just started, although physical development is not yet visible.",
      mother: "You may not notice major body changes yet.",
      tip: "Start tracking your health and take folic acid if recommended."
    },
    4: {
      baby: "The fertilized egg is implanting and early development begins.",
      mother: "You may feel tired or notice mild cramps.",
      tip: "Rest well and avoid harmful medicines unless prescribed."
    },
    8: {
      baby: "Baby’s early organs are developing and growth is progressing quickly.",
      mother: "Nausea, fatigue, and breast tenderness may increase.",
      tip: "Stay hydrated and eat small frequent meals if needed."
    },
    12: {
      baby: "Baby’s body structure becomes more developed by the end of the first trimester.",
      mother: "Some early pregnancy symptoms may begin to reduce.",
      tip: "Attend routine medical checkups and maintain balanced nutrition."
    },
    16: {
      baby: "Baby is growing steadily and facial features are becoming more defined.",
      mother: "Energy levels often improve during the second trimester.",
      tip: "Continue healthy food, walking, and hydration."
    },
    20: {
      baby: "Baby’s movement may become more noticeable at this stage.",
      mother: "You may begin to feel fluttering or kicks.",
      tip: "Discuss scan appointments and monitor body changes."
    },
    24: {
      baby: "Baby is developing more body fat and responding to sounds.",
      mother: "Back discomfort or swelling may begin for some mothers.",
      tip: "Maintain good posture and avoid standing too long."
    },
    28: {
      baby: "The third trimester begins and baby continues rapid growth.",
      mother: "You may feel heavier and more tired.",
      tip: "Prepare for delivery planning and keep attending checkups."
    },
    32: {
      baby: "Baby’s body systems continue maturing in preparation for birth.",
      mother: "Shortness of breath or sleep discomfort may happen.",
      tip: "Rest often and prepare hospital essentials gradually."
    },
    36: {
      baby: "Baby is close to full-term development.",
      mother: "Pressure in the lower abdomen may increase.",
      tip: "Watch for labor signs and stay in contact with your doctor."
    },
    40: {
      baby: "Baby is at full term and ready for birth.",
      mother: "Labor may begin naturally around this time.",
      tip: "Stay calm, keep essentials ready, and follow medical advice."
    }
  };

  const milestones = Object.keys(weeklyData)
    .map(Number)
    .sort((a, b) => a - b);

  let selectedWeek = milestones[0];

  for (const w of milestones) {
    if (week >= w) {
      selectedWeek = w;
    }
  }

  return weeklyData[selectedWeek];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}