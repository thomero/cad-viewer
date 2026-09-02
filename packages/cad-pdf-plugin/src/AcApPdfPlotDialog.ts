import {
  AcApPdfOrientation,
  AcApPdfPaperSize,
  AcApPdfPlotArea,
  AcApPdfPlotSettings,
  AcApPdfPlotStyle,
  DEFAULT_PDF_PLOT_SETTINGS
} from './AcApPdfPlotSettings'

const STORAGE_KEY = 'mlightcad.pdfPlotSettings.v2'

interface AcApPdfPlotDialogOptions {
  hasSelection: boolean
}

type StoredPlotSettings = Omit<AcApPdfPlotSettings, 'windowBounds'>

/**
 * Lightweight modal for PDF plot configuration.
 *
 * Kept inside the PDF plugin so the exporter works in the browser, desktop
 * shell, and embedded viewer without taking a dependency on an application UI
 * framework.
 */
export class AcApPdfPlotDialog {
  static async show(
    options: AcApPdfPlotDialogOptions
  ): Promise<AcApPdfPlotSettings | null> {
    const initial = this.loadSettings(options.hasSelection)
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', 'Plot to PDF')
    dialog.style.cssText = [
      'border:0',
      'border-radius:12px',
      'padding:0',
      'width:min(520px,calc(100vw - 32px))',
      'max-width:520px',
      'box-shadow:0 18px 60px rgba(0,0,0,.28)',
      'background:var(--ml-ui-surface,#fff)',
      'color:var(--ml-ui-text,#1f2937)',
      'font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';')

    dialog.innerHTML = `
      <form method="dialog" style="margin:0">
        <div style="padding:20px 22px 14px;border-bottom:1px solid var(--ml-ui-border,#e5e7eb)">
          <div style="font-size:18px;font-weight:650">Plot to PDF</div>
          <div style="margin-top:4px;color:var(--ml-ui-text-muted,#6b7280);font-size:12px">
            Choose the plot area, paper and CAD plot style. Lineweights are plotted in physical paper units.
          </div>
        </div>

        <div style="padding:18px 22px;display:grid;grid-template-columns:150px 1fr;gap:14px 16px;align-items:center">
          <label for="ml-pdf-plot-area" style="font-weight:600">Plot area</label>
          <select id="ml-pdf-plot-area" style="${this.controlStyle()}">
            <option value="currentView">Current View</option>
            <option value="window">Window</option>
            <option value="selection" ${options.hasSelection ? '' : 'disabled'}>Selection${options.hasSelection ? '' : ' (nothing selected)'}</option>
            <option value="extents">Drawing Extents</option>
          </select>

          <label for="ml-pdf-paper" style="font-weight:600">Paper</label>
          <select id="ml-pdf-paper" style="${this.controlStyle()}">
            <option value="a4">A4</option>
            <option value="a3">A3</option>
            <option value="a2">A2</option>
            <option value="a1">A1</option>
            <option value="a0">A0</option>
          </select>

          <label for="ml-pdf-orientation" style="font-weight:600">Orientation</label>
          <select id="ml-pdf-orientation" style="${this.controlStyle()}">
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
            <option value="auto">Auto</option>
          </select>

          <label for="ml-pdf-plot-style" style="font-weight:600">Plot style</label>
          <select id="ml-pdf-plot-style" style="${this.controlStyle()}">
            <option value="monochrome">Monochrome</option>
            <option value="grayscale">Grayscale</option>
            <option value="color">Color</option>
          </select>

          <label for="ml-pdf-scale" style="font-weight:600">Scale</label>
          <select id="ml-pdf-scale" disabled style="${this.controlStyle()};opacity:.75">
            <option value="fit">Fit to paper</option>
          </select>

          <label for="ml-pdf-margin" style="font-weight:600">Margins</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input id="ml-pdf-margin" type="number" min="0" max="50" step="1" style="${this.controlStyle()};width:92px" />
            <span style="color:var(--ml-ui-text-muted,#6b7280)">mm</span>
          </div>

          <label for="ml-pdf-center" style="font-weight:600">Position</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input id="ml-pdf-center" type="checkbox" />
            <span>Center plot on paper</span>
          </label>
        </div>

        <div style="padding:14px 22px 18px;border-top:1px solid var(--ml-ui-border,#e5e7eb);display:flex;justify-content:flex-end;gap:10px">
          <button type="button" data-action="cancel" style="${this.buttonStyle(false)}">Cancel</button>
          <button type="button" data-action="export" style="${this.buttonStyle(true)}">Export PDF</button>
        </div>
      </form>
    `

    document.body.appendChild(dialog)

    const plotArea = dialog.querySelector<HTMLSelectElement>('#ml-pdf-plot-area')!
    const paper = dialog.querySelector<HTMLSelectElement>('#ml-pdf-paper')!
    const orientation = dialog.querySelector<HTMLSelectElement>(
      '#ml-pdf-orientation'
    )!
    const plotStyle = dialog.querySelector<HTMLSelectElement>(
      '#ml-pdf-plot-style'
    )!
    const margin = dialog.querySelector<HTMLInputElement>('#ml-pdf-margin')!
    const center = dialog.querySelector<HTMLInputElement>('#ml-pdf-center')!
    const cancel = dialog.querySelector<HTMLButtonElement>('[data-action="cancel"]')!
    const exportButton = dialog.querySelector<HTMLButtonElement>(
      '[data-action="export"]'
    )!

    plotArea.value = initial.plotArea
    paper.value = initial.paperSize
    orientation.value = initial.orientation
    plotStyle.value = initial.plotStyle
    margin.value = String(initial.marginMm)
    center.checked = initial.centerPlot

    let result: AcApPdfPlotSettings | null = null

    cancel.addEventListener('click', () => dialog.close('cancel'))
    exportButton.addEventListener('click', () => {
      const marginValue = Number(margin.value)
      const safeMargin = Number.isFinite(marginValue)
        ? Math.min(50, Math.max(0, marginValue))
        : DEFAULT_PDF_PLOT_SETTINGS.marginMm

      result = {
        plotArea: plotArea.value as AcApPdfPlotArea,
        paperSize: paper.value as AcApPdfPaperSize,
        orientation: orientation.value as AcApPdfOrientation,
        plotStyle: plotStyle.value as AcApPdfPlotStyle,
        scaleMode: 'fit',
        centerPlot: center.checked,
        marginMm: safeMargin
      }
      this.saveSettings(result)
      dialog.close('export')
    })

    try {
      dialog.showModal()
      await new Promise<void>(resolve => {
        dialog.addEventListener('close', () => resolve(), { once: true })
      })
      return result
    } finally {
      dialog.remove()
    }
  }

  private static loadSettings(hasSelection: boolean): StoredPlotSettings {
    let settings: StoredPlotSettings = { ...DEFAULT_PDF_PLOT_SETTINGS }

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredPlotSettings>
        settings = {
          plotArea: this.isPlotArea(parsed.plotArea)
            ? parsed.plotArea
            : settings.plotArea,
          paperSize: this.isPaperSize(parsed.paperSize)
            ? parsed.paperSize
            : settings.paperSize,
          orientation: this.isOrientation(parsed.orientation)
            ? parsed.orientation
            : settings.orientation,
          plotStyle: this.isPlotStyle(parsed.plotStyle)
            ? parsed.plotStyle
            : settings.plotStyle,
          scaleMode: 'fit',
          centerPlot:
            typeof parsed.centerPlot === 'boolean'
              ? parsed.centerPlot
              : settings.centerPlot,
          marginMm:
            typeof parsed.marginMm === 'number' && Number.isFinite(parsed.marginMm)
              ? Math.min(50, Math.max(0, parsed.marginMm))
              : settings.marginMm
        }
      }
    } catch {
      // Storage can be disabled by an embedding host. Defaults remain valid.
    }

