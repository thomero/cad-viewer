# CAD Viewer for Windows

This directory contains the Windows desktop shell for the existing CAD Viewer application.

## Architecture

The Windows build intentionally reuses `packages/cad-viewer-example` as its frontend. The CAD parser,
renderer, editor, plugins, and UI remain in their existing packages; this directory only adds the
desktop host and Windows packaging.

```text
packages/cad-viewer-example (existing full viewer)
                |
                v
packages/cad-viewer-windows/src-tauri (Windows host)
                |
                v
       Windows .exe / NSIS installer
```

## Build locally on Windows

From the repository root:

```powershell
pnpm install --frozen-lockfile
cd packages/cad-viewer-windows
./generate-icon.ps1
pnpm dlx @tauri-apps/cli@2.11.4 icon app-icon.generated.png
pnpm dlx @tauri-apps/cli@2.11.4 build --bundles nsis
```

`generate-icon.ps1` creates a valid PNG on Windows and Tauri generates the platform icon resources
from it. The installer is written under:

`packages/cad-viewer-windows/src-tauri/target/release/bundle/nsis/`

## GitHub build

Use **Actions -> Windows Desktop Build -> Run workflow**. Pushes that change the Windows shell or
the full viewer also trigger the workflow automatically. The workflow builds the icon resources,
full CAD frontend, Windows executable, and NSIS installer, then uploads them as the
`CAD-Viewer-Windows-x64` artifact.
