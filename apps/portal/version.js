// Portal footer: shows the release and build from /version.json (the only request the portal makes besides its own files; CSP forbids inline scripts).
let build = null;
/** The public name of a version (docs/versioning.md): `3.141.0` → `3.141`; hotfixes/pre-releases stay as they are. */
const publicVersion = (v) => {
  const s = String(v || "").trim().replace(/^v/, "");
  const m = /^(\d+\.\d+)\.0$/.exec(s);
  return m ? m[1] : s;
};
const showVersion = () => {
  const el = document.getElementById("version");
  const t = window.rusuiteI18n.t;
  if (!build) {
    el.textContent = t("portal.versionUnknown");
    return;
  }
  const date = String(build.builtAt || "").slice(0, 10);
  const version = publicVersion(build.version);
  el.textContent =
    (version ? "Rusuite " + version + " · " : "") + t("portal.build", { commit: String(build.commit || "?").slice(0, 7) }) + (date ? " · " + date : "");
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
