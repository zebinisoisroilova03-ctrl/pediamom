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

export async function initMotherHealthModule() {
  const container = document.getElementById("motherHealthContent");
  if (!container) return;

  const user = auth.currentUser;
  if (!user) return;

  container.innerHTML = `<p>Loading...</p>`;

  try {
    const q = query(
      collection(db, "mother_health_profiles"),
      where("userId", "==", user.uid)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      renderSetupForm(container);
      return;
    }

    const profileDoc = snap.docs[0];
    const profile = profileDoc.data();

    renderMotherHealthDashboard(container, profile, profileDoc.id);
  } catch (error) {
    console.error("Mother health load error:", error);
    container.innerHTML = `
      <div class="mother-health-card">
        <h3>Could not load mother health profile</h3>
        <p>Please try again later.</p>
      </div>
    `;
  }
}

function renderSetupForm(container) {
  container.innerHTML = `
    <div class="mother-health-card">
      <h3>Set up your mother health tracker</h3>
      <form id="motherHealthSetupForm">
        <label>Daily Water Intake Goal (glasses)</label>
        <input type="number" id="motherWaterIntake" min="0" max="20" value="0">

        <label>Next Appointment Date</label>
        <input type="date" id="motherNextAppointment">

        <label>Symptoms</label>
        <textarea id="motherSymptoms" rows="4" placeholder="e.g. nausea, back pain, fatigue"></textarea>

        <label>Supplements (comma separated)</label>
        <input type="text" id="motherSupplementsInput" placeholder="e.g. Folic acid, Iron, Magnesium">

        <button type="submit">Save</button>
      </form>
    </div>
  `;

  const form = document.getElementById("motherHealthSetupForm");
  form?.addEventListener("submit", handleCreateProfile);
}

