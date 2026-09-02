import {
  type AcApContext,
  AcApSettingManager,
  AcTrView2d,
  resolveExportDownloadName,
  saveExportBlob
} from '@mlightcad/cad-simple-viewer'
import { AcSvgRenderer } from '@mlightcad/cad-svg-plugin'
import { AcDbRay, AcDbXline, AcGeBox2d, AcGePoint2d } from '@mlightcad/data-model'
import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'

import {
  AcApPdfPlotBounds,
  AcApPdfPlotSettings,
  AcApPdfPlotStyle,
  DEFAULT_PDF_PLOT_SETTINGS,
  normalizePdfPlotBounds
} from './AcApPdfPlotSettings'

const DEFAULT_PLOT_LINEWEIGHT_MM = 0.18
const MIN_TRANSFORM_SCALE = 1e-9
const SELECTION_BOUNDS_MARGIN = 1.02

interface SvgViewBox {
  x: number
  y: number
  width: number
  height: number
}

interface RgbColor {
  r: number
  g: number
  b: number
}

/**
 * Utility class for plotting CAD drawings to vector PDF.
 *
 * Plot framing is resolved from the live CAD view before asynchronous SVG
 * generation starts. Current View / Window also render only entities that are
 * spatially relevant to the requested plot area, so distant model-space sheets
 * cannot leak into the PDF even when an SVG-to-PDF engine ignores clipping.
 */
export class AcApPdfConvertor {
  /** Renders the requested plot area to PDF and saves it. */
  async convert(
    context: AcApContext,
    settings: AcApPdfPlotSettings = { ...DEFAULT_PDF_PLOT_SETTINGS }
  ) {
    const normalizedSettings = this.normalizeSettings(settings)

    // Capture view/selection framing first. Font and image resolution during
    // SVG generation is asynchronous and must never be allowed to change what
    // "Current View" meant when the user pressed Export PDF.
    const plotBounds = this.resolvePlotBounds(context, normalizedSettings)
    const svgString = await this.buildSvg(
      context,
      normalizedSettings,
      plotBounds
    )
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
    settings: AcApPdfPlotSettings,
    plotBounds?: AcApPdfPlotBounds
  ): Promise<string> {
    AcSvgRenderer.prepareExport()

    const renderer = new AcSvgRenderer()
    this.configureRenderer(renderer, context)

    const entities = this.resolveEntitiesForPlot(context, settings, plotBounds)
    if (entities.length === 0) {
      throw new Error('PDF export failed because the requested plot area is empty.')
    }

    for (const entity of entities) {
      entity.worldDraw(renderer)
    }

    return renderer.exportAsync()
  }

  /**
   * Resolves the database entities that actually participate in this plot.
   *
   * Current View / Window use the live scene spatial index rather than drawing
   * the entire Model Space and hoping the PDF clip path removes everything else.
   * This is both more faithful to the canvas and robust against svg2pdf clip-path
   * limitations. Selection remains an explicit list. Drawing Extents uses the
   * active layout BTR (Model Space only as a compatibility fallback).
   */
  private resolveEntitiesForPlot(
    context: AcApContext,
    settings: AcApPdfPlotSettings,
    plotBounds?: AcApPdfPlotBounds
  ) {
    if (settings.plotArea === 'selection') {
      const selectedIds = context.view.selectionSet.ids
      if (selectedIds.length === 0) {
        throw new Error(
          'PDF export requires at least one selected entity when Plot area is Selection.'
        )
      }
      return context.doc.entityService.getEntitiesByIds(selectedIds)
    }

    if (
      (settings.plotArea === 'currentView' || settings.plotArea === 'window') &&
      plotBounds
    ) {
      const queryBox = this.toGeBox2d(plotBounds)
      const ids = Array.from(
        new Set(
          context.view
            .search(queryBox)
            .filter(item => context.view.getEntityVisible(item.id) !== false)
            .map(item => item.id)
        )
      )

      if (ids.length > 0) {
        return context.doc.entityService.getEntitiesByIds(ids)
      }
    }

    const db = context.doc.database
    if (context.view instanceof AcTrView2d) {
      const activeLayoutBtr = db.tables.blockTable.getIdAt(
        context.view.activeLayoutBtrId
      )
      if (activeLayoutBtr) {
        return Array.from(activeLayoutBtr.newIterator())
      }
    }

    return Array.from(db.tables.blockTable.modelSpace.newIterator())
  }

