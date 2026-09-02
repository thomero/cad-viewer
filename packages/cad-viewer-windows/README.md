# CAD Viewer for Windows

This directory contains the Windows desktop product layer for the existing full CAD Viewer application.
The CAD parser, renderer, editor, measurement/review tools, plugins, and UI remain in their existing
packages; the Windows layer adds native desktop behavior and packaging instead of duplicating the CAD
engine.

## Windows features

- Full existing CAD Viewer frontend inside a Tauri/WebView2 desktop application.
- Installable per-user NSIS package; no administrator requirement for the normal install path.
- `.dwg` and `.dxf` Windows file associations.
- Double-click a DWG/DXF in Explorer to open it directly in CAD Viewer.
- Single-instance behavior: opening another drawing focuses the existing app and forwards the file.
- Native Windows Open dialog (`Ctrl+O`).
- `Ctrl+N` creates a new drawing.
- Explorer drag-and-drop works on both the start screen and while a drawing is open.
- Recent-file shortcuts for drawings opened through the desktop file picker/Explorer.
- Drawing filename is reflected in the Windows title bar.
- Offline desktop runtime data: the Windows workflow bundles the public `mlightcad/cad-data` assets
  instead of requiring the CDN at runtime.
- Start Menu shortcut under **Moudouros Software** and normal Windows uninstall support.
- A separate Microsoft Store bundle override is included at `src-tauri/tauri.microsoftstore.conf.json`.

## Architecture

```text
packages/cad-viewer-example (existing full viewer/editor)
                |
                v
packages/cad-viewer-windows/src-tauri (Windows integration)
                |
                v
       Windows .exe / NSIS installer
```

The desktop-specific TypeScript bridge lives at:

`packages/cad-viewer-example/src/desktop.ts`

It is dormant in the normal browser build and activates only when the frontend is running inside the
Tauri desktop host.

## GitHub build

Use **Actions -> Windows Desktop Build -> Run workflow**. Pushes that change the Windows shell or full
viewer also trigger the workflow automatically.

The workflow:

1. installs the monorepo dependencies;
2. bundles `mlightcad/cad-data` into the desktop frontend for offline use;
3. generates Windows icon resources;
4. builds the existing CAD package dependency graph and frontend;
5. compiles the Tauri x64 executable;
6. creates the NSIS installer;
7. verifies both outputs exist; and
8. uploads `CAD-Viewer-Windows-x64` as the GitHub Actions artifact.

Installer output inside the build workspace:

`packages/cad-viewer-windows/src-tauri/target/release/bundle/nsis/`

## Local Windows build

For the same offline behavior as GitHub Actions, first place a checkout of the runtime data at
`packages/cad-viewer-example/public/cad-data`:

```powershell
git clone --depth 1 https://github.com/mlightcad/cad-data.git packages/cad-viewer-example/public/cad-data
pnpm install --frozen-lockfile
cd packages/cad-viewer-windows
./generate-icon.ps1
pnpm dlx @tauri-apps/cli@2.11.4 icon app-icon.generated.png
pnpm dlx @tauri-apps/cli@2.11.4 build --bundles nsis
```

## Microsoft Store bundle

The normal test installer uses WebView2's download bootstrapper to keep the installer small. For a
future Microsoft Store package, merge the Store override when bundling so WebView2 is carried by the
offline installer configuration required for that distribution path.
