export type AcApPdfPlotArea =
  | 'currentView'
  | 'window'
  | 'selection'
  | 'extents'

export type AcApPdfPaperSize = 'a4' | 'a3' | 'a2' | 'a1' | 'a0'

export type AcApPdfOrientation = 'landscape' | 'portrait' | 'auto'

export type AcApPdfScaleMode = 'fit'

/** CAD-style colour treatment applied while plotting to PDF. */
export type AcApPdfPlotStyle = 'monochrome' | 'grayscale' | 'color'

/** Axis-aligned CAD world bounds used as the PDF plot window. */
export interface AcApPdfPlotBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * User-facing PDF plot settings.
 *
 * `windowBounds` is populated only after the user picks a Window plot area.
 */
export interface AcApPdfPlotSettings {
  plotArea: AcApPdfPlotArea
  paperSize: AcApPdfPaperSize
  orientation: AcApPdfOrientation
  scaleMode: AcApPdfScaleMode
  plotStyle: AcApPdfPlotStyle
  centerPlot: boolean
  marginMm: number
  windowBounds?: AcApPdfPlotBounds
}

/** First-run defaults chosen for engineering / architectural drawings. */
export const DEFAULT_PDF_PLOT_SETTINGS: AcApPdfPlotSettings = {
  plotArea: 'currentView',
  paperSize: 'a3',
  orientation: 'landscape',
  scaleMode: 'fit',
  plotStyle: 'monochrome',
  centerPlot: true,
  marginMm: 10
}

const MIN_PLOT_SPAN = 1e-12

/** Returns finite, ordered, non-zero bounds or `undefined` for invalid input. */
export function normalizePdfPlotBounds(
  bounds: AcApPdfPlotBounds
): AcApPdfPlotBounds | undefined {
  const values = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
  if (!values.every(Number.isFinite)) {
    return undefined
  }

  const minX = Math.min(bounds.minX, bounds.maxX)
  const minY = Math.min(bounds.minY, bounds.maxY)
  const maxX = Math.max(bounds.minX, bounds.maxX)
  const maxY = Math.max(bounds.minY, bounds.maxY)

  if (maxX - minX <= MIN_PLOT_SPAN || maxY - minY <= MIN_PLOT_SPAN) {
    return undefined
  }

  return { minX, minY, maxX, maxY }
}
