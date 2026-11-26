#!/usr/bin/env bash
# Checks that built macOS apps declare their document types (P11-D1): Finder
# lists an app under "Open With" only when its Info.plist has
# CFBundleDocumentTypes (from `bundle.fileAssociations` in
# apps/<app>/src-tauri/tauri.macos.conf.json).
#
#   pnpm --filter calc tauri build --bundles app      # and write, show, notes
#   scripts/check-macos-doctypes.sh [calc|write|show|notes ...]
#
# APP_DIR (default target/release/bundle/macos) overrides where the .app
# bundles are. macOS only (plutil).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP_DIR=${APP_DIR:-$ROOT/target/release/bundle/macos}
command -v plutil >/dev/null || { echo "plutil missing: run this on macOS" >&2; exit 2; }

apps=("$@")
[ ${#apps[@]} -gt 0 ] || apps=(calc write show notes)

failed=0
for app in "${apps[@]}"; do
  case "$app" in
    calc) name="Rusuite Calc"; utis="org.openxmlformats.spreadsheetml.sheet public.comma-separated-values-text public.tab-separated-values-text" ;;
    write) name="Rusuite Write"; utis="org.openxmlformats.wordprocessingml.document org.openxmlformats.wordprocessingml.template" ;;
    show) name="Rusuite Show"; utis="org.openxmlformats.presentationml.presentation" ;;
    # Own types (UTExportedTypeDeclarations): the backup and OneNote files (.one / .onepkg have no system type).
    notes) name="Rusuite Notes"; utis="dev.rusuite.notes.backup dev.rusuite.notes.onenote" ;;
    *) echo "usage: $0 [calc|write|show|notes ...]" >&2; exit 2 ;;
  esac
  plist="$APP_DIR/$name.app/Contents/Info.plist"
  if [ ! -f "$plist" ]; then
    echo "FAIL $app: $plist missing (pnpm --filter $app tauri build --bundles app)"
    failed=$((failed + 1))
    continue
  fi
  json=$(plutil -extract CFBundleDocumentTypes json -o - "$plist" 2>/dev/null || true)
  if [ -z "$json" ]; then
    echo "FAIL $app: no CFBundleDocumentTypes in $plist"
    failed=$((failed + 1))
    continue
  fi
  missing=()
  for uti in $utis; do
    # Tauri declares each type by its UTI (LSItemContentTypes), role Editor, rank Alternate.
    node -e '
      const [types, uti] = [JSON.parse(process.argv[1]), process.argv[2]];
      const t = types.find((t) => (t.LSItemContentTypes || []).includes(uti));
      process.exit(t && t.CFBundleTypeRole === "Editor" && t.LSHandlerRank === "Alternate" ? 0 : 1);
    ' "$json" "$uti" || missing+=("$uti")
  done
  if [ "$app" = notes ]; then
    exported=$(plutil -extract UTExportedTypeDeclarations json -o - "$plist" 2>/dev/null || true)
    for uti in $utis; do
      case "$exported" in *"\"$uti\""*) ;; *) missing+=("exported $uti") ;; esac
    done
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    echo "FAIL $app: no Editor/Alternate document type for: ${missing[*]}"
    failed=$((failed + 1))
  else
    echo "ok   $app: CFBundleDocumentTypes cover $utis"
  fi
done
[ "$failed" = 0 ] && echo "all passed"
exit "$((failed > 0))"
