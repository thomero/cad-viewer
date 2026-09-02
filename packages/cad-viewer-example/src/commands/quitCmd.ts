import { AcEdCommand } from '@mlightcad/cad-simple-viewer'

import { exitDesktopApp, isDesktopHost } from '../desktop'
import { store } from '../store'

/** Command to close the CAD viewer or native Windows application. */
export class AcApQuitCmd extends AcEdCommand {
  async execute() {
    if (isDesktopHost()) {
      await exitDesktopApp()
      return
    }

    store.selectedFile = null
    store.isNewDrawing = false
  }
}
