import {
  AcGeBox2d,
  AcGiMTextData,
  AcGiSubEntityTraits,
  AcGiTextStyle
} from '@mlightcad/data-model'
import {
  ColorSettings,
  MainThreadRenderer,
  MTextColor,
  MTextData,
  TextStyle
} from '@mlightcad/mtext-renderer'

import { AcSvgEntity } from './AcSvgEntity'
import { AcSvgMText } from './AcSvgMText'
import { AcSvgStyleContext, AcSvgStyleUtil } from './AcSvgStyleUtil'

/** Thin SHX text strokes should plot as normal annotation lines on paper. */
const CAD_TEXT_STROKE_MM = 0.13

/**
 * Dedicated main-thread glyph renderer used only by SVG/PDF export.
 * It shares FontManager.instance with the live CAD viewer, so already-loaded
 * SHX/TTF fonts and legacy encodings are reused instead of relying on PDF fonts.
 */
const vectorTextRenderer = new MainThreadRenderer()

interface PositionAttributeLike {
  count: number
  getX(index: number): number
  getY(index: number): number
  getZ(index: number): number
}

interface IndexAttributeLike {
  count: number
  getX(index: number): number
}

interface GeometryLike {
  getAttribute(name: string): unknown
  index?: IndexAttributeLike | null
}

interface MatrixLike {
  elements: ArrayLike<number>
}

interface ColorLike {
  getHex(): number
}

interface MaterialLike {
  color?: ColorLike
  opacity?: number
}

interface DrawableLike {
  type?: string
  geometry?: GeometryLike
  material?: MaterialLike | MaterialLike[]
  matrixWorld?: MatrixLike
  traverse(callback: (object: DrawableLike) => void): void
  updateMatrixWorld(force?: boolean): void
}

interface Point2d {
  x: number
  y: number
}

/**
 * Vectorized MTEXT/TEXT export using the same font engine as the Three.js viewer.
 *
 * This is deliberately geometry-based. It avoids SVG/PDF font substitution,
 * preserves legacy SHX glyph encodings (including Greek SHX drawings), and keeps
 * the resulting PDF fully vector without embedding proprietary font files.
 */
export class AcSvgMTextVector extends AcSvgEntity {
  /**
   * Returns the entity immediately plus an async population task. Returning the
   * real entity immediately is important: block/group worldDraw code can apply
   * its transforms before the glyph geometry finishes loading.
   */
  static begin(
    mtext: AcGiMTextData,
    style: AcGiTextStyle,
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext
  ): { entity: AcSvgMTextVector; pending: Promise<void> } {
    const entity = new AcSvgMTextVector()
    const pending = entity.build(mtext, style, traits, ctx).catch(() => {
      // Never make an otherwise valid export fail solely because a font is
      // unavailable. The legacy SVG text path remains a last-resort fallback.
      const fallback = new AcSvgMText(mtext, style, traits, ctx)
      entity._localSvg = fallback.getLocalSvg()
      entity._box.copy(fallback.box)
    })
    return { entity, pending }
  }

  private async build(
    mtext: AcGiMTextData,
    style: AcGiTextStyle,
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext
  ) {
    const rendered = await vectorTextRenderer.asyncRenderMText(
      mtext as unknown as MTextData,
      style as unknown as TextStyle,
      this.buildColorSettings(traits, ctx)
    )
    const root = rendered as unknown as DrawableLike
    root.updateMatrixWorld(true)

    const fallbackColor = AcSvgStyleUtil.resolveRgb(traits, ctx, 'text')
    const fragments: string[] = []
    const box = new AcGeBox2d()

    root.traverse(object => {
      const geometry = object.geometry
      const matrix = object.matrixWorld
      if (!geometry || !matrix) {
        return
      }

      const position = geometry.getAttribute('position') as
        | PositionAttributeLike
        | undefined
      if (!position || position.count === 0) {
        return
      }

      const type = object.type ?? ''
      const material = this.firstMaterial(object.material)
      const rgb = material?.color?.getHex() ?? fallbackColor
      const color = AcSvgStyleUtil.rgbToHex(rgb)
      const opacity = this.materialOpacity(material)

      if (type === 'Mesh') {
        const path = this.meshPath(position, geometry.index, matrix, box)
        if (path) {
          const attrs: Record<string, string> = {
            d: path,
            fill: color,
            stroke: 'none',
            'fill-rule': 'nonzero'
          }
          if (opacity < 1) {
            attrs['fill-opacity'] = String(opacity)
          }
          fragments.push(AcSvgStyleUtil.tag('path', attrs))
        }
        return
      }

      if (type === 'Line' || type === 'LineLoop' || type === 'LineSegments') {
        const path = this.linePath(
          position,
          geometry.index,
          matrix,
          box,
          type
        )
        if (path) {
          const attrs: Record<string, string> = {
            d: path,
            fill: 'none',
            stroke: color,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'data-cad-lineweight-mm': String(CAD_TEXT_STROKE_MM)
          }
          if (opacity < 1) {
            attrs['stroke-opacity'] = String(opacity)
          }
          fragments.push(AcSvgStyleUtil.tag('path', attrs))
        }
      }
    })

    if (fragments.length === 0 || box.isEmpty()) {
      throw new Error('Vector text renderer produced no drawable glyph geometry')
    }

    this._localSvg = fragments.join('\n')
    this._box = box
  }

