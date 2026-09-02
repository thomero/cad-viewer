<template>
  <div id="app-root">
    <!-- Upload screen when no drawing is open -->
    <div v-if="!showViewer" class="upload-screen">
      <div class="upload-shell">
        <section v-if="desktopMode" class="desktop-panel">
          <div class="desktop-panel__copy">
            <strong>Windows desktop</strong>
            <span>Open local DWG/DXF files, or press Ctrl+O.</span>
          </div>
          <button
            type="button"
            class="desktop-open-button"
            @click="handleDesktopOpen"
          >
            Open DWG / DXF
          </button>

          <div v-if="recentFiles.length" class="desktop-recents">
            <span class="desktop-recents__label">Recent</span>
            <button
              v-for="item in recentFiles"
              :key="item.path"
              type="button"
              class="desktop-recent-button"
              :title="item.path"
              @click="openDesktopPath(item.path, false)"
            >
              {{ item.name }}
            </button>
          </div>
        </section>

        <FileUpload
          @file-select="handleFileSelect"
          @new-drawing="handleNewDrawing"
        />
      </div>
    </div>

    <!-- CAD viewer when a file is selected or a new drawing is created -->
    <div v-else>
      <MlCadViewer
        locale="default"
        :local-file="store.selectedFile ?? undefined"
        :mode="selectedMode"
        :use-main-thread-draw="useMainThreadDraw"
        :draw-no-plot-layers="drawNoPlotLayers"
        :progressive-rendering="progressiveRendering"
        :open-view-mode="openViewMode"
        :circle-sides="circleSides"
        @create="onViewerCreate"
        :base-url="BASE_URL"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  AcApDocManager,
  AcApOpenViewMode,
  AcApSettingManager,
  AcEdCommandStack,
  AcEdOpenMode
} from '@mlightcad/cad-simple-viewer'
import { MlCadViewer } from '@mlightcad/cad-viewer'
import { ACDB_DRAW_CIRCLE_SIDES_DRAFT, log } from '@mlightcad/data-model'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'

import { AcApQuitCmd } from './commands'
import FileUpload from './components/FileUpload.vue'
import {
  desktopBasename,
  getInitialDesktopCadFile,
  isDesktopHost,
  listenForDesktopFileOpen,
  pickDesktopCadFile,
  readDesktopCadFile,
  setDesktopWindowTitle
} from './desktop'
import { initializeLocale } from './locale'
import { store } from './store'

// Isolate this example's prefs from cad-simple-viewer-example on localhost.
AcApSettingManager.configure({
  storageKey: 'mlightcad.settings.cad-viewer'
})

initializeLocale()

const desktopMode = isDesktopHost()
const RECENT_FILES_KEY = 'moudouros.cadviewer.recentFiles'
const MAX_RECENT_FILES = 6

const loadRecentPaths = (): string[] => {
  if (!desktopMode) return []
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || '[]')
    return Array.isArray(value)
      ? value.filter(item => typeof item === 'string').slice(0, MAX_RECENT_FILES)
      : []
  } catch {
    return []
  }
}

const recentPaths = ref<string[]>(loadRecentPaths())
const recentFiles = computed(() =>
  recentPaths.value.map(path => ({ path, name: desktopBasename(path) }))
)

const rememberRecent = (path: string) => {
  if (!desktopMode) return
  recentPaths.value = [
    path,
    ...recentPaths.value.filter(item => item.toLowerCase() !== path.toLowerCase())
  ].slice(0, MAX_RECENT_FILES)
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentPaths.value))
}

const forgetRecent = (path: string) => {
  recentPaths.value = recentPaths.value.filter(
    item => item.toLowerCase() !== path.toLowerCase()
  )
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentPaths.value))
}

const initialize = () => {
  if (import.meta.env.DEV) {
    ;(
      window as Window & { AcApDocManager?: typeof AcApDocManager }
    ).AcApDocManager = AcApDocManager
  }
  const register = AcApDocManager.instance.commandManager
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'quit',
    'quit',
    new AcApQuitCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'exit',
    'exit',
    new AcApQuitCmd()
  )
}

