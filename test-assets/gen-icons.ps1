Add-Type -AssemblyName System.Drawing
$dir = 'H:\Project\image-watermark\public'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

foreach ($size in 512, 192) {
    $bmp = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $bg = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 64, 158, 255))
    $g.FillRectangle($bg, 0, 0, $size, $size)
    $font = [System.Drawing.Font]::new('Microsoft YaHei', [float]($size * 0.28), [System.Drawing.FontStyle]::Bold)
    $sf = [System.Drawing.StringFormat]::new()
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = [System.Drawing.RectangleF]::new(0, [float](-$size * 0.03), $size, $size)
    $g.DrawString('水印', $font, [System.Drawing.Brushes]::White, $rect, $sf)
    $g.Dispose()
    $bmp.Save("$dir\icon-$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Write-Output 'pwa icons generated'