  private toGeBox2d(bounds: AcApPdfPlotBounds): AcGeBox2d {
    return new AcGeBox2d().setFromPoints([
      new AcGePoint2d(bounds.minX, bounds.minY),
      new AcGePoint2d(bounds.maxX, bounds.maxY)
    ])
  }

  private configureRenderer(renderer: AcSvgRenderer, context: AcApContext) {
    const db = context.doc.database
    renderer.ltscale = db.ltscale
    renderer.celtscale = db.celtscale

    // LWDISPLAY controls the interactive screen, not plotting. The SVG carries
    // the CAD physical lineweight as metadata and saveAsPdf resolves it once the
    // final paper scale is known.
    renderer.showLineWeight = false
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

    if (settings.plotArea === 'currentView') {
      return this.resolveCurrentViewBounds(context)
    }

    if (settings.plotArea === 'selection') {
      return this.resolveSelectionBounds(context)
    }

    return undefined
  }

  /**
   * Uses the live CSS canvas rectangle as the authoritative visible viewport.
   * `AcEdBaseView.width/height` can be supplied by an application callback and
   * may briefly lag the actual desktop canvas while UI chrome resizes.
   */
  private resolveCurrentViewBounds(
    context: AcApContext
  ): AcApPdfPlotBounds | undefined {
    const rect = context.view.canvas.getBoundingClientRect()
    const width = rect.width > 0 ? rect.width : context.view.width
    const height = rect.height > 0 ? rect.height : context.view.height

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined
    }

    const corners = [
      context.view.screenToWorld({ x: 0, y: 0 }),
      context.view.screenToWorld({ x: width, y: 0 }),
      context.view.screenToWorld({ x: 0, y: height }),
      context.view.screenToWorld({ x: width, y: height })
    ]

