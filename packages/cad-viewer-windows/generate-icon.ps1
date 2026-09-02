$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$background = [System.Drawing.Color]::FromArgb(255, 22, 30, 45)
$foreground = [System.Drawing.Color]::FromArgb(255, 240, 244, 250)
$graphics.Clear($background)

$borderPen = New-Object System.Drawing.Pen($foreground, 10)
$geometryPen = New-Object System.Drawing.Pen($foreground, 7)
$diagonalPen = New-Object System.Drawing.Pen($foreground, 9)

$graphics.DrawRectangle($borderPen, 24, 24, 208, 208)
$graphics.DrawLine($diagonalPen, 65, 190, 190, 65)
$graphics.DrawEllipse($geometryPen, 70, 70, 60, 60)
$graphics.DrawRectangle($geometryPen, 130, 130, 60, 60)

$outputPath = Join-Path $PSScriptRoot 'app-icon.generated.png'
$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$diagonalPen.Dispose()
$geometryPen.Dispose()
$borderPen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Generated $outputPath"
