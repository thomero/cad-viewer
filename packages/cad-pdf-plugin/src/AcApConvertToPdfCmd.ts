import {
  AcApContext,
  AcEdCommand,
  AcEdPromptBoxOptions,
  AcEdPromptStatus
} from '@mlightcad/cad-simple-viewer'

import { AcApPdfConvertor } from './AcApPdfConvertor'
import { AcApPdfPlotDialog } from './AcApPdfPlotDialog'

/**
 * Command for plotting the current CAD drawing to PDF.
 * The command name is `cpdf`.
 */
export class AcApConvertToPdfCmd extends AcEdCommand {
  /**
   * Opens plot settings, acquires an optional Window plot area, then exports.
   *
   * @param context - Application context for the active document
   */
  async execute(context: AcApContext) {
    const settings = await AcApPdfPlotDialog.show({
      hasSelection: context.view.selectionSet.ids.length > 0
    })
    if (!settings) {
      return
    }

    if (settings.plotArea === 'window') {
      const options = new AcEdPromptBoxOptions(
        'Specify first plot corner:',
        'Specify opposite plot corner:'
      )
      // A plot window is a visual crop, not a geometry-edit operation. Avoid
      // object snaps unexpectedly moving either requested corner.
      options.disableOSnap = true
      options.useDashedLine = true

      const result = await context.view.editor.getBox(options)
      if (result.status !== AcEdPromptStatus.OK || !result.value) {
        return
      }

      settings.windowBounds = {
        minX: result.value.min.x,
        minY: result.value.min.y,
        maxX: result.value.max.x,
        maxY: result.value.max.y
      }
    }

    if (
      settings.plotArea === 'selection' &&
      context.view.selectionSet.ids.length === 0
    ) {
      context.view.editor.showMessage(
        'PDF export requires at least one selected entity when Plot area is Selection.',
        'warning'
      )
      return
    }

    const converter = new AcApPdfConvertor()
    await converter.convert(context, settings)
  }
}
