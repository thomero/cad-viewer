type DesktopInvoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>

type DesktopTauri = {
  core?: {
    invoke?: DesktopInvoke
  }
}

function getDesktopInvoke(): DesktopInvoke | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { __TAURI__?: DesktopTauri }).__TAURI__?.core
    ?.invoke
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function browserDownload(blob: Blob, downloadName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = downloadName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Saves an exported Blob in both browser and Windows desktop hosts.
 *
 * Browser builds use the normal anchor-download path. The Tauri desktop host
 * uses a native Save As dialog and writes the bytes through the Rust backend,
 * avoiding WebView2's unreliable browser-download behavior.
 *
 * @returns The saved path in desktop mode, the download name in browser mode,
 * or `null` when the user cancels the native Save As dialog.
 */
export async function saveExportBlob(
  blob: Blob,
  downloadName: string,
  extension: string
): Promise<string | null> {
  const invoke = getDesktopInvoke()
  if (invoke) {
    const arrayBuffer = await blob.arrayBuffer()
    const dataBase64 = bytesToBase64(new Uint8Array(arrayBuffer))
    return invoke<string | null>('desktop_save_export_file', {
      defaultName: downloadName,
      extension: extension.replace(/^\./, '').toLowerCase(),
      dataBase64
    })
  }

  browserDownload(blob, downloadName)
  return downloadName
}

/** Saves UTF-8 text using the shared browser/desktop export path. */
export async function saveExportText(
  content: string,
  downloadName: string,
  extension: string,
  mimeType = 'text/plain;charset=utf-8'
): Promise<string | null> {
  return saveExportBlob(new Blob([content], { type: mimeType }), downloadName, extension)
}

/** Returns true when running inside the native Windows desktop host. */
export function isNativeDesktopHost(): boolean {
  return Boolean(getDesktopInvoke())
}
