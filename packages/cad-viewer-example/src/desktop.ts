import {
  AcApDocManager,
  eventBus,
  getSessionUndo
} from '@mlightcad/cad-simple-viewer'

type UnlistenFn = () => void

type TauriEvent<T> = {
  payload: T
}

type TauriGlobal = {
  core: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  }
  event: {
    listen<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<UnlistenFn>
  }
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal
  }
}

const tauri = (): TauriGlobal | undefined => window.__TAURI__

export const isDesktopHost = (): boolean => Boolean(tauri()?.core?.invoke)

export const desktopBasename = (path: string): string => {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export const pickDesktopCadFile = async (): Promise<string | null> => {
  const api = tauri()
  if (!api) return null
  return api.core.invoke<string | null>('desktop_pick_cad_file')
}

export const getInitialDesktopCadFile = async (): Promise<string | null> => {
  const api = tauri()
  if (!api) return null
  return api.core.invoke<string | null>('desktop_initial_cad_file')
}

export const readDesktopCadFile = async (path: string): Promise<File> => {
  const api = tauri()
  if (!api) {
    throw new Error('Windows desktop bridge is not available')
  }

  const raw = await api.core.invoke<ArrayBuffer | Uint8Array>(
    'desktop_read_cad_file',
    { path }
  )
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const name = desktopBasename(path)
  const mime = name.toLowerCase().endsWith('.dxf')
    ? 'image/vnd.dxf'
    : 'image/vnd.dwg'

  return new File([buffer], name, { type: mime })
}

export const setDesktopWindowTitle = async (title: string): Promise<void> => {
  const api = tauri()
  if (!api) return
  await api.core.invoke('desktop_set_window_title', { title })
}

const setDesktopDocumentDirty = async (dirty: boolean): Promise<void> => {
  const api = tauri()
  if (!api) return
  await api.core.invoke('desktop_set_document_dirty', { dirty })
}

export const exitDesktopApp = async (): Promise<boolean> => {
  const api = tauri()
  if (!api) return false
  return api.core.invoke<boolean>('desktop_exit_app')
}

/**
 * Listens for both Explorer/single-instance file opens and the CAD `OPEN`
 * command. The installed Windows application uses one native file-opening path
 * everywhere, so File > Open, Ctrl+O and Explorer behave consistently.
 *
 * This listener also mirrors the CAD session undo state into the native host so
 * Windows close/Alt+F4/Quit can protect unsaved edits.
 */
export const listenForDesktopFileOpen = async (
  handler: (path: string) => void
): Promise<UnlistenFn> => {
  const api = tauri()
  if (!api) return () => undefined

  const unlistenTauri = await api.event.listen<string>(
    'desktop-open-file',
    event => {
      if (typeof event.payload === 'string') handler(event.payload)
    }
  )

  const handleCadOpenCommand = () => {
    void pickDesktopCadFile().then(path => {
      if (path) handler(path)
    })
  }

  const syncDirtyState = () => {
    try {
      const db = AcApDocManager.instance.curDocument.database
      void setDesktopDocumentDirty(getSessionUndo().canUndo(db))
    } catch {
      void setDesktopDocumentDirty(false)
    }
  }

  eventBus.on('open-file', handleCadOpenCommand)
  eventBus.on('undo-stack-changed', syncDirtyState)

  return () => {
    unlistenTauri()
    eventBus.off('open-file', handleCadOpenCommand)
    eventBus.off('undo-stack-changed', syncDirtyState)
  }
}

export {}