    return normalizePdfPlotBounds({
      minX: Math.min(...corners.map(point => point.x)),
      minY: Math.min(...corners.map(point => point.y)),
      maxX: Math.max(...corners.map(point => point.x)),
      maxY: Math.max(...corners.map(point => point.y))
    })
  }

  /**
   * Frames Selection from the actual live Three.js geometry, not from the SVG
   * renderer's entity.box union. The latter can be effectively infinite for
   * RAY/XLINE or wildly oversized for malformed entities, which was shrinking a
   * valid selection to a few dots on an A3 page.
   *
   * Unbounded construction entities are still rendered, but are excluded from
   * the fit calculation. If they are the only selected objects, Current View is
   * the safest deterministic framing.
   */
  private resolveSelectionBounds(
    context: AcApContext
  ): AcApPdfPlotBounds | undefined {
    const selectedIds = context.view.selectionSet.ids
    if (selectedIds.length === 0) {
      throw new Error(
        'PDF export requires at least one selected entity when Plot area is Selection.'
      )
    }

    const selectedEntities = context.doc.entityService.getEntitiesByIds(selectedIds)
    const boundedIds = selectedEntities
      .filter(entity => !(entity instanceof AcDbRay) && !(entity instanceof AcDbXline))
      .map(entity => entity.objectId)

    if (context.view instanceof AcTrView2d && boundedIds.length > 0) {
      const box = context.view.cadScene.computeEntityPreviewBounds2d(
        boundedIds,
        SELECTION_BOUNDS_MARGIN,
        'active-first'
      )
      if (box && !box.isEmpty()) {
        const bounds = normalizePdfPlotBounds({
          minX: box.min.x,
          minY: box.min.y,
          maxX: box.max.x,
          maxY: box.max.y
        })
        if (bounds) {
          return bounds
        }
      }
    }

    return this.resolveCurrentViewBounds(context)
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

    // Apply colours while the paper-background rect is still a direct child of
    // the root SVG, making it unambiguous which white fill must stay white.
    this.applyPlotStyle(svgEl, settings.plotStyle)

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
    const paperScale = Math.min(
      availableWidth / viewBox.width,
      availableHeight / viewBox.height
    )
    const drawWidth = viewBox.width * paperScale
    const drawHeight = viewBox.height * paperScale
    const x = settings.centerPlot
      ? (pageWidth - drawWidth) / 2
      : settings.marginMm
    const y = settings.centerPlot
      ? (pageHeight - drawHeight) / 2
      : settings.marginMm

    // Convert physical CAD lineweights (mm on paper) into SVG user units only
    // after final paperScale is known. This separates model geometry size from
    // plotted stroke thickness.
    this.applyPhysicalLineweights(svgEl, paperScale)

    await svg2pdf(svgEl, pdf, {
      x,
      y,
      width: drawWidth,
      height: drawHeight
    })

    const blob = pdf.output('blob')
    await saveExportBlob(blob, downloadName, 'pdf')
  }

  private readViewBox(svgEl: SVGSVGElement): SvgViewBox {
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
   * Applies monochrome/grayscale plotting without destroying paper-coloured
   * wipeouts/background masks. Color mode leaves CAD colours untouched.
   */
  private applyPlotStyle(svgEl: SVGSVGElement, plotStyle: AcApPdfPlotStyle) {
    if (plotStyle === 'color') {
      return
    }

    const paperBackground = Array.from(svgEl.children).find(
      child => child.tagName.toLowerCase() === 'rect'
    )
    const attributes = ['stroke', 'fill', 'stop-color'] as const
    const elements = svgEl.querySelectorAll<SVGElement>('*')

    for (const element of Array.from(elements)) {
      for (const attribute of attributes) {
        const value = element.getAttribute(attribute)
        if (!value || this.isNonColorPaint(value)) {
          continue
        }

        const preservePaperColor =
          element === paperBackground ||
          element.getAttribute('data-cad-background-fill') === 'true'
        if (preservePaperColor && attribute === 'fill') {
          element.setAttribute(attribute, '#ffffff')
          continue
        }

        if (plotStyle === 'monochrome') {
          element.setAttribute(attribute, '#000000')
          continue
        }

        const rgb = this.parseColor(value)
        if (rgb) {
          const gray = Math.round(
            0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b
          )
          const hex = gray.toString(16).padStart(2, '0')
          element.setAttribute(attribute, `#${hex}${hex}${hex}`)
        }
      }
    }
  }

  private isNonColorPaint(value: string): boolean {
    const normalized = value.trim().toLowerCase()
    return (
      normalized === 'none' ||
      normalized === 'transparent' ||
      normalized.startsWith('url(')
    )
  }

  private parseColor(value: string): RgbColor | undefined {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'black') {
      return { r: 0, g: 0, b: 0 }
    }
    if (normalized === 'white') {
      return { r: 255, g: 255, b: 255 }
    }

    const shortHex = /^#([0-9a-f]{3})$/i.exec(normalized)
    if (shortHex) {
      const [r, g, b] = shortHex[1].split('').map(char =>
        parseInt(`${char}${char}`, 16)
      )
      return { r, g, b }
    }

    const hex = /^#([0-9a-f]{6})$/i.exec(normalized)
    if (hex) {
      return {
        r: parseInt(hex[1].slice(0, 2), 16),
        g: parseInt(hex[1].slice(2, 4), 16),
        b: parseInt(hex[1].slice(4, 6), 16)
      }
    }

    const rgb = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i.exec(
      normalized
    )
    if (rgb) {
      return {
        r: Math.min(255, Math.max(0, Number(rgb[1]))),
        g: Math.min(255, Math.max(0, Number(rgb[2]))),
        b: Math.min(255, Math.max(0, Number(rgb[3])))
      }
    }

    return undefined
  }

  /**
   * Rewrites all stroked SVG primitives so their final PDF width matches the
   * physical CAD lineweight in millimetres. Nested INSERT/block transforms are
   * compensated so scaling a block does not scale its plotted lineweight.
   */
  private applyPhysicalLineweights(svgEl: SVGSVGElement, paperScale: number) {
    if (!Number.isFinite(paperScale) || paperScale <= 0) {
      throw new Error(
        'PDF export failed because the calculated paper scale is invalid.'
      )
    }

    const elements = svgEl.querySelectorAll<SVGElement>('[stroke]')
    for (const element of Array.from(elements)) {
      const stroke = element.getAttribute('stroke')?.trim().toLowerCase()
      if (!stroke || stroke === 'none' || stroke === 'transparent') {
        continue
      }

      const rawLineweight = Number(
        element.getAttribute('data-cad-lineweight-mm') ??
          DEFAULT_PLOT_LINEWEIGHT_MM
      )
      const lineweightMm =
        Number.isFinite(rawLineweight) && rawLineweight > 0
          ? rawLineweight
          : DEFAULT_PLOT_LINEWEIGHT_MM
      const transformScale = this.cumulativeTransformScale(element, svgEl)
      const svgWidth = lineweightMm / (paperScale * transformScale)

      element.setAttribute('stroke-width', String(svgWidth))
      element.removeAttribute('vector-effect')
      element.removeAttribute('data-cad-lineweight-mm')
    }
  }

  /** Geometric-mean scale from nested SVG transforms; exact for uniform scales. */
  private cumulativeTransformScale(element: Element, root: Element): number {
    let scale = 1
    let current: Element | null = element

    while (current && current !== root) {
      scale *= this.transformScale(current.getAttribute('transform'))
      current = current.parentElement
    }

    return Math.max(MIN_TRANSFORM_SCALE, scale)
  }

  private transformScale(transform: string | null): number {
    if (!transform) {
      return 1
    }

    let scale = 1
    const regex = /(matrix|scale)\s*\(([^)]*)\)/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(transform)) != null) {
      const values = match[2]
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
      if (!values.every(Number.isFinite)) {
        continue
      }

      if (match[1].toLowerCase() === 'matrix' && values.length >= 4) {
        const determinant = values[0] * values[3] - values[1] * values[2]
        scale *= Math.sqrt(Math.abs(determinant))
      } else if (match[1].toLowerCase() === 'scale' && values.length >= 1) {
        const sx = values[0]
        const sy = values.length >= 2 ? values[1] : sx
        scale *= Math.sqrt(Math.abs(sx * sy))
      }
    }

    return Number.isFinite(scale) && scale > 0 ? scale : 1
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

    // Keep the paper background exactly on the requested plot window rather
    // than retaining the original global-extents rectangle.
    const paperBackground = Array.from(svgEl.children).find(
      child => child.tagName.toLowerCase() === 'rect'
    )
    if (paperBackground) {
      paperBackground.setAttribute('x', String(svgX))
      paperBackground.setAttribute('y', String(svgY))
      paperBackground.setAttribute('width', String(width))
      paperBackground.setAttribute('height', String(height))
    }

    // Explicit clipping remains as a final guard. Source-entity filtering above
    // means correctness no longer depends on svg2pdf honoring this clip path.
    const namespace = 'http://www.w3.org/2000/svg'
    const originalChildren = Array.from(svgEl.childNodes)
    const defs = svgEl.ownerDocument.createElementNS(namespace, 'defs')
    const clipPath = svgEl.ownerDocument.createElementNS(namespace, 'clipPath')
    const clipId = 'mlightcad-pdf-plot-clip'
    clipPath.setAttribute('id', clipId)
    clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse')

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
