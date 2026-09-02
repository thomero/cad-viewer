import { AcApDocManager } from '../../app'
import { saveExportBlob } from '../../util/AcApExportSaveUtil'

/**
 * Utility class for exporting the current CAD drawing to DXF format.
 */
export class AcApDxfConvertor {
  /**
   * Exports the current drawing database to a DXF file.
   */
  async convert() {
    const document = AcApDocManager.instance.curDocument
    const dxfContent = document.database.dxfOut(undefined, 6)
    const baseName = this.getBaseName(document.fileName || document.docTitle)
    const blobPart: BlobPart =
      typeof dxfContent === 'string' ? dxfContent : new Uint8Array(dxfContent)
    const dxfBlob = new Blob([blobPart], {
      type: 'application/dxf;charset=utf-8'
    })

    await saveExportBlob(dxfBlob, `${baseName}.dxf`, 'dxf')
  }

  private getBaseName(fileName: string) {
    const normalizedName = fileName?.trim() || 'drawing'
    return normalizedName.replace(/\.[^.]+$/, '') || 'drawing'
  }
}
