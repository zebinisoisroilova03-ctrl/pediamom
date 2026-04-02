import { auth, db } from "./firebase.js";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let userId = null;
let unsubChildren = null;

/* ======================
   VALIDATION HELPERS
====================== */

/**
 * Fetch child's birthDate and gender from Firestore.
 * Returns { birthDate, gender } or null if not found.
 */
export async function getChildData(childId) {
  try {
    const snap = await getDoc(doc(db, "children", childId));
    if (!snap.exists()) return null;
    const { birthDate, gender } = snap.data();
    return { birthDate, gender };
  } catch {
    return null;
  }
}

/**
 * Calculate age in whole months from a Firestore Timestamp or JS Date.
 */
export function calculateAge(birthDate) {
  const birth = birthDate && typeof birthDate.toDate === "function"
    ? birthDate.toDate()
    : new Date(birthDate);
  const now = new Date();
  return (now.getFullYear() - birth.getFullYear()) * 12
    + (now.getMonth() - birth.getMonth());
}

/**
 * Validate hemoglobin value against WHO thresholds.
 * Returns "invalid" | "low" | "ok"
 */
export function validateHemoglobin(value, ageMonths, gender) {
  if (value < 0 || value > 25) return "invalid";
  let threshold;
  if (ageMonths >= 6 && ageMonths <= 59) {
    threshold = 11.0;
  } else if (ageMonths >= 60 && ageMonths <= 143) {
    threshold = 11.5;
  } else if (ageMonths >= 144) {
    threshold = gender === "female" ? 12.0 : 13.0;
  } else {
    return "ok";
  }
  return value < threshold ? "low" : "ok";
}

/**
 * Validate ferritin value against age-based thresholds.
 * Returns "invalid" | "low" | "ok"
 */
export function validateFerritin(value, ageMonths) {
  if (value < 0 || value > 2000) return "invalid";
  let threshold;
  if (ageMonths >= 6 && ageMonths <= 59) {
    threshold = 12;
  } else if (ageMonths >= 60 && ageMonths <= 143) {
    threshold = 15;
  } else if (ageMonths >= 144) {
    threshold = 12;
  } else {
    return "ok";
  }
  return value < threshold ? "low" : "ok";
}

/**
 * Show or hide a yellow validation warning below the form inputs.
 * Creates #validationWarning if it doesn't exist.
 */
export function showValidationWarning(message) {
  let warning = document.getElementById("validationWarning");
  if (!warning) {
    warning = document.createElement("div");
    warning.id = "validationWarning";
    const submitBtn = document.querySelector("#medicalForm button[type='submit']");
    if (submitBtn) {
      submitBtn.parentNode.insertBefore(warning, submitBtn);
    }
  }
  if (!message) {
    warning.style.display = "none";
    warning.textContent = "";
  } else {
    warning.style.display = "block";
    warning.textContent = message;
  }
}

export function initAddAnalysisModule() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    userId = user.uid;

    // SPA: DOM endi qo'shilgan bo'ladi, shuning uchun init shu yerda
    setupUI();
    loadChildrenDropdownRealtime();
  });
}

