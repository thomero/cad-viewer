import { AcApContext, AcEdCommand } from '@mlightcad/cad-simple-viewer'

import { AcApPdfImportConvertor } from './AcApPdfImportConvertor'

/** Command for importing vector geometry from a PDF file (`ipdf`). */
export class AcApImportPdfCmd extends AcEdCommand {
  /** Opens a file picker and waits for PDF import to finish. */
  async execute(context: AcApContext) {
    const convertor = new AcApPdfImportConvertor()
    try {
      const imported = await convertor.importFromFilePicker(context)
      if (imported === undefined) return
      if (imported === 0) {
        this.showMessage('No vector geometry was found on the selected PDF page.', 'warning')
      } else {
        this.showMessage(`Imported ${imported} PDF entities.`, 'success')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.showMessage(`PDF import failed: ${message}`, 'error')
    }
  }
}
