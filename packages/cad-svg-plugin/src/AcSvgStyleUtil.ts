import {
  AcGiContext,
  AcGiLineTypePatternElement,
  AcGiLineWeight,
  AcGiSubEntityTraits
} from '@mlightcad/data-model'

/** Default plotted lineweight when CAD traits resolve to ByLayer/ByBlock/Default. */
export const DEFAULT_CAD_PLOT_LINEWEIGHT_MM = 0.18

/** Runtime style options passed from {@link AcSvgRenderer}. */
export interface AcSvgStyleContext {
  ltscale: number
  celtscale: number
  /** Canvas / export background (24-bit RGB). Used for ACI 7 solid hatches. */
  backgroundColor: number
  /** Resolved foreground colour for ACI 7 linework (24-bit RGB). */
  foregroundColor: number
  /** Mirrors LWDISPLAY for normal SVG viewing. PDF plotting overrides widths later. */
  showLineWeight: boolean
}

export type AcSvgPrimitiveKind = 'line' | 'fill' | 'text' | 'point'

/**
 * Converts entity traits and export context into SVG presentation attributes.
 */
export class AcSvgStyleUtil {
  static rgbToHex(rgb: number): string {
    const r = (rgb >> 16) & 0xff
    const g = (rgb >> 8) & 0xff
    const b = rgb & 0xff
    return `#${r.toString(16).padStart(2, '0')}${g
      .toString(16)
      .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }

  static resolveRgb(
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext,
    kind: AcSvgPrimitiveKind
  ): number {
    if (
      kind === 'fill' &&
      traits.color.isForeground &&
      this.isSolidBackgroundHatch(traits)
    ) {
      return ctx.backgroundColor
    }
    return AcGiContext.fromBackgroundColor(
      ctx.backgroundColor
    ).resolveSubEntityTraitsRgb(traits)
  }

  /**
   * Returns the physical CAD plot lineweight in millimetres.
   * AutoCAD positive lineweight enum values are hundredths of a millimetre.
   */
  static lineWeightMillimetres(lineWeight: AcGiLineWeight): number {
    if (lineWeight < 0) {
      return DEFAULT_CAD_PLOT_LINEWEIGHT_MM
    }
    return Math.max(0.01, lineWeight / 100)
  }

  static strokeAttributes(
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext
  ): Record<string, string> {
    const color = this.rgbToHex(this.resolveRgb(traits, ctx, 'line'))
    const physicalLineWeight = this.lineWeightMillimetres(traits.lineWeight)
    const attrs: Record<string, string> = {
      stroke: color,
      fill: 'none',
      // Kept as metadata so the PDF plotter can convert physical mm to SVG
      // user units after it knows the final paper scale.
      'data-cad-lineweight-mm': String(physicalLineWeight)
    }

    if (!ctx.showLineWeight) {
      // Normal SVG viewing follows LWDISPLAY. PDF export ignores this visual
      // width and restores the physical value from data-cad-lineweight-mm.
      attrs['stroke-width'] = '1'
      attrs['vector-effect'] = 'non-scaling-stroke'
    } else {
      const width = this.resolveSvgStrokeWidth(traits.lineWeight)
      if (width != null) {
        attrs['stroke-width'] = String(width)
      }
    }

    const opacity = this.resolveOpacity(traits)
    if (opacity != null && opacity < 1) {
      attrs['stroke-opacity'] = String(opacity)
    }

    const dasharray = this.strokeDasharray(traits, ctx)
    if (dasharray) {
      attrs['stroke-dasharray'] = dasharray
    }

    return attrs
  }

  static fillAttributes(
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext
  ): Record<string, string> {
    const isBackgroundFill =
      traits.color.isForeground && this.isSolidBackgroundHatch(traits)
    const color = this.rgbToHex(this.resolveRgb(traits, ctx, 'fill'))
    const attrs: Record<string, string> = {
      fill: color,
      stroke: 'none'
    }
    if (isBackgroundFill) {
      // Wipeout/background hatches must remain paper-coloured even when the
      // user selects a monochrome plot style.
      attrs['data-cad-background-fill'] = 'true'
    }

    const opacity = this.resolveOpacity(traits)
    if (opacity != null && opacity < 1) {
      attrs['fill-opacity'] = String(opacity)
    }

    return attrs
  }

  static textAttributes(
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext
  ): Record<string, string> {
    const color = this.rgbToHex(this.resolveRgb(traits, ctx, 'text'))
    const attrs: Record<string, string> = {
      fill: color,
      stroke: 'none'
    }

    const opacity = this.resolveOpacity(traits)
    if (opacity != null && opacity < 1) {
      attrs['fill-opacity'] = String(opacity)
    }

    return attrs
  }

  static pointAttributes(
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext
  ): Record<string, string> {
    return this.textAttributes(traits, ctx)
  }

  static formatAttributes(attrs: Record<string, string>): string {
    return Object.entries(attrs)
      .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
      .join(' ')
  }

  static tag(
    name: string,
    attrs: Record<string, string>,
    inner?: string
  ): string {
    const attrStr = this.formatAttributes(attrs)
    if (inner == null) {
      return `<${name} ${attrStr}/>`
    }
    return `<${name} ${attrStr}>${inner}</${name}>`
  }

  private static isSolidBackgroundHatch(traits: AcGiSubEntityTraits): boolean {
    if ((traits.drawOrder ?? 0) >= 0) {
      return false
    }
    const style = traits.fillType
    if (style.gradient) {
      return false
    }
    return !style.definitionLines || style.definitionLines.length === 0
  }

  private static resolveSvgStrokeWidth(lineWeight: AcGiLineWeight): number | null {
    if (lineWeight < 0) {
      return null
    }
    // This value is only for standalone SVG display. PDF plotting uses the
    // physical data-cad-lineweight-mm metadata instead.
    return Math.max(0.01, lineWeight / 100)
  }

  private static resolveOpacity(traits: AcGiSubEntityTraits): number | null {
    const alpha = traits.transparency?.alpha
    if (alpha == null || Number.isNaN(alpha)) {
      return null
    }
    return Math.min(1, Math.max(0, alpha))
  }

  private static strokeDasharray(
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext
  ): string | undefined {
    const pattern = traits.lineType.pattern
    if (!pattern || pattern.length === 0) {
      return undefined
    }

    const scale = ctx.ltscale * ctx.celtscale * traits.lineTypeScale
    const segments = this.patternToDashSegments(pattern, scale)
    if (segments.length === 0) {
      return undefined
    }
    return segments.join(' ')
  }

  private static patternToDashSegments(
    pattern: AcGiLineTypePatternElement[],
    scale: number
  ): number[] {
    const segments: number[] = []

    for (const element of pattern) {
      let len = element.elementLength
      if (len < 0 && element.elementTypeFlag !== 0) {
        len = Math.abs(len)
      }
      len *= scale
      if (len === 0) {
        len = 0.5 * scale
      }
      segments.push(Math.abs(len))
    }

    return segments
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}
