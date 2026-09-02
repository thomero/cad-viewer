import { AcApContext } from '../../app'
import {
  AcEdCommand,
  AcEdOpenMode,
  AcEdPromptStringOptions
} from '../../editor'
import { AcApI18n } from '../../i18n'
import { saveExportText } from '../../util/AcApExportSaveUtil'
import { AcTrView2d } from '../../view'
import { runMeasurementEdit } from './AcApMeasurementHistory'
import { placeMeasurementRecord } from './AcApMeasurementPlace'
import {
  measurementSidecarFileName,
  parseMeasurementSidecar,
  stringifyMeasurementSidecar
} from './AcApMeasurementSidecar'
import { collectMeasurementRecords } from './AcApMeasurementStore'

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
    const finish = (text?: string) => {
      if (settled) return
      settled = true
      input.remove()
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
        console.error('[MeasurementImport] Failed to read JSON file', error)
        finish()
      }
    }
    input.click()
  })
}

/** Export current measurements to a `{drawing}.measurement.json` file. */
export class AcApMeasurementExportCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Read
    this.recordsUndoStack = false
  }

  async execute(context: AcApContext) {
    const view = context.view as AcTrView2d
    const drawingName = context.doc.fileName || context.doc.docTitle
    const text = stringifyMeasurementSidecar({
      version: 1,
      drawingName,
      measurements: collectMeasurementRecords(view)
    })
    await saveExportText(
      text,
      measurementSidecarFileName(drawingName),
      'json',
      'application/json;charset=utf-8'
    )
  }
}

/** Import measurements from a sidecar JSON file and place them on the view. */
export class AcApMeasurementImportCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Read
    this.recordsUndoStack = false
  }

  async execute(context: AcApContext) {
    void new AcEdPromptStringOptions(
      AcApI18n.t('jig.measurement.import.chooseFile')
    )
    const text = await pickJsonFile()
    if (text == null) return
    let sidecar
    try {
      sidecar = parseMeasurementSidecar(text)
    } catch (err) {
      console.error('[MeasurementImport] Invalid measurement JSON', err)
      return
    }
    const view = context.view as AcTrView2d
    const db = context.doc.database
    runMeasurementEdit(view, 'Import Measurements', () => {
      for (const record of sidecar.measurements) {
        placeMeasurementRecord(view, db, record)
      }
    })
  }
}
