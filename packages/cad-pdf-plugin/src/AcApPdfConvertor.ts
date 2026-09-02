import type { AcApContext } from '@mlightcad/cad-simple-viewer'
import {
  AcApSettingManager,
  resolveExportDownloadName,
  saveExportBlob
} from '@mlightcad/cad-simple-viewer'
import { AcSvgRenderer } from '@mlightcad/cad-svg-plugin'
import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'

const PDF_MARGIN_MM = 10

/**
 * Utility class for converting CAD drawings to PDF format.
 *
 * Reuses the SVG renderer pipeline and converts the resulting SVG to a
 * vector PDF using jsPDF + svg2pdf.js.
 */
export class AcApPdfConvertor {
  /** Renders the current drawing (or current selection) to PDF and saves it. */
  async convert(context: AcApContext) {
    const svgString = await this.buildSvg(context)
    const downloadName = resolveExportDownloadName(
      context.doc.fileName || context.doc.docTitle,
      'pdf'
    )
    await this.saveAsPdf(svgString, downloadName)
  }

  private async buildSvg(context: AcApContext): Promise<string> {
    AcSvgRenderer.prepareExport()

    const renderer = new AcSvgRenderer()
    this.configureRenderer(renderer, context)

    const selectedIds = context.view.selectionSet.ids
    if (selectedIds.length > 0) {
      // Desktop users reasonably expect a preselection to define the plot
      // window. Export only those database entities when a selection exists.
      const selectedEntities = context.doc.entityService.getEntitiesByIds(selectedIds)
      for (const entity of selectedEntities) {
        entity.worldDraw(renderer)
      }
    } else {
      const entities =
        context.doc.database.tables.blockTable.modelSpace.newIterator()
      for (const entity of entities) {
        entity.worldDraw(renderer)
      }
    }

    return renderer.exportAsync()
  }

  private configureRenderer(renderer: AcSvgRenderer, context: AcApContext) {
    const db = context.doc.database
    renderer.ltscale = db.ltscale
    renderer.celtscale = db.celtscale
    renderer.showLineWeight = !!db.lwdisplay
    renderer.setFontMapping(AcApSettingManager.instance.fontMapping)

    // PDF is a printable document, not a screenshot of the dark CAD canvas.
    // Always use white paper and resolve ACI 7/foreground geometry as black.
    renderer.currentBackgroundColor = 0xffffff
    renderer.changeForeground(0x000000)
  }

  private async saveAsPdf(svgString: string, downloadName: string) {
    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
    const svgEl = svgDoc.documentElement as unknown as SVGSVGElement

    if (svgEl.nodeName.toLowerCase() === 'parsererror') {
      throw new Error('PDF export failed because the generated SVG is invalid')
    }

    const vb = svgEl.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    const vbWidth =
      vb && vb.length === 4 && Number.isFinite(vb[2]) && vb[2] !== 0
        ? Math.abs(vb[2])
        : 297
    const vbHeight =
      vb && vb.length === 4 && Number.isFinite(vb[3]) && vb[3] !== 0
        ? Math.abs(vb[3])
        : 210

    const orientation = vbWidth >= vbHeight ? 'landscape' : 'portrait'

    // Never map CAD world units directly to PDF millimetres. Large architectural
    // drawings can be thousands of drawing units wide; jsPDF clamps oversized
    // pages to 14,400 pt, which leaves the actual SVG clipped outside the page.
    // Fit the vector drawing onto a standard A3 sheet instead.
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a3'
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const availableWidth = Math.max(1, pageWidth - PDF_MARGIN_MM * 2)
    const availableHeight = Math.max(1, pageHeight - PDF_MARGIN_MM * 2)
    const scale = Math.min(availableWidth / vbWidth, availableHeight / vbHeight)
    const drawWidth = vbWidth * scale
    const drawHeight = vbHeight * scale
    const x = (pageWidth - drawWidth) / 2
    const y = (pageHeight - drawHeight) / 2

    await svg2pdf(svgEl, pdf, {
      x,
      y,
      width: drawWidth,
      height: drawHeight
    })

    const blob = pdf.output('blob')
    await saveExportBlob(blob, downloadName, 'pdf')
  }
}
