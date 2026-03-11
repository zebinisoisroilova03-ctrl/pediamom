export function initAdminModule() {
  const container = document.getElementById("adminContent");
  if (!container) return;

  container.innerHTML = `
    <h3>Admin panel working ✅</h3>
    <p>Article management coming next...</p>
  `;
}