/* ======================
   UI SETUP
====================== */
function setupUI() {
  const childSelect = document.getElementById("analysisChildSelect");
  const typeSelect = document.getElementById("typeSelect");

  const bloodFields = document.getElementById("bloodFields");
  const vitaminFields = document.getElementById("vitaminFields");

  const form = document.getElementById("medicalForm");
  const messageBox = document.getElementById("messageBox");

  if (!childSelect || !typeSelect || !form || !messageBox) return;

  function showMessage(text, type = "success") {
    messageBox.style.display = "block";
    messageBox.textContent = text;

    messageBox.classList.remove("success", "error");
    messageBox.classList.add(type === "error" ? "error" : "success");

    setTimeout(() => {
      messageBox.style.display = "none";
    }, 3000);
  }

  // Type change
  typeSelect.onchange = () => {
    bloodFields.style.display = "none";
    vitaminFields.style.display = "none";

    if (typeSelect.value === "blood") bloodFields.style.display = "flex";
    if (typeSelect.value === "vitamin") vitaminFields.style.display = "flex";
  };

  // Save
  form.onsubmit = async (e) => {
    e.preventDefault();

    if (!userId) {
      showMessage("You are not logged in", "error");
      return;
    }

    if (!childSelect.value) {
      showMessage("Please, select a child", "error");
      return;
    }

    if (!typeSelect.value) {
      showMessage("Please, select analysis type", "error");
      return;
    }

    const type = typeSelect.value;
    let values = {};

    // BLOOD
    if (type === "blood") {
      const hemoglobin = document.getElementById("hemoglobin")?.value;
      const ferritin = document.getElementById("ferritin")?.value;

      if (!hemoglobin || !ferritin) {
        showMessage("Please, fill all blood fields", "error");
        return;
      }

      const hgbNum = Number(hemoglobin);
      const ferNum = Number(ferritin);

      // Validate if child is selected
      if (childSelect.value) {
        const childData = await getChildData(childSelect.value);
        if (childData) {
          const ageMonths = calculateAge(childData.birthDate);
          const hgbResult = validateHemoglobin(hgbNum, ageMonths, childData.gender);
          const ferResult = validateFerritin(ferNum, ageMonths);

          if (hgbResult === "invalid" || ferResult === "invalid") {
            showMessage("Noto'g'ri qiymat kiritildi", "error");
            return;
          }

          const warnings = [];
          if (hgbResult === "low") warnings.push("⚠️ Hemoglobin past: bolaning yoshi uchun norma " +
            (ageMonths <= 59 ? "11.0" : ageMonths <= 143 ? "11.5" : childData.gender === "female" ? "12.0" : "13.0") +
            " g/dL dan yuqori bo'lishi kerak");
          if (ferResult === "low") warnings.push("⚠️ Ferritin past: bolaning yoshi uchun norma " +
            (ageMonths <= 59 ? "12" : ageMonths <= 143 ? "15" : "12") +
            " ng/mL dan yuqori bo'lishi kerak");

          if (warnings.length > 0) {
            showValidationWarning(warnings.join(" | "));
          } else {
            showValidationWarning(null);
          }
        }
      }

      values = {
        hemoglobin: hgbNum,
        ferritin: ferNum
      };
    }

    // VITAMIN
    if (type === "vitamin") {
      const vitaminD = document.getElementById("vitaminD")?.value;
      const vitaminB12 = document.getElementById("vitaminB12")?.value;

      if (!vitaminD || !vitaminB12) {
        showMessage("Please, fill all vitamin fields", "error");
        return;
      }

      values = {
        vitaminD: Number(vitaminD),
        vitaminB12: Number(vitaminB12)
      };
    }

    try {
      // Step 1: Get cost estimate first
      showMessage("Estimating analysis cost...", "info");
      const costEstimate = await getAnalysisCostEstimate(type, { childId: childSelect.value, values });

      if (!costEstimate.canAfford) {
        showPaymentModal(costEstimate);
        return;
      }

      // Step 2: Execute analysis with payment processing
      showMessage("Processing AI analysis...", "info");
      const analysisResult = await executeAIAnalysis({
        childId: childSelect.value,
        type,
        values
      });

      if (analysisResult.success) {
        showAnalysisResult(analysisResult);
        showAISummary(analysisResult.result);
        showMessage(`AI analysis completed successfully! Cost: $${(analysisResult.cost / 100).toFixed(2)}`, "success");

        form.reset();
        bloodFields.style.display = "none";
        vitaminFields.style.display = "none";
      } else {
        if (analysisResult.error && analysisResult.error.code === 'insufficient_credits') {
          showPaymentModal(analysisResult);
        } else {
          showMessage(analysisResult.error?.message || "Analysis failed", "error");
        }
      }

    } catch (err) {
      console.error("Analysis error:", err);
      showMessage("Error processing analysis", "error");
    }
  };
}

/* ======================
   CHILDREN DROPDOWN (REALTIME)
====================== */
function loadChildrenDropdownRealtime() {
  const childSelect = document.getElementById("analysisChildSelect");
  if (!childSelect || !userId) return;

  // avvalgi listener bo'lsa, tozalab yuboramiz
  if (unsubChildren) unsubChildren();

  const q = query(
    collection(db, "children"),
    where("parentId", "==", userId)
  );

  unsubChildren = onSnapshot(q, (snapshot) => {
    const current = childSelect.value;

    childSelect.innerHTML = `<option value="">Select child</option>`;

    snapshot.forEach((docSnap) => {
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = docSnap.data().name;
      childSelect.appendChild(option);
    });

    // avval tanlangan bola hali bor bo'lsa, selectni saqlab qolamiz
    if (current) {
      const stillExists = Array.from(childSelect.options).some(o => o.value === current);
      if (stillExists) childSelect.value = current;
    }
  });
}

