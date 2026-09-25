Add-Type -AssemblyName System.Drawing
$dir = 'H:\Project\image-watermark\test-assets'

function New-Photo([int]$w, [int]$h, [System.Drawing.Color]$bgColor, [string]$text, [string]$out) {
    $bmp = [System.Drawing.Bitmap]::new($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $bg = [System.Drawing.SolidBrush]::new($bgColor)
    $g.FillRectangle($bg, 0, 0, $w, $h)
    $circle = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 240, 200, 90))
    $g.FillEllipse($circle, [int]($w * 0.62), [int]($h * 0.1), [int]($w * 0.25), [int]($w * 0.25))
    $circle2 = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 90, 180, 120))
    $g.FillEllipse($circle2, [int]($w * 0.12), [int]($h * 0.45), [int]($w * 0.18), [int]($w * 0.18))
    $font = [System.Drawing.Font]::new('Arial', 40)
    $g.DrawString($text, $font, [System.Drawing.Brushes]::White, 50, $h - 100)
    $g.Dispose()
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
}

New-Photo 1600 1000 ([System.Drawing.Color]::FromArgb(255, 84, 134, 180)) 'SAMPLE PHOTO 1600x1000' "$dir\target.jpg"
New-Photo 1200 800 ([System.Drawing.Color]::FromArgb(255, 150, 110, 170)) 'SECOND PHOTO 1200x800' "$dir\target2.jpg"

$wm = [System.Drawing.Bitmap]::new(480, 160)
$g4 = [System.Drawing.Graphics]::FromImage($wm)
$g4.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g4.Clear([System.Drawing.Color]::Transparent)
$pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 6)
$g4.DrawRectangle($pen, 6, 6, 468, 148)
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(230, 255, 90, 60))
$font3 = [System.Drawing.Font]::new('Arial', 44, [System.Drawing.FontStyle]::Bold)
$g4.DrawString('WATERMARK', $font3, $brush, 60, 44)
$g4.Dispose()
$wm.Save("$dir\watermark.png", [System.Drawing.Imaging.ImageFormat]::Png)
$wm.Dispose()

Write-Output 'test assets generated'
