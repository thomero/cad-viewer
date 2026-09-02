import { AcApContext } from '../../app'
import {
  AcEdCommand,
  AcEdOpenMode,
  AcEdPromptStringOptions
} from '../../editor'
import { AcApI18n } from '../../i18n'
import { saveExportText } from '../../util/AcApExportSaveUtil'
import { runMarkupEdit } from './AcApMarkupHistory'
import { getMarkupPresenter } from './AcApMarkupPresenter'
import {
  markupSidecarFileName,
  parseMarkupSidecar,
  stringifyMarkupSidecar
} from './AcApMarkupSidecar'
import { getMarkupStore } from './AcApMarkupStore'

function pickJsonFile(): Promise<string | undefined> {
  return new Promise(resolve => {
    if (typeof document === 'undefined') {
      resolve(undefined)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const cleanup = () => input.remove()
    const finish = (text?: string) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(text)
    }

    input.addEventListener('cancel', () => finish(), { once: true })
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        finish()
        return
      }
      try {
        finish(await file.text())
      } catch (error) {
        console.error('[MarkupImport] Failed to read JSON file', error)
        finish()
      }
    }
    input.click()
  })
}

/** Export current markups to a `{drawing}.markup.json` file. */
export class AcApMarkupExportCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Read
    this.recordsUndoStack = false
  }

  async execute(context: AcApContext) {
    const store = getMarkupStore()
    if (!store.drawingName) {
      store.drawingName = context.doc.fileName || context.doc.docTitle
    }
    const text = stringifyMarkupSidecar(store.toSidecar())
    const saved = await saveExportText(
      text,
      markupSidecarFileName(store.drawingName),
      'json',
      'application/json;charset=utf-8'
    )
    if (saved != null) store.markClean()
  }
}

/** Import markups from a sidecar JSON file and republish onto the view. */
export class AcApMarkupImportCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Review
    this.recordsUndoStack = false
  }

  async execute(context: AcApContext) {
    void new AcEdPromptStringOptions(AcApI18n.t('jig.markup.import.chooseFile'))
    const text = await pickJsonFile()
    if (text == null) return
    let sidecar
    try {
      sidecar = parseMarkupSidecar(text)
    } catch (err) {
      console.error('[MarkupImport] Invalid markup JSON', err)
      this.showMessage(AcApI18n.t('jig.markup.import.chooseFile'), 'error')
      return
    }
    const store = getMarkupStore()
    runMarkupEdit(context.view, 'Import Markups', () => {
      store.replaceAll(sidecar.markups, sidecar.drawingName)
      getMarkupPresenter().republishAll(context.view)
    })
  }
}