/* ======================
   AI ANALYSIS API INTEGRATION
====================== */

/**
 * Get cost estimate for AI analysis
 */
async function getAnalysisCostEstimate(analysisType, analysisData) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');

    const token = await user.getIdToken();

    const response = await fetch('/api/analysis/estimate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        analysisType,
        analysisData
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Cost estimation failed');
    }

    return result.estimate;
  } catch (error) {
    console.error('Cost estimation error:', error);
    throw error;
  }
}

/**
 * Execute AI analysis with payment processing
 */
async function executeAIAnalysis(analysisData, paymentPreference = null) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');

    const token = await user.getIdToken();

    const response = await fetch('/api/analysis/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ...analysisData,
        paymentPreference
      })
    });

    const result = await response.json();

    // Handle different response status codes
    if (response.status === 402) {
      // Payment required - show payment options
      result.needsPayment = true;
    } else if (!response.ok && !result.retryable) {
      // Non-retryable error
      throw new Error(result.error?.message || 'Analysis failed');
    }

    return result;
  } catch (error) {
    console.error('Analysis execution error:', error);
    throw error;
  }
}

/**
 * Retry failed analysis with different payment method
 */
async function retryAnalysis(analysisData, paymentPreference, originalAnalysisId) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');

    const token = await user.getIdToken();

    const response = await fetch('/api/analysis/retry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ...analysisData,
        paymentPreference,
        originalAnalysisId
      })
    });

    const result = await response.json();

    if (response.status === 402) {
      result.needsPayment = true;
    } else if (!response.ok && !result.retryable) {
      throw new Error(result.error?.message || 'Retry failed');
    }

    return result;
  } catch (error) {
    console.error('Analysis retry error:', error);
    throw error;
  }
}

/* ======================
   PAYMENT MODAL FUNCTIONS
====================== */

/**
 * Show payment modal when user needs to pay for analysis
 */
function showPaymentModal(costInfo) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('paymentModal');
  if (!modal) {
    modal = createPaymentModal();
    document.body.appendChild(modal);
  }

  // Update modal content
  const costElement = modal.querySelector('.analysis-cost');
  const upgradeOptions = modal.querySelector('.upgrade-options');

  if (costElement) {
    costElement.textContent = `Analysis Cost: $${(costInfo.estimatedCost / 100).toFixed(2)}`;
  }

  // Show upgrade options
  if (upgradeOptions && costInfo.upgradeOptions) {
    upgradeOptions.innerHTML = '';
    costInfo.upgradeOptions.forEach(option => {
      const optionElement = document.createElement('div');
      optionElement.className = 'upgrade-option';
      optionElement.innerHTML = `
        <h4>${option.title}</h4>
        <p>${option.description}</p>
        <p class="price">$${(option.price / 100).toFixed(2)}</p>
        <button class="upgrade-btn" data-option="${option.type}">Choose This Option</button>
      `;
      upgradeOptions.appendChild(optionElement);
    });
  }

  // Show modal
  modal.style.display = 'block';
}

/**
 * Create payment modal HTML
 */
function createPaymentModal() {
  const modal = document.createElement('div');
  modal.id = 'paymentModal';
  modal.className = 'payment-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Payment Required for AI Analysis</h3>
        <span class="close-modal">&times;</span>
      </div>
      <div class="modal-body">
        <p class="analysis-cost"></p>
        <p>You need to purchase credits or upgrade your subscription to continue.</p>
        <div class="upgrade-options"></div>
      </div>
      <div class="modal-footer">
        <button class="cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  // Add event listeners
  const closeBtn = modal.querySelector('.close-modal');
  const cancelBtn = modal.querySelector('.cancel-btn');

  closeBtn.onclick = () => modal.style.display = 'none';
  cancelBtn.onclick = () => modal.style.display = 'none';

  // Close modal when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };

  // Handle upgrade option clicks
  modal.addEventListener('click', (e) => {
    if (e.target.classList.contains('upgrade-btn')) {
      const optionType = e.target.dataset.option;
      handleUpgradeOption(optionType);
    }
  });

  return modal;
}

/**
 * Handle upgrade option selection
 */