async function handleCreateProfile(e) {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user) return;

  const waterIntake = Number(document.getElementById("motherWaterIntake")?.value || 0);
  const nextAppointmentDate = document.getElementById("motherNextAppointment")?.value || "";
  const symptoms = document.getElementById("motherSymptoms")?.value.trim() || "";

  const supplementsRaw = document.getElementById("motherSupplementsInput")?.value.trim() || "";
  const supplements = supplementsRaw
    ? supplementsRaw.split(",").map((item) => ({
        name: item.trim(),
        taken: false
      })).filter((item) => item.name)
    : [];

  try {
    await addDoc(collection(db, "mother_health_profiles"), {
      userId: user.uid,
      waterIntake,
      nextAppointmentDate,
      symptoms,
      supplements,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    initMotherHealthModule();
  } catch (error) {
    console.error("Mother health create error:", error);
    alert("Could not save mother health profile.");
  }
}

function renderMotherHealthDashboard(container, profile, docId) {
  const nextAppointmentText = profile.nextAppointmentDate || "Not set";
  const supplements = Array.isArray(profile.supplements) ? profile.supplements : [];

  container.innerHTML = `
    <div class="mother-health-summary-editable">
      <div class="mother-summary-card editable-card">
        <div class="mother-summary-label">Water Intake Goal</div>
        <div class="mother-summary-value">${profile.waterIntake ?? 0}</div>
        <div class="mother-summary-sub">glasses per day</div>

        <form id="waterInlineForm" class="summary-inline-form">
          <input type="number" id="editWaterIntake" min="0" max="20" value="${profile.waterIntake ?? 0}">
          <div class="summary-inline-actions">
            <button type="submit">Save</button>
          </div>
        </form>
      </div>

      <div class="mother-summary-card editable-card">
        <div class="mother-summary-label">Next Appointment</div>
        <div class="mother-summary-value summary-date">${escapeHtml(nextAppointmentText)}</div>
        <div class="mother-summary-sub">planned checkup date</div>

        <form id="nextAppointmentInlineForm" class="summary-inline-form">
          <input type="date" id="editNextAppointment" value="${profile.nextAppointmentDate || ""}">
          <div class="summary-inline-actions">
            <button type="submit">Save</button>
          </div>
        </form>
      </div>
    </div>

    <div class="mother-health-grid top-grid">
      <div class="mother-health-card">
        <h3>Symptoms</h3>
        <p class="mother-card-hint">Write how you feel physically or emotionally during the day.</p>
        <form id="symptomsForm">
          <textarea id="editSymptoms" rows="6">${escapeHtml(profile.symptoms || "")}</textarea>
          <button type="submit">Update Symptoms</button>
        </form>
      </div>

      <div class="mother-health-card ai-advice-card">
        <h3>AI Advice</h3>
        <p class="mother-card-hint">
          Future feature: AI-based personalized advice will appear here based on the symptoms entered by the user.
        </p>
        <div class="ai-advice-placeholder">
          No AI advice yet. This section is reserved for future intelligent recommendations based on mother symptoms and condition notes.
        </div>
      </div>
    </div>

    <div class="mother-health-card supplements-wide-card">
      <div class="supplements-header">
        <div>
          <h3>Supplements Tracker</h3>
          <p class="mother-card-hint">Add your daily supplements and mark them when taken.</p>
        </div>
      </div>

      <form id="addSupplementForm" class="add-supplement-form">
        <input type="text" id="newSupplementName" placeholder="Add supplement name">
        <button type="submit">Add Supplement</button>
      </form>

      <ul id="supplementsList" class="supplements-list">
        ${
          supplements.length === 0
            ? `<li class="empty-supplements">No supplements added yet.</li>`
            : supplements.map((item, index) => `
              <li class="supplement-item">
                <label class="supplement-check">
                  <input type="checkbox" data-index="${index}" class="supplementToggle" ${item.taken ? "checked" : ""}>
                  <span class="custom-check"></span>
                </label>

                <div class="supplement-name-wrap">
                  <span class="supplement-name ${item.taken ? "taken" : ""}">${escapeHtml(item.name)}</span>
                </div>

                <button type="button" class="supplement-delete" data-index="${index}">Remove</button>
              </li>
            `).join("")
        }
      </ul>
    </div>
  `;

  document.getElementById("waterInlineForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, "mother_health_profiles", docId), {
        waterIntake: Number(document.getElementById("editWaterIntake")?.value || 0),
        updatedAt: serverTimestamp()
      });
      initMotherHealthModule();
    } catch (error) {
      console.error("Water intake update error:", error);
      alert("Could not update water intake.");
    }
  });

  document.getElementById("nextAppointmentInlineForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, "mother_health_profiles", docId), {
        nextAppointmentDate: document.getElementById("editNextAppointment")?.value || "",
        updatedAt: serverTimestamp()
      });
      initMotherHealthModule();
    } catch (error) {
      console.error("Next appointment update error:", error);
      alert("Could not update next appointment date.");
    }
  });

  document.getElementById("symptomsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, "mother_health_profiles", docId), {
        symptoms: document.getElementById("editSymptoms")?.value.trim() || "",
        updatedAt: serverTimestamp()
      });
      initMotherHealthModule();
    } catch (error) {
      console.error("Symptoms update error:", error);
      alert("Could not update symptoms.");
    }
  });

  document.getElementById("addSupplementForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const newName = document.getElementById("newSupplementName")?.value.trim() || "";
    if (!newName) return;

    try {
      const updatedSupplements = [
        ...supplements,
        { name: newName, taken: false }
      ];

      await updateDoc(doc(db, "mother_health_profiles", docId), {
        supplements: updatedSupplements,
        updatedAt: serverTimestamp()
      });

      initMotherHealthModule();
    } catch (error) {
      console.error("Add supplement error:", error);
      alert("Could not add supplement.");
    }
  });

  document.querySelectorAll(".supplementToggle").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const index = Number(checkbox.dataset.index);

      try {
        const updatedSupplements = [...supplements];
        updatedSupplements[index] = {
          ...updatedSupplements[index],
          taken: checkbox.checked
        };

        await updateDoc(doc(db, "mother_health_profiles", docId), {
          supplements: updatedSupplements,
          updatedAt: serverTimestamp()
        });

        initMotherHealthModule();
      } catch (error) {
        console.error("Toggle supplement error:", error);
        alert("Could not update supplement status.");
      }
    });
  });

  document.querySelectorAll(".supplement-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index = Number(btn.dataset.index);

      try {
        const updatedSupplements = supplements.filter((_, i) => i !== index);

        await updateDoc(doc(db, "mother_health_profiles", docId), {
          supplements: updatedSupplements,
          updatedAt: serverTimestamp()
        });

        initMotherHealthModule();
      } catch (error) {
        console.error("Delete supplement error:", error);
        alert("Could not remove supplement.");
      }
    });
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