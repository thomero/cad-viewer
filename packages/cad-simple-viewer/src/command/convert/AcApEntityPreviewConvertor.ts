import { AcDbObjectId, AcGeBox2d, AcGeVector2d } from '@mlightcad/data-model'
import { disposePreviewSubset } from '@mlightcad/three-renderer'

import { AcApDocManager } from '../../app'
import { resolveExportDownloadName } from '../../util/AcApExportFileNameUtil'
import { saveExportBlob } from '../../util/AcApExportSaveUtil'
import { AcTrView2d } from '../../view'

export type AcApEntityPreviewExportFailure =
  | 'no-preview-root'
  | 'no-bounds'
  | 'capture-failed'
  | 'download-failed'
  | 'cancelled'

export type AcApEntityPreviewExportResult =
  | { ok: true; exportedCount: number; skippedCount: number }
  | { ok: false; reason: AcApEntityPreviewExportFailure }

export type AcApEntityPreviewCaptureResult =
  | {
      ok: true
      dataUrl: string
      exportedCount: number
      skippedCount: number
    }
  | { ok: false; reason: AcApEntityPreviewExportFailure | 'no-entities' }

/**
 * Exports one merged preview image for the specified entity ids.
 *
 * Reuses the same batch extraction path as MOVE/COPY/ROTATE jigs, then captures
 * through {@link AcTrRenderer.renderEntityPreview}.
 */
export class AcApEntityPreviewConvertor {
  /**
   * Renders selected entities into one PNG and saves it through the shared
   * browser/desktop export path.
   */
  async export(
    entityIds: AcDbObjectId[],
    longSide: number
  ): Promise<AcApEntityPreviewExportResult> {
    const capture = this.capture(entityIds, longSide)
    if (!capture.ok) {
      if (capture.reason === 'no-entities') {
        return { ok: false, reason: 'no-bounds' }
      }
      if (capture.reason === 'download-failed') {
        return { ok: false, reason: 'capture-failed' }
      }
      return { ok: false, reason: capture.reason }
    }

    try {
      const doc = AcApDocManager.instance.curDocument
      const downloadName = resolveExportDownloadName(
        doc.fileName || doc.docTitle,
        'png',
        'entity-preview'
      )
      const saved = await saveExportBlob(
        this.dataUrlToBlob(capture.dataUrl),
        downloadName,
        'png'
      )
      if (saved == null) {
        return { ok: false, reason: 'cancelled' }
      }
    } catch (error) {
      console.error('[ENTPREVIEW] Failed to save preview PNG', error)
      return { ok: false, reason: 'download-failed' }
    }

    return {
      ok: true,
      exportedCount: capture.exportedCount,
      skippedCount: capture.skippedCount
    }
  }

  /**
   * Renders selected entities into one PNG and returns a data URL.
   *
   * @param entityIds - Database object ids to include in the preview
   * @param longSide - Maximum output width or height in pixels
   */
  capture(
    entityIds: AcDbObjectId[],
    longSide: number
  ): AcApEntityPreviewCaptureResult {
    if (entityIds.length === 0) {
      return { ok: false, reason: 'no-entities' }
    }

    const view = AcApDocManager.instance.curView as AcTrView2d
    const scene = view.cadScene
    const previewableIds = scene.findPreviewableEntityIds(entityIds, 'all')
    const exportedCount = previewableIds.length
    const skippedCount = entityIds.length - exportedCount

    const bounds =
      scene.computeEntityPreviewBounds2d(entityIds, 1.1, 'all') ?? null
    if (!bounds) {
      console.warn('[ENTPREVIEW] Failed to compute preview bounds', entityIds)
      return { ok: false, reason: 'no-bounds' }
    }

    const outputSize = this.resolveOutputSize(
      longSide,
      this.getBoundsAspect(bounds)
    )
    const renderWidth = outputSize.width
    const renderHeight = outputSize.height

    const previewRoot = scene.createEntityPreviewRoot(entityIds, {
      scope: 'all'
    })
    if (!previewRoot) {
      console.warn(
        '[ENTPREVIEW] Failed to build preview geometry',
        `${entityIds.length} requested entity ids`
      )
      return { ok: false, reason: 'no-preview-root' }
    }

    const rendererWrapper = view.renderer

    try {
      const capture = rendererWrapper.renderEntityPreview(previewRoot, {
        width: renderWidth,
        height: renderHeight,
        bounds,
        margin: 1,
        viewportSize: { width: view.width, height: view.height },
        localLineResolutionOnly: true,
        onRestored: () => {
          view.isDirty = true
        }
      })

      if (!capture) {
        return { ok: false, reason: 'capture-failed' }
      }

      return {
        ok: true,
        dataUrl: capture.canvas.toDataURL('image/png'),
        exportedCount,
        skippedCount
      }
    } catch (error) {
      console.error('[ENTPREVIEW] Failed to render preview image', error)
      return { ok: false, reason: 'capture-failed' }
    } finally {
      disposePreviewSubset(previewRoot)
    }
  }

  /** Computes width and height while preserving aspect ratio. */
  private resolveOutputSize(longSide: number, aspect: number) {
    const clampedLongSide = Math.max(1, Math.round(longSide))
    const safeAspect =
      Number.isFinite(aspect) && aspect > Number.EPSILON ? aspect : 1

    if (safeAspect >= 1) {
      return {
        width: clampedLongSide,
        height: Math.max(1, Math.round(clampedLongSide / safeAspect))
      }
    }

    return {
      width: Math.max(1, Math.round(clampedLongSide * safeAspect)),
      height: clampedLongSide
    }
  }

  /** Returns the world-space aspect ratio of one 2D bounds box. */
  private getBoundsAspect(bounds: AcGeBox2d) {
    const size = new AcGeVector2d()
    bounds.getSize(size)
    const width = Math.max(Math.abs(size.x), Number.EPSILON)
    const height = Math.max(Math.abs(size.y), Number.EPSILON)
    return width / height
  }

  /** Converts a PNG data URL emitted by the renderer into a Blob. */
  private dataUrlToBlob(dataUrl: string): Blob {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) {
      throw new Error('Preview renderer returned an invalid image data URL')
    }

    const header = dataUrl.slice(0, comma)
    const encoded = dataUrl.slice(comma + 1)
    const mime = /^data:([^;,]+)/.exec(header)?.[1] || 'image/png'
    const binary = header.includes(';base64')
      ? atob(encoded)
      : decodeURIComponent(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new Blob([bytes], { type: mime })
  }
}
