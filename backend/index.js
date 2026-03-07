/**
 * PediaMom - Cloud Functions
 *
 * 1) child o‘chsa -> cascade delete:
 *    - medicine_list
 *    - medical_results
 *    - medicine_logs
 *
 * 2) account (Auth user) o‘chsa -> cascade delete (parentId == uid):
 *    - children
 *    - medicine_list
 *    - medical_results
 *    - medicine_logs
 */

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// Gen2 Firestore
const { setGlobalOptions } = require("firebase-functions");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");

// ✅ V1 Auth (stable) - aniq v1 import
const functions = require("firebase-functions/v1");

setGlobalOptions({ maxInstances: 10 });

/** Batch delete helper (safe) */
async function deleteQueryInBatches(queryRef, batchSize = 450) {
  let snap = await queryRef.limit(batchSize).get();

  while (!snap.empty) {
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    snap = await queryRef.limit(batchSize).get();
  }
}

/** Delete by parentId for a collection */
async function deleteByParentId(collectionName, parentId) {
  const q = db.collection(collectionName).where("parentId", "==", parentId);
  await deleteQueryInBatches(q);
}

/* =========================================================
   (A) CHILD DELETE (Gen2) -> cascade delete medicines + results + logs
========================================================= */
exports.cascadeDeleteOnChildDelete = onDocumentDeleted(
  {
    document: "children/{childId}",
    region: "europe-west1",
  },
  async (event) => {
    const childId = event.params.childId;

    const childData = event.data?.data?.() || null;
    const parentId = childData?.parentId || null;

    // 1) medicine_list
    let medsQ = db.collection("medicine_list").where("childId", "==", childId);
    if (parentId) medsQ = medsQ.where("parentId", "==", parentId);
    await deleteQueryInBatches(medsQ);

    // 2) medical_results
    let resultsQ = db.collection("medical_results").where("childId", "==", childId);
    if (parentId) resultsQ = resultsQ.where("parentId", "==", parentId);
    await deleteQueryInBatches(resultsQ);

    // 3) medicine_logs
    let logsQ = db.collection("medicine_logs").where("childId", "==", childId);
    if (parentId) logsQ = logsQ.where("parentId", "==", parentId);
    await deleteQueryInBatches(logsQ);
  }
);

/* =========================================================
   (B) ACCOUNT DELETE (V1 Auth) -> cascade delete everything for that uid
========================================================= */
exports.cascadeDeleteOnUserDelete = functions
  .region("europe-west1")
  .auth.user()
  .onDelete(async (user) => {
    const uid = user.uid;

    await deleteByParentId("medicine_logs", uid);
    await deleteByParentId("medicine_list", uid);
    await deleteByParentId("medical_results", uid);
    await deleteByParentId("children", uid);
  });