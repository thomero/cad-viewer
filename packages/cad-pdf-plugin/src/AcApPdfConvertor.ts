import type { AcApContext } from '@mlightcad/cad-simple-viewer'
import {
  AcApSettingManager,
  resolveExportDownloadName,
  saveExportBlob
} from '@mlightcad/cad-simple-viewer'
import { AcSvgRenderer } from '@mlightcad/cad-svg-plugin'
import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'

import {
  AcApPdfPlotBounds,
  AcApPdfPlotSettings,
  DEFAULT_PDF_PLOT_SETTINGS,
  normalizePdfPlotBounds
} from './AcApPdfPlotSettings'

/**
 * Utility class for plotting CAD drawings to vector PDF.
 *
 * The exporter deliberately separates the drawing's world extents from the
 * requested plot area. This prevents one distant/stray CAD entity from making
 * the intended drawing microscopic on the paper.
 */
export class AcApPdfConvertor {
  /** Renders the requested plot area to PDF and saves it. */
  async convert(
    context: AcApContext,
    settings: AcApPdfPlotSettings = { ...DEFAULT_PDF_PLOT_SETTINGS }
  ) {
    const normalizedSettings = this.normalizeSettings(settings)
    const svgString = await this.buildSvg(context, normalizedSettings)
    const plotBounds = this.resolvePlotBounds(context, normalizedSettings)
    const downloadName = resolveExportDownloadName(
      context.doc.fileName || context.doc.docTitle,
      'pdf'
    )
    await this.saveAsPdf(
      svgString,
      downloadName,
      normalizedSettings,
      plotBounds
    )
  }

