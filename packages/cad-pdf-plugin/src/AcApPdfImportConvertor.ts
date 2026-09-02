import type { AcApContext } from '@mlightcad/cad-simple-viewer'
import {
  AcDbLine,
  AcDbPolyline,
  AcGePoint2d,
  AcGePoint3d,
  log
} from '@mlightcad/data-model'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFOperatorList } from 'pdfjs-dist/types/src/display/api'

pdfjsLib.GlobalWorkerOptions.workerSrc = ''

/** 1 PDF point in mm (1 pt = 1/72 inch = 25.4/72 mm) */
const PT_TO_MM = 25.4 / 72

/** Bezier approximation resolution (line segments per curve) */
const BEZIER_STEPS = 8

/** 2D point in PDF user space before conversion to model-space mm. */
type Point2 = { x: number; y: number }

/** Converts a PDF file into CAD entities appended to model space. */
export class AcApPdfImportConvertor {
  /**
   * Prompts the user to pick a PDF and resolves only after import completes.
   * Returns `undefined` when the picker is cancelled.
   */
  importFromFilePicker(context: AcApContext): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.pdf,application/pdf'
      input.style.display = 'none'
      document.body.appendChild(input)

      let settled = false
      const finish = (value?: number, error?: unknown) => {
        if (settled) return
        settled = true
        input.removeEventListener('change', onChange)
        input.removeEventListener('cancel', onCancel)
        input.remove()
        if (error !== undefined) reject(error)
        else resolve(value)
      }

      const onCancel = () => finish(undefined)
      const onChange = async () => {
        const file = input.files?.[0]
        if (!file) {
          finish(undefined)
          return
        }
        try {
          const buffer = await file.arrayBuffer()
          finish(await this.convert(context, buffer))
        } catch (error) {
          finish(undefined, error)
        }
      }

      input.addEventListener('change', onChange)
      input.addEventListener('cancel', onCancel)
      input.click()
    })
  }

  /**
   * Converts one PDF page into CAD entities.
   * @returns Number of imported entities.
   */
  async convert(context: AcApContext, data: ArrayBuffer, pageNumber = 1) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new Error(`Invalid PDF page number: ${pageNumber}`)
    }

    const pdf = await pdfjsLib.getDocument({ data }).promise
    try {
      if (pageNumber > pdf.numPages) {
        throw new Error(
          `PDF page ${pageNumber} does not exist (document has ${pdf.numPages} pages)`
        )
      }

      const page = await pdf.getPage(pageNumber)
      try {
        const viewport = page.getViewport({ scale: 1 })
        const operatorList = await page.getOperatorList()
        const entities = this.extractEntities(operatorList, viewport.height)

        if (entities.length === 0) {
          log.warn('[PdfImport] No vector paths found in PDF page.')
          return 0
        }

        const modelSpace = context.doc.database.tables.blockTable.modelSpace
        for (const entity of entities) {
          modelSpace.appendEntity(entity)
        }

        const dirtyView = context.view as { isDirty?: boolean }
        if ('isDirty' in dirtyView) dirtyView.isDirty = true

        log.info(`[PdfImport] Imported ${entities.length} entities from PDF.`)
        return entities.length
      } finally {
        page.cleanup()
      }
    } catch (error) {
      log.error('[PdfImport] Failed to import PDF:', error)
      throw error
    } finally {
      await pdf.destroy()
    }
  }

  private extractEntities(
    opList: PDFOperatorList,
    pageHeight: number
  ): (AcDbPolyline | AcDbLine)[] {
    const { OPS } = pdfjsLib
    const { fnArray, argsArray } = opList
    const result: (AcDbPolyline | AcDbLine)[] = []

    let subpaths: Point2[][] = []
    let current: Point2[] = []
    let curX = 0
    let curY = 0

    const flush = () => {
      if (current.length > 1) subpaths.push(current)
      current = []
    }

    const commit = () => {
      flush()
      for (const sp of subpaths) {
        const entity = this.subpathToEntity(sp)
        if (entity) result.push(entity)
      }
      subpaths = []
    }

    const tx = (x: number, _y: number) => x * PT_TO_MM
    const ty = (_x: number, y: number) => (pageHeight - y) * PT_TO_MM

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i]
      const args = argsArray[i] as number[]

      switch (fn) {
        case OPS.moveTo: {
          flush()
          curX = args[0]
          curY = args[1]
          current = [{ x: tx(curX, curY), y: ty(curX, curY) }]
          break
        }
        case OPS.lineTo: {
          curX = args[0]
          curY = args[1]
          current.push({ x: tx(curX, curY), y: ty(curX, curY) })
          break
        }
        case OPS.curveTo: {
          const [x1, y1, x2, y2, x3, y3] = args
          const pts = cubicBezier(
            { x: curX, y: curY },
            { x: x1, y: y1 },
            { x: x2, y: y2 },
            { x: x3, y: y3 },
            BEZIER_STEPS
          )
          for (const p of pts) {
            current.push({ x: tx(p.x, p.y), y: ty(p.x, p.y) })
          }
          curX = x3
          curY = y3
          break
        }
        case OPS.curveTo2: {
          const [x2, y2, x3, y3] = args
          const pts = cubicBezier(
            { x: curX, y: curY },
            { x: curX, y: curY },
            { x: x2, y: y2 },
            { x: x3, y: y3 },
            BEZIER_STEPS
          )
          for (const p of pts) {
            current.push({ x: tx(p.x, p.y), y: ty(p.x, p.y) })
          }
          curX = x3
          curY = y3
          break
        }
        case OPS.curveTo3: {
          const [x1, y1, x3, y3] = args
          const pts = cubicBezier(
            { x: curX, y: curY },
            { x: x1, y: y1 },
            { x: x3, y: y3 },
            { x: x3, y: y3 },
            BEZIER_STEPS
          )
          for (const p of pts) {
            current.push({ x: tx(p.x, p.y), y: ty(p.x, p.y) })
          }
          curX = x3
          curY = y3
          break
        }
        case OPS.closePath: {
          if (current.length > 0) {
            current.push({ ...current[0] })
          }
          flush()
          break
        }
        case OPS.stroke:
        case OPS.fill:
        case OPS.eoFill:
        case OPS.fillStroke:
        case OPS.eoFillStroke:
        case OPS.endPath: {
          commit()
          break
        }
      }
    }

    commit()
    return result
  }

  private subpathToEntity(pts: Point2[]): AcDbPolyline | AcDbLine | null {
    if (pts.length < 2) return null

    if (pts.length === 2) {
      return new AcDbLine(
        new AcGePoint3d(pts[0].x, pts[0].y, 0),
        new AcGePoint3d(pts[1].x, pts[1].y, 0)
      )
    }

    const poly = new AcDbPolyline()
    for (let i = 0; i < pts.length; i++) {
      poly.addVertexAt(i, new AcGePoint2d(pts[i].x, pts[i].y))
    }

    const first = pts[0]
    const last = pts[pts.length - 1]
    const dx = first.x - last.x
    const dy = first.y - last.y
    if (Math.sqrt(dx * dx + dy * dy) < 1e-6) {
      poly.closed = true
    }

    return poly
  }
}

/** Approximates a cubic Bézier curve as a polyline. */
function cubicBezier(
  p0: Point2,
  p1: Point2,
  p2: Point2,
  p3: Point2,
  steps: number
): Point2[] {
  const pts: Point2[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    const x =
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x
    const y =
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y
    pts.push({ x, y })
  }
  return pts
}