const BASE_URL = desktopMode
  ? './cad-data/'
  : 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/'

const showViewer = computed(
  () => store.selectedFile != null || store.isNewDrawing
)

const selectedMode = ref<AcEdOpenMode>(AcEdOpenMode.Write)
const useMainThreadDraw = ref(false)
const drawNoPlotLayers = ref(false)
const progressiveRendering = ref(false)
const openViewMode = ref<AcApOpenViewMode | undefined>(undefined)
const circleSides = ref(ACDB_DRAW_CIRCLE_SIDES_DRAFT)

const createNewDrawing = async () => {
  const success = await AcApDocManager.instance.newDocument({
    mode: selectedMode.value,
    drawNoPlotLayers: drawNoPlotLayers.value,
    progressiveRendering: progressiveRendering.value,
    circleSides: circleSides.value,
    ...(openViewMode.value != null ? { openViewMode: openViewMode.value } : {})
  })
  if (!success) {
    log.error('Failed to create new drawing')
  }
}

const onViewerCreate = async () => {
  initialize()
  if (store.isNewDrawing) {
    await nextTick()
    await createNewDrawing()
  }
}

const applyOpenOptions = (
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined,
  sides: number
) => {
  selectedMode.value = mode
  useMainThreadDraw.value = mainThreadDraw
  drawNoPlotLayers.value = showNoPlotLayers
  progressiveRendering.value = enableProgressiveRendering
  openViewMode.value = viewMode
  circleSides.value = sides
}

// Handle file selection from upload component
const handleFileSelect = (
  file: File,
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined,
  sides: number
) => {
  store.isNewDrawing = false
  store.selectedFile = file
  applyOpenOptions(
    mode,
    mainThreadDraw,
    showNoPlotLayers,
    enableProgressiveRendering,
    viewMode,
    sides
  )

  if (desktopMode) {
    void setDesktopWindowTitle(`${file.name} — CAD Viewer`)
  }
}

const handleNewDrawing = (
  mode: AcEdOpenMode,
  mainThreadDraw: boolean,
  showNoPlotLayers: boolean,
  enableProgressiveRendering: boolean,
  viewMode: AcApOpenViewMode | undefined,
  sides: number
) => {
  store.selectedFile = null
  store.isNewDrawing = true
  applyOpenOptions(
    mode,
    mainThreadDraw,
    showNoPlotLayers,
    enableProgressiveRendering,
    viewMode,
    sides
  )

  if (desktopMode) {
    void setDesktopWindowTitle('Untitled — CAD Viewer')
  }
}

const replaceCurrentDrawing = (): boolean => {
  if (!showViewer.value) return true
  return window.confirm(
    'Open another drawing? Any unsaved changes in the current drawing may be lost.'
  )
}

const openDesktopPath = async (path: string, confirmReplace: boolean) => {
  if (!desktopMode) return
  if (confirmReplace && !replaceCurrentDrawing()) return

  try {
    const file = await readDesktopCadFile(path)

    // Recreate the viewer between files. This avoids stale document state when
    // Explorer opens a second drawing while the application is already running.
    store.selectedFile = null
    store.isNewDrawing = false
    await nextTick()

    handleFileSelect(
      file,
      selectedMode.value,
      useMainThreadDraw.value,
      drawNoPlotLayers.value,
      progressiveRendering.value,
      openViewMode.value,
      circleSides.value
    )
    rememberRecent(path)
  } catch (error) {
    forgetRecent(path)
    const message = error instanceof Error ? error.message : String(error)
    window.alert(`Could not open the drawing.\n\n${message}`)
  }
}

const handleDesktopOpen = async () => {
  if (!desktopMode) return
  const path = await pickDesktopCadFile()
  if (path) await openDesktopPath(path, false)
}

const isCadFile = (file: File): boolean => {
  const name = file.name.toLowerCase()
  return name.endsWith('.dwg') || name.endsWith('.dxf')
}