  private async buildSvg(
    context: AcApContext,
    settings: AcApPdfPlotSettings
  ): Promise<string> {
    AcSvgRenderer.prepareExport()

    const renderer = new AcSvgRenderer()
    this.configureRenderer(renderer, context)

    if (settings.plotArea === 'selection') {
      const selectedIds = context.view.selectionSet.ids
      if (selectedIds.length === 0) {
        throw new Error(
          'PDF export requires at least one selected entity when Plot area is Selection.'
        )
      }

      const selectedEntities =
        context.doc.entityService.getEntitiesByIds(selectedIds)
      for (const entity of selectedEntities) {
        entity.worldDraw(renderer)
      }
    } else {
      // Current View and Window are cropped later using their explicit world
      // bounds. Drawing Extents intentionally renders the full model space.
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

  private resolvePlotBounds(
    context: AcApContext,
    settings: AcApPdfPlotSettings
  ): AcApPdfPlotBounds | undefined {
    if (settings.plotArea === 'window') {
      if (!settings.windowBounds) {
        throw new Error('PDF Window plot area is missing its selected bounds.')
      }
      const bounds = normalizePdfPlotBounds(settings.windowBounds)
      if (!bounds) {
        throw new Error('PDF Window plot area is empty or invalid.')
      }
      return bounds
    }

    if (settings.plotArea !== 'currentView') {
      return undefined
    }

    // Use all four screen corners so this remains correct even if a future 2D
    // view supports a rotated camera/UCS. The resulting plot area is the
    // axis-aligned world box currently visible on the canvas.
    const corners = [
      context.view.screenToWorld({ x: 0, y: 0 }),
      context.view.screenToWorld({ x: context.view.width, y: 0 }),
      context.view.screenToWorld({ x: 0, y: context.view.height }),
      context.view.screenToWorld({
        x: context.view.width,
        y: context.view.height
      })
    ]

    return normalizePdfPlotBounds({
      minX: Math.min(...corners.map(point => point.x)),
      minY: Math.min(...corners.map(point => point.y)),
      maxX: Math.max(...corners.map(point => point.x)),
      maxY: Math.max(...corners.map(point => point.y))
    })
  }

  private normalizeSettings(
    settings: AcApPdfPlotSettings
  ): AcApPdfPlotSettings {
    const marginMm = Number.isFinite(settings.marginMm)
      ? Math.min(50, Math.max(0, settings.marginMm))
      : DEFAULT_PDF_PLOT_SETTINGS.marginMm

    return {
      ...DEFAULT_PDF_PLOT_SETTINGS,
      ...settings,
      scaleMode: 'fit',
      marginMm
    }
  }

  private async saveAsPdf(
    svgString: string,
    downloadName: string,
    settings: AcApPdfPlotSettings,
    plotBounds?: AcApPdfPlotBounds
  ) {
    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
    const svgEl = svgDoc.documentElement as unknown as SVGSVGElement

    if (svgEl.nodeName.toLowerCase() === 'parsererror') {
      throw new Error('PDF export failed because the generated SVG is invalid')
    }

    if (plotBounds) {
      this.applyPlotBounds(svgEl, plotBounds)
    }

    const viewBox = this.readViewBox(svgEl)
    const orientation =
      settings.orientation === 'auto'
        ? viewBox.width >= viewBox.height
          ? 'landscape'
          : 'portrait'
        : settings.orientation

    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: settings.paperSize
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const availableWidth = Math.max(1, pageWidth - settings.marginMm * 2)
    const availableHeight = Math.max(1, pageHeight - settings.marginMm * 2)

    // Fit to paper while preserving CAD aspect ratio. Drawing units are never
    // treated as millimetres; they only determine the plot aspect ratio.
    const scale = Math.min(
      availableWidth / viewBox.width,
      availableHeight / viewBox.height
    )
    const drawWidth = viewBox.width * scale
    const drawHeight = viewBox.height * scale
    const x = settings.centerPlot
      ? (pageWidth - drawWidth) / 2
      : settings.marginMm
    const y = settings.centerPlot
      ? (pageHeight - drawHeight) / 2
      : settings.marginMm

    await svg2pdf(svgEl, pdf, {
      x,
      y,
      width: drawWidth,
      height: drawHeight
    })

    const blob = pdf.output('blob')
    await saveExportBlob(blob, downloadName, 'pdf')
  }

  private readViewBox(svgEl: SVGSVGElement) {
    const values = svgEl
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number)

    if (
      !values ||
      values.length !== 4 ||
      !values.every(Number.isFinite) ||
      values[2] === 0 ||
      values[3] === 0
    ) {
      throw new Error('PDF export failed because the drawing plot area is empty.')
    }

    return {
      x: values[0],
      y: values[1],
      width: Math.abs(values[2]),
      height: Math.abs(values[3])
    }
  }

  /**
   * Replaces the SVG's global drawing extents with an explicit plot window and
   * clips all exported geometry to it. CAD WCS Y is inverted in the SVG root,
   * hence `y = -maxY`.
   */
  private applyPlotBounds(svgEl: SVGSVGElement, bounds: AcApPdfPlotBounds) {
    const normalized = normalizePdfPlotBounds(bounds)
    if (!normalized) {
      throw new Error('PDF plot area is empty or invalid.')
    }

    const width = normalized.maxX - normalized.minX
    const height = normalized.maxY - normalized.minY
    const svgX = normalized.minX
    const svgY = -normalized.maxY

    svgEl.setAttribute('viewBox', `${svgX} ${svgY} ${width} ${height}`)
    svgEl.setAttribute('width', String(width))
    svgEl.setAttribute('height', String(height))
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svgEl.setAttribute('overflow', 'hidden')

    // Explicit clipping is intentional. Some SVG-to-PDF engines do not enforce
    // the root SVG viewport's overflow semantics consistently, which can allow
    // distant entities to spill into the requested plot area or paper margins.
    const namespace = 'http://www.w3.org/2000/svg'
    const originalChildren = Array.from(svgEl.childNodes)
    const defs = svgEl.ownerDocument.createElementNS(namespace, 'defs')
    const clipPath = svgEl.ownerDocument.createElementNS(namespace, 'clipPath')
    const clipId = 'mlightcad-pdf-plot-clip'
    clipPath.setAttribute('id', clipId)

    const clipRect = svgEl.ownerDocument.createElementNS(namespace, 'rect')
    clipRect.setAttribute('x', String(svgX))
    clipRect.setAttribute('y', String(svgY))
    clipRect.setAttribute('width', String(width))
    clipRect.setAttribute('height', String(height))
    clipPath.appendChild(clipRect)
    defs.appendChild(clipPath)

    const plotGroup = svgEl.ownerDocument.createElementNS(namespace, 'g')
    plotGroup.setAttribute('clip-path', `url(#${clipId})`)
    for (const node of originalChildren) {
      plotGroup.appendChild(node)
    }

    svgEl.appendChild(defs)
    svgEl.appendChild(plotGroup)
  }
}