    if (settings.plotArea === 'selection' && !hasSelection) {
      settings.plotArea = 'currentView'
    }

    return settings
  }

  private static saveSettings(settings: AcApPdfPlotSettings) {
    try {
      const stored: StoredPlotSettings = {
        plotArea: settings.plotArea,
        paperSize: settings.paperSize,
        orientation: settings.orientation,
        plotStyle: settings.plotStyle,
        scaleMode: 'fit',
        centerPlot: settings.centerPlot,
        marginMm: settings.marginMm
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // Persistence is optional; exporting must still work without localStorage.
    }
  }

  private static isPlotArea(value: unknown): value is AcApPdfPlotArea {
    return ['currentView', 'window', 'selection', 'extents'].includes(String(value))
  }

  private static isPaperSize(value: unknown): value is AcApPdfPaperSize {
    return ['a4', 'a3', 'a2', 'a1', 'a0'].includes(String(value))
  }

  private static isOrientation(value: unknown): value is AcApPdfOrientation {
    return ['landscape', 'portrait', 'auto'].includes(String(value))
  }

  private static isPlotStyle(value: unknown): value is AcApPdfPlotStyle {
    return ['monochrome', 'grayscale', 'color'].includes(String(value))
  }

  private static controlStyle() {
    return [
      'box-sizing:border-box',
      'min-height:36px',
      'width:100%',
      'padding:7px 10px',
      'border:1px solid var(--ml-ui-border,#d1d5db)',
      'border-radius:7px',
      'background:var(--ml-ui-control-bg,#fff)',
      'color:inherit',
      'font:inherit'
    ].join(';')
  }

  private static buttonStyle(primary: boolean) {
    return [
      'min-height:36px',
      'padding:7px 14px',
      'border-radius:7px',
      'font:600 14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'cursor:pointer',
      primary
        ? 'border:1px solid var(--ml-ui-accent,#2563eb);background:var(--ml-ui-accent,#2563eb);color:#fff'
        : 'border:1px solid var(--ml-ui-border,#d1d5db);background:var(--ml-ui-control-bg,#fff);color:inherit'
    ].join(';')
  }
}
