import { AcGeBox2d } from '@mlightcad/data-model'

import { AcSvgEntity } from './AcSvgEntity'

/**
 * SVG group entity: keeps child entities live until export so asynchronous
 * glyph/image geometry can finish before group markup and bounds are baked.
 */
export class AcSvgGroup extends AcSvgEntity {
  private readonly _children: AcSvgEntity[]

  constructor(entities: AcSvgEntity[]) {
    super()
    this._children = [...entities]
    this.refreshFromChildren()
  }

  /**
   * Number of entities passed to this group at construction.
   *
   * Satisfies {@link AcGiEntity.childCount} for cache heuristics.
   */
  get childCount() {
    return this._children.length
  }

  override renderSvg(): string {
    this.refreshFromChildren()
    return super.renderSvg()
  }

  override recomputeBoundingBox() {
    this.refreshFromChildren()
  }

  private refreshFromChildren() {
    const parts: string[] = []
    const localBox = new AcGeBox2d()

    for (const child of this._children) {
      const svg = child.renderSvg()
      if (!svg) {
        continue
      }
      parts.push(svg)
      localBox.union(child.box)
    }

    this._localSvg = parts.length > 0 ? `<g>\n${parts.join('\n')}\n</g>` : ''
    this.setLocalBox(localBox)
  }
}
