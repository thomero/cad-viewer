# CAD Viewer for Windows

This directory contains the Windows desktop shell for the existing CAD Viewer web application.

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
pnpm dlx @tauri-apps/cli@2.11.4 build --bundles nsis
```

The installer is written under:

`packages/cad-viewer-windows/src-tauri/target/release/bundle/nsis/`

## GitHub build

Use **Actions -> Windows Desktop Build -> Run workflow**. Pushes that change the Windows shell or
the full viewer also trigger the workflow automatically.
