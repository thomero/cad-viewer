import 'element-plus/dist/index.css'
import '../style/style.css'
import '../style/index.scss'

import {
  AcApDocManager,
  AcApDocManagerOptions
} from '@mlightcad/cad-simple-viewer'

import {
  registerCmds,
  registerDialogs,
  registerLazyPlugins,
  type RegisterLazyPluginsOptions,
  registerMTextColorPicker
} from './register'

/** Options for {@link initializeCadViewer}. */
export type InitializeCadViewerOptions = AcApDocManagerOptions & {
  /**
   * URL of `viewer-runtime.iife.js` for HTML export (`chtml`).
   * Forwarded to `@mlightcad/cad-html-plugin` — not required to open DXF/DWG.
   * @default './assets/viewer-runtime.iife.js'
   */
  htmlViewerRuntimeUrl?: string | URL
}

const isNativeDesktopHost = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__)

export const initializeCadViewer = (
  options: InitializeCadViewerOptions = {}
) => {
  const { htmlViewerRuntimeUrl, ...docOptions } = options

  // The browser OPEN picker is correct for web builds, but in the installed
  // Tauri/WebView2 application it bypasses the native Windows file workflow.
  // Disable it automatically in the native host; the desktop adapter handles
  // the same `open-file` command event with rfd instead.
  AcApDocManager.createInstance({
    ...docOptions,
    builtinOpenFileDialog:
      docOptions.builtinOpenFileDialog ?? !isNativeDesktopHost()
  })
  registerCmds()
  registerDialogs()
  registerMTextColorPicker()

  const lazyPluginOptions: RegisterLazyPluginsOptions = {
    htmlPlugin: {
      viewerRuntimeUrl:
        htmlViewerRuntimeUrl ?? './assets/viewer-runtime.iife.js'
    }
  }
  registerLazyPlugins(lazyPluginOptions)
}