  private buildColorSettings(
    traits: AcGiSubEntityTraits,
    ctx: AcSvgStyleContext
  ): ColorSettings {
    const resolvedRgb = AcSvgStyleUtil.resolveRgb(traits, ctx, 'text')
    return {
      layer: traits.layer,
      color: this.toMTextColor(traits),
      byLayerColor: resolvedRgb,
      byBlockColor: resolvedRgb
    }
  }

  private toMTextColor(traits: AcGiSubEntityTraits): MTextColor {
    const source = traits.color
    const color = new MTextColor()

    if (source.isByLayer) {
      color.aci = 256
      return color
    }
    if (source.isByBlock) {
      color.aci = 0
      return color
    }
    if (source.isForeground) {
      color.aci = 7
      return color
    }
    if (source.isByACI && typeof source.colorIndex === 'number') {
      color.aci = source.colorIndex
      return color
    }
    if (typeof source.RGB === 'number') {
      color.rgbValue = source.RGB
    }
    return color
  }

  private firstMaterial(
    material: MaterialLike | MaterialLike[] | undefined
  ): MaterialLike | undefined {
    return Array.isArray(material) ? material[0] : material
  }

  private materialOpacity(material: MaterialLike | undefined): number {
    const value = material?.opacity
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 1
    }
    return Math.min(1, Math.max(0, value))
  }

  private meshPath(
    position: PositionAttributeLike,
    index: IndexAttributeLike | null | undefined,
    matrix: MatrixLike,
    box: AcGeBox2d
  ): string {
    const vertexIndices = this.indices(index, position.count)
    const parts: string[] = []

    for (let i = 0; i + 2 < vertexIndices.length; i += 3) {
      const p0 = this.worldPoint(position, vertexIndices[i], matrix)
      const p1 = this.worldPoint(position, vertexIndices[i + 1], matrix)
      const p2 = this.worldPoint(position, vertexIndices[i + 2], matrix)
      this.expand(box, p0, p1, p2)
      parts.push(`M${p0.x},${p0.y}L${p1.x},${p1.y}L${p2.x},${p2.y}Z`)
    }

    return parts.join('')
  }

  private linePath(
    position: PositionAttributeLike,
    index: IndexAttributeLike | null | undefined,
    matrix: MatrixLike,
    box: AcGeBox2d,
    type: string
  ): string {
    const vertexIndices = this.indices(index, position.count)
    const parts: string[] = []

    if (type === 'LineSegments') {
      for (let i = 0; i + 1 < vertexIndices.length; i += 2) {
        const p0 = this.worldPoint(position, vertexIndices[i], matrix)
        const p1 = this.worldPoint(position, vertexIndices[i + 1], matrix)
        this.expand(box, p0, p1)
        parts.push(`M${p0.x},${p0.y}L${p1.x},${p1.y}`)
      }
      return parts.join('')
    }

    if (vertexIndices.length < 2) {
      return ''
    }
    const first = this.worldPoint(position, vertexIndices[0], matrix)
    this.expand(box, first)
    parts.push(`M${first.x},${first.y}`)
    for (let i = 1; i < vertexIndices.length; i++) {
      const point = this.worldPoint(position, vertexIndices[i], matrix)
      this.expand(box, point)
      parts.push(`L${point.x},${point.y}`)
    }
    if (type === 'LineLoop') {
      parts.push('Z')
    }
    return parts.join('')
  }

  private indices(
    index: IndexAttributeLike | null | undefined,
    vertexCount: number
  ): number[] {
    if (index) {
      const values: number[] = []
      for (let i = 0; i < index.count; i++) {
        values.push(index.getX(i))
      }
      return values
    }
    return Array.from({ length: vertexCount }, (_, i) => i)
  }

  private worldPoint(
    position: PositionAttributeLike,
    index: number,
    matrix: MatrixLike
  ): Point2d {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const e = matrix.elements
    const w = e[3] * x + e[7] * y + e[11] * z + e[15]
    const invW = w !== 0 ? 1 / w : 1
    return {
      x: (e[0] * x + e[4] * y + e[8] * z + e[12]) * invW,
      y: (e[1] * x + e[5] * y + e[9] * z + e[13]) * invW
    }
  }

  private expand(box: AcGeBox2d, ...points: Point2d[]) {
    for (const point of points) {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        box.expandByPoint(point)
      }
    }
  }
}
