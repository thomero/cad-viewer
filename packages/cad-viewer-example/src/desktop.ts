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

export const exitDesktopApp = async (): Promise<void> => {
  const api = tauri()
  if (!api) return
  await api.core.invoke('desktop_exit_app')
}

export const listenForDesktopFileOpen = async (
  handler: (path: string) => void
): Promise<UnlistenFn> => {
  const api = tauri()
  if (!api) return () => undefined
  return api.event.listen<string>('desktop-open-file', event => {
    if (typeof event.payload === 'string') handler(event.payload)
  })
}

export {}