const handleWindowDragOver = (event: DragEvent) => {
  if (desktopMode && showViewer.value && event.dataTransfer?.types.includes('Files')) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
}

const handleWindowDrop = async (event: DragEvent) => {
  if (!desktopMode || !showViewer.value) return
  const file = event.dataTransfer?.files?.[0]
  if (!file || !isCadFile(file)) return

  event.preventDefault()
  if (!replaceCurrentDrawing()) return

  store.selectedFile = null
  store.isNewDrawing = false
  await nextTick()
  handleFileSelect(
    file,
    selectedMode.value,
    useMainThreadDraw.value,
    drawNoPlotLayers.value,
    progressiveRendering.value,
    openViewMode.value,
    circleSides.value
  )
}

const handleDesktopKeydown = async (event: KeyboardEvent) => {
  if (!desktopMode || event.defaultPrevented || !event.ctrlKey || event.altKey) return

  const key = event.key.toLowerCase()
  if (key === 'o') {
    event.preventDefault()
    const path = await pickDesktopCadFile()
    if (path) await openDesktopPath(path, true)
  } else if (key === 'n') {
    event.preventDefault()
    if (!replaceCurrentDrawing()) return
    store.selectedFile = null
    store.isNewDrawing = false
    await nextTick()
    handleNewDrawing(
      selectedMode.value,
      useMainThreadDraw.value,
      drawNoPlotLayers.value,
      progressiveRendering.value,
      openViewMode.value,
      circleSides.value
    )
  }
}

let unlistenDesktopOpen: (() => void) | undefined

onMounted(async () => {
  if (!desktopMode) return

  window.addEventListener('keydown', handleDesktopKeydown)
  window.addEventListener('dragover', handleWindowDragOver)
  window.addEventListener('drop', handleWindowDrop)

  unlistenDesktopOpen = await listenForDesktopFileOpen(path => {
    void openDesktopPath(path, true)
  })

  const initialFile = await getInitialDesktopCadFile()
  if (initialFile) {
    await openDesktopPath(initialFile, false)
  }
})

onBeforeUnmount(() => {
  unlistenDesktopOpen?.()
  window.removeEventListener('keydown', handleDesktopKeydown)
  window.removeEventListener('dragover', handleWindowDragOver)
  window.removeEventListener('drop', handleWindowDrop)
})

watch(showViewer, visible => {
  if (desktopMode && !visible) {
    void setDesktopWindowTitle('CAD Viewer')
  }
})
</script>

<style scoped>
#app-root {
  width: 100vw;
  height: 100vh;
  position: fixed;
}

.upload-screen {
  height: 100vh;
  width: 100vw;
  display: flex;
  justify-content: center;
  align-items: safe center;
  overflow-y: auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin: 0;
  padding: 16px;
  box-sizing: border-box;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
  pointer-events: auto;
}

.upload-shell {
  width: min(100%, 852px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.desktop-panel {
  width: calc(100% - 32px);
  max-width: 820px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 16px;
  align-items: center;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.78);
  color: #ffffff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(10px);
}

.desktop-panel__copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
  font-size: 12px;
  color: #cbd5e1;
}

.desktop-panel__copy strong {
  color: #ffffff;
  font-size: 13px;
}

.desktop-open-button {
  border: 0;
  border-radius: 8px;
  padding: 8px 13px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.desktop-open-button:hover {
  background: #f8fafc;
}

.desktop-recents {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding-top: 3px;
}

.desktop-recents__label {
  flex: 0 0 auto;
  color: #94a3b8;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.desktop-recent-button {
  flex: 0 0 auto;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  padding: 4px 9px;
  background: rgba(255, 255, 255, 0.08);
  color: #e2e8f0;
  font-size: 10px;
  cursor: pointer;
}

.desktop-recent-button:hover {
  background: rgba(255, 255, 255, 0.14);
}

@media (max-width: 700px) {
  .desktop-panel {
    grid-template-columns: 1fr;
  }

  .desktop-open-button {
    width: 100%;
  }
}
</style>
