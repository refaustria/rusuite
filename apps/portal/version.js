// Portal footer: shows the build from /version.json (the only request the portal makes besides its own files; CSP forbids inline scripts).
let build = null;
const showVersion = () => {
  const el = document.getElementById("version");
  const t = window.rusuiteI18n.t;
  if (!build) {
    el.textContent = t("portal.versionUnknown");
    return;
  }
  const date = String(build.builtAt || "").slice(0, 10);
  el.textContent = t("portal.build", { commit: String(build.commit || "?").slice(0, 7) }) + (date ? " · " + date : "");
  if (build.builtAt) el.title = t("portal.built", { date: build.builtAt });
};
window.addEventListener("rusuite:locale", showVersion);
fetch("/version.json", { cache: "no-cache" })
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((v) => {
    build = v;
    showVersion();
  })
  .catch(() => {});