function handleUpgradeOption(optionType) {
  // This would integrate with the payment system
  // For now, just redirect to the appropriate page
  if (optionType === 'credit') {
    window.location.href = '/credits.html';
  } else if (optionType === 'subscription') {
    window.location.href = '/subscription.html';
  }
}

/* ======================
   ANALYSIS RESULT DISPLAY
====================== */

/**
 * Show analysis result in a modal or dedicated section
 */
function showAnalysisResult(result) {
  // Create result modal if it doesn't exist
  let modal = document.getElementById('resultModal');
  if (!modal) {
    modal = createResultModal();
    document.body.appendChild(modal);
  }

  // Update modal content
  const interpretationElement = modal.querySelector('.interpretation');
  const recommendationsElement = modal.querySelector('.recommendations');
  const costElement = modal.querySelector('.result-cost');
  const paymentMethodElement = modal.querySelector('.payment-method');

  if (interpretationElement && result.result.interpretation) {
    interpretationElement.textContent = result.result.interpretation;
  }

  if (recommendationsElement && result.result.recommendations) {
    recommendationsElement.innerHTML = '';
    result.result.recommendations.forEach(rec => {
      const li = document.createElement('li');
      li.textContent = rec;
      recommendationsElement.appendChild(li);
    });
  }

  if (costElement) {
    const costText = result.cached ? 'Free (Cached Result)' : `$${(result.cost / 100).toFixed(2)}`;
    costElement.textContent = `Cost: ${costText}`;
  }

  if (paymentMethodElement) {
    paymentMethodElement.textContent = `Payment Method: ${result.paymentMethod}`;
  }

  // Show remaining credits if applicable
  const creditsElement = modal.querySelector('.remaining-credits');
  if (creditsElement && result.remainingCredits !== null) {
    creditsElement.textContent = `Remaining Credits: ${result.remainingCredits}`;
    creditsElement.style.display = 'block';
  }

  // Show modal
  modal.style.display = 'block';
}

/**
 * Create result modal HTML
 */
function createResultModal() {
  const modal = document.createElement('div');
  modal.id = 'resultModal';
  modal.className = 'result-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>AI Analysis Results</h3>
        <span class="close-modal">&times;</span>
      </div>
      <div class="modal-body">
        <div class="analysis-interpretation">
          <h4>Interpretation:</h4>
          <p class="interpretation"></p>
        </div>
        <div class="analysis-recommendations">
          <h4>Recommendations:</h4>
          <ul class="recommendations"></ul>
        </div>
        <div class="analysis-metadata">
          <p class="result-cost"></p>
          <p class="payment-method"></p>
          <p class="remaining-credits" style="display: none;"></p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="close-btn">Close</button>
      </div>
    </div>
  `;

  // Add event listeners
  const closeBtn = modal.querySelector('.close-modal');
  const closeButton = modal.querySelector('.close-btn');

  closeBtn.onclick = () => modal.style.display = 'none';
  closeButton.onclick = () => modal.style.display = 'none';

  // Close modal when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };

  return modal;
}

/**
 * Show AI Summary block after successful analysis
 */
export function showAISummary(result) {
  const block = document.getElementById("aiSummaryBlock");
  if (!block) return;

  // Clear previous content
  block.innerHTML = "";

  // Interpretation
  const h4 = document.createElement("h4");
  h4.textContent = "🤖 AI Tahlil Xulosasi";
  block.appendChild(h4);

  if (result && result.interpretation) {
    const p = document.createElement("p");
    p.textContent = result.interpretation;
    block.appendChild(p);
  }

  // Recommendations
  if (result && result.recommendations && result.recommendations.length > 0) {
    const recTitle = document.createElement("p");
    recTitle.style.fontWeight = "600";
    recTitle.style.marginTop = "8px";
    recTitle.textContent = "Tavsiyalar:";
    block.appendChild(recTitle);

    const ul = document.createElement("ul");
    result.recommendations.forEach(rec => {
      const li = document.createElement("li");
      li.textContent = rec;
      ul.appendChild(li);
    });
    block.appendChild(ul);
  }

  // Knowledge Base link if relatedCategory is present
  if (result && result.relatedCategory) {
    const categoryTitles = {
      herbal: "Natural Herbal Beverages",
      nutrition: "Child Nutrition Tips",
      sleep: "Sleep & Development",
      harmful: "Harmful Medicines",
      immunity: "Immunity Tips",
      vaccines: "Vaccines Info"
    };
    const title = categoryTitles[result.relatedCategory] || result.relatedCategory;

    const link = document.createElement("a");
    link.className = "ai-kb-link";
    link.textContent = `📖 Batafsil o'qish: ${title}`;
    link.href = "#";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      // Navigate to knowledgebase page and pre-select category
      const kbMenuItem = document.querySelector('[data-page="knowledgebase"]');
      if (kbMenuItem) {
        kbMenuItem.click();
        // Dispatch event so knowledgebase module can pre-select the category
        window.dispatchEvent(new CustomEvent("kb-navigate-category", {
          detail: { category: result.relatedCategory }
        }));
      }
    });
    block.appendChild(link);
  }

  block.style.display = "block";
}

