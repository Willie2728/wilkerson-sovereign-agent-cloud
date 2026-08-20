param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

function New-WilkersonIcon([int]$Size, [string]$Path, [bool]$Maskable) {
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
        $navy = [System.Drawing.Color]::FromArgb(12, 18, 61)
        $violet = [System.Drawing.Color]::FromArgb(54, 37, 105)
        $gold = [System.Drawing.Color]::FromArgb(220, 188, 99)
        $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $navy, $violet, 45)
        $graphics.FillRectangle($brush, $rect)
        $brush.Dispose()
        $margin = if ($Maskable) { [int]($Size * 0.18) } else { [int]($Size * 0.09) }
        $diameter = $Size - (2 * $margin)
        $pen = New-Object System.Drawing.Pen($gold, [Math]::Max(3, [int]($Size * 0.025)))
        $graphics.DrawEllipse($pen, $margin, $margin, $diameter, $diameter)
        $pen.Dispose()
        $innerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(115, 220, 188, 99), [Math]::Max(1, [int]($Size * 0.007)))
        $inset = [int]($Size * 0.035)
        $graphics.DrawEllipse($innerPen, $margin + $inset, $margin + $inset, $diameter - 2 * $inset, $diameter - 2 * $inset)
        $innerPen.Dispose()
        $font = New-Object System.Drawing.Font('Georgia', ($Size * 0.25), ([System.Drawing.FontStyle]::Bold -bor [System.Drawing.FontStyle]::Italic), [System.Drawing.GraphicsUnit]::Pixel)
        $aiFont = New-Object System.Drawing.Font('Arial', ($Size * 0.07), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $goldBrush = New-Object System.Drawing.SolidBrush($gold)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $graphics.DrawString('WC', $font, $goldBrush, (New-Object System.Drawing.RectangleF(0, ($Size * 0.22), $Size, ($Size * 0.43))), $format)
        $graphics.DrawString('AI', $aiFont, $goldBrush, (New-Object System.Drawing.RectangleF(0, ($Size * 0.59), $Size, ($Size * 0.14))), $format)
        $format.Dispose(); $goldBrush.Dispose(); $font.Dispose(); $aiFont.Dispose()
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose(); $bitmap.Dispose()
    }
}

New-WilkersonIcon 192 (Join-Path $OutputDirectory 'wilkerson-192.png') $false
New-WilkersonIcon 512 (Join-Path $OutputDirectory 'wilkerson-512.png') $false
New-WilkersonIcon 512 (Join-Path $OutputDirectory 'wilkerson-maskable-512.png') $true
Copy-Item -LiteralPath (Join-Path $OutputDirectory 'wilkerson-192.png') -Destination (Join-Path (Split-Path -Parent $OutputDirectory) 'apple-touch-icon.png') -Force
