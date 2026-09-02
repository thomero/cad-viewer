import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const SOURCE_ROOTS = [
  'packages/cad-simple-viewer/src',
  'packages/cad-viewer/src',
  'packages/cad-viewer-example/src',
  'packages/cad-pdf-plugin/src',
  'packages/cad-svg-plugin/src',
  'packages/cad-html-plugin/src'
]

const ALLOWED_BROWSER_DOWNLOAD = new Set([
  // This is the single compatibility boundary. Browser builds deliberately
  // use an anchor download here; the Windows/Tauri host uses native Save As.
  'packages/cad-simple-viewer/src/util/AcApExportSaveUtil.ts'
])

const STANDALONE_BROWSER_PREFIXES = [
  // AcEx* files execute inside exported, self-contained HTML documents rather
  // than the installed Windows CAD application. Browser downloads are correct
  // in that environment.
  'packages/cad-html-plugin/src/AcEx'
]

const HARD_RULES = [
  {
    name: 'direct anchor download',
    regex: /\.download\s*=/g,
    help: 'Use saveExportBlob/saveExportText so Windows receives a native Save As dialog.'
  },
  {
    name: 'download attribute mutation',
    regex: /setAttribute\s*\(\s*['"]download['"]/g,
    help: 'Use saveExportBlob/saveExportText instead of browser download attributes.'
  },
  {
    name: 'jsPDF browser save',
    regex: /\bpdf\.save\s*\(/g,
    help: "Use pdf.output('blob') and saveExportBlob()."
  },
  {
    name: 'browser File System Access API',
    regex: /\b(?:showSaveFilePicker|showOpenFilePicker)\s*\(/g,
    help: 'Route file I/O through the desktop compatibility layer.'
  }
]

const WARN_RULES = [
  {
    name: 'browser file input',
    regex: /\.type\s*=\s*['"]file['"]/g,
    help: 'Verify cancel cleanup and Windows/WebView2 behavior; prefer a native adapter for critical flows.'
  },
  {
    name: 'external runtime URL',
    regex: /https?:\/\//g,
    help: 'Confirm the Windows build has a local/offline path for required runtime assets.'
  }
]

async function walk(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir)
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDir.replaceAll('\\', '/'), entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(relativePath)))
    } else if (/\.(?:ts|tsx|vue|js|mjs)$/.test(entry.name)) {
      files.push(relativePath)
    }
  }
  return files
}

function lineNumberAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function isStandaloneBrowserFile(file) {
  return STANDALONE_BROWSER_PREFIXES.some(prefix => file.startsWith(prefix))
}

function collectMatches(text, rule) {
  const matches = []
  rule.regex.lastIndex = 0
  let match
  while ((match = rule.regex.exec(text)) !== null) {
    matches.push({ line: lineNumberAt(text, match.index), match: match[0] })
    if (match[0].length === 0) rule.regex.lastIndex++
  }
  return matches
}

const files = (await Promise.all(SOURCE_ROOTS.map(walk))).flat()
const hardFailures = []
const warnings = []

for (const file of files) {
  const text = await readFile(path.join(ROOT, file), 'utf8')
  const allowBrowserDownload = ALLOWED_BROWSER_DOWNLOAD.has(file)
  const standaloneBrowser = isStandaloneBrowserFile(file)

  for (const rule of HARD_RULES) {
    if (allowBrowserDownload || standaloneBrowser) continue
    for (const match of collectMatches(text, rule)) {
      hardFailures.push({ file, ...match, rule })
    }
  }

  for (const rule of WARN_RULES) {
    if (standaloneBrowser) continue
    for (const match of collectMatches(text, rule)) {
      warnings.push({ file, ...match, rule })
    }
  }
}

console.log(`Desktop compatibility audit scanned ${files.length} source files.`)

if (warnings.length) {
  console.log(`\nReview warnings (${warnings.length}):`)
  for (const item of warnings) {
    console.log(`  WARN ${item.file}:${item.line} — ${item.rule.name}. ${item.rule.help}`)
  }
}

if (hardFailures.length) {
  console.error(`\nDesktop compatibility violations (${hardFailures.length}):`)
  for (const item of hardFailures) {
    console.error(`  FAIL ${item.file}:${item.line} — ${item.rule.name}. ${item.rule.help}`)
  }
  process.exitCode = 1
} else {
  console.log('\nDesktop compatibility hard checks passed.')
}