/**
 * Hide AI Summary block
 */
function hideAISummary() {
  const block = document.getElementById("aiSummaryBlock");
  if (block) block.style.display = "none";
}

/**
 * Enhanced showMessage function with info type
 */
function showMessage(text, type = "success") {
  const messageBox = document.getElementById("messageBox");
  if (!messageBox) return;

  messageBox.style.display = "block";
  messageBox.textContent = text;

  messageBox.classList.remove("success", "error", "info");

  if (type === "error") {
    messageBox.classList.add("error");
  } else if (type === "info") {
    messageBox.classList.add("info");
  } else {
    messageBox.classList.add("success");
  }

  setTimeout(() => {
    messageBox.style.display = "none";
  }, 3000);
}

/**
 * Show retry modal for failed analysis
 */
function showRetryModal(failedResult, analysisData) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('retryModal');
  if (!modal) {
    modal = createRetryModal();
    document.body.appendChild(modal);
  }

  // Update modal content
  const errorElement = modal.querySelector('.error-message');
  const retryOptions = modal.querySelector('.retry-options');

  if (errorElement) {
    errorElement.textContent = failedResult.error?.message || 'Analysis failed';
  }

  // Show retry options
  if (retryOptions) {
    retryOptions.innerHTML = `
      <button class="retry-btn" data-method="credits">Retry with Credits</button>
      <button class="retry-btn" data-method="subscription">Retry with Subscription</button>
      <button class="retry-btn" data-method="pay-per-analysis">Pay for This Analysis</button>
    `;
  }

  // Store analysis data for retry
  modal.analysisData = analysisData;
  modal.originalAnalysisId = failedResult.originalAnalysisId || Date.now().toString();

  // Show modal
  modal.style.display = 'block';
}

/**
 * Create retry modal HTML
 */
function createRetryModal() {
  const modal = document.createElement('div');
  modal.id = 'retryModal';
  modal.className = 'retry-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Analysis Failed</h3>
        <span class="close-modal">&times;</span>
      </div>
      <div class="modal-body">
        <p class="error-message"></p>
        <p>Would you like to retry with a different payment method?</p>
        <div class="retry-options"></div>
      </div>
      <div class="modal-footer">
        <button class="cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  // Add event listeners
  const closeBtn = modal.querySelector('.close-modal');
  const cancelBtn = modal.querySelector('.cancel-btn');

  closeBtn.onclick = () => modal.style.display = 'none';
  cancelBtn.onclick = () => modal.style.display = 'none';

  // Close modal when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };

  // Handle retry option clicks
  modal.addEventListener('click', async (e) => {
    if (e.target.classList.contains('retry-btn')) {
      const paymentMethod = e.target.dataset.method;
      await handleRetryAnalysis(modal.analysisData, paymentMethod, modal.originalAnalysisId);
      modal.style.display = 'none';
    }
  });

  return modal;
}

/**
 * Handle retry analysis with different payment method
 */
async function handleRetryAnalysis(analysisData, paymentMethod, originalAnalysisId) {
  try {
    showMessage("Retrying analysis...", "info");

    const retryResult = await retryAnalysis(analysisData, paymentMethod, originalAnalysisId);

    if (retryResult.success) {
      showAnalysisResult(retryResult);
      showMessage(`Analysis completed successfully on retry! Cost: $${(retryResult.paymentInfo.cost / 100).toFixed(2)}`, "success");
    } else if (retryResult.needsPayment) {
      showPaymentModal(retryResult);
    } else {
      showMessage(retryResult.error?.message || "Retry failed", "error");
    }

  } catch (error) {
    console.error('Retry error:', error);
    showMessage("Failed to retry analysis", "error");
  }
}