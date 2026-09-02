import { AcApContext } from '../../app'
import { AcEdCommand } from '../../editor'
import { AcApI18n } from '../../i18n'
import { AcApDxfConvertor } from './AcApDxfConvertor'

/**
 * Command for exporting the current CAD drawing to DXF format.
 */
export class AcApConvertToDxfCmd extends AcEdCommand {
  async execute(_context: AcApContext) {
    await this.withBusyIndicator(async () => {
      const converter = new AcApDxfConvertor()
      await converter.convert()
    }, AcApI18n.t('main.message.exportingDxf'))
  }
}
