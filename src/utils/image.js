// 九宫格位置 key → 水平 / 垂直锚点
const POSITIONS = {
  'top-left': { x: 'left', y: 'top' },
  'top-center': { x: 'center', y: 'top' },
  'top-right': { x: 'right', y: 'top' },
  'middle-left': { x: 'left', y: 'middle' },
  center: { x: 'center', y: 'middle' },
  'middle-right': { x: 'right', y: 'middle' },
  'bottom-left': { x: 'left', y: 'bottom' },
  'bottom-center': { x: 'center', y: 'bottom' },
  'bottom-right': { x: 'right', y: 'bottom' },
}

// heic2any 体积较大（约 1MB），按需动态加载：只有真正遇到 HEIC 文件才会下载
let heic2anyFn = null
function isHeic(file) {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(heic|heif)$/i.test(file.name || '')
  )
}

async function convertHeic(file) {
  if (!heic2anyFn) heic2anyFn = (await import('heic2any')).default
  const out = await heic2anyFn({ blob: file, toType: 'image/png' })
  return Array.isArray(out) ? out[0] : out
}

async function decodeFile(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      try {
        return await createImageBitmap(file)
      } catch {
        // 落到 <img> 兜底
      }
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = () => reject(new Error('图片解码失败'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

// 读取文件为可绘制的图像，显式按 EXIF 方向解码；
// 浏览器解不了且文件是 HEIC 时，动态加载 heic2any 转成 PNG 再解
export async function loadBitmap(file) {
  try {
    return await decodeFile(file)
  } catch (e) {
    if (isHeic(file)) {
      try {
        return await decodeFile(await convertHeic(file))
      } catch {
        // 转换也失败时抛出原始错误
      }
    }
    throw e
  }
}

function dims(img) {
  return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }
}

// 把水印按设置合成到目标图上，返回新 canvas。
// maxWidth/maxHeight 仅用于预览缩放；导出时不传，按原图分辨率输出。
// 大小、边距都是相对目标图宽度的百分比，因此预览与导出严格成比例。
// watermark: null | { type:'image', img } | { type:'text', content, sizePct, color, strokePct, strokeColor }
export function composite(target, watermark, settings, maxWidth = Infinity, maxHeight = Infinity) {
  const { w: tw, h: th } = dims(target)
  const s = Math.min(1, maxWidth / tw, maxHeight / th)
  const w = Math.max(1, Math.round(tw * s))
  const h = Math.max(1, Math.round(th * s))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(target, 0, 0, w, h)
  if (!watermark) return canvas

  let wmW
  let wmH
  let draw
  if (watermark.type === 'text') {
    const fontSize = Math.max(6, (w * watermark.sizePct) / 100)
    const strokePx = (fontSize * (watermark.strokePct || 0)) / 100
    const custom =
      watermark.fontFamily && watermark.fontFamily !== 'system'
        ? `"${watermark.fontFamily.replace(/"/g, '')}", `
        : ''
    ctx.font = `bold ${fontSize}px ${custom}system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    const m = ctx.measureText(watermark.content)
    const ascent = m.actualBoundingBoxAscent ?? fontSize * 0.8
    const descent = m.actualBoundingBoxDescent ?? fontSize * 0.3
    wmW = Math.ceil(m.width + strokePx * 2)
    wmH = Math.ceil(ascent + descent + strokePx * 2)
    const left = Math.max(0, strokePx)
    draw = (x, y) => {
      if (strokePx > 0) {
        ctx.lineWidth = Math.max(1, strokePx * 2)
        ctx.strokeStyle = watermark.strokeColor
        ctx.strokeText(watermark.content, x + left, y + left + ascent)
      }
      ctx.fillStyle = watermark.color
      ctx.fillText(watermark.content, x + left, y + left + ascent)
    }
  } else {
    const { w: ww, h: wh } = dims(watermark.img)
    wmW = Math.max(1, Math.round((w * settings.scalePct) / 100))
    wmH = Math.max(1, Math.round((wmW * wh) / ww))
    draw = (x, y) => ctx.drawImage(watermark.img, x, y, wmW, wmH)
  }

  const margin = Math.round((w * settings.marginPct) / 100)
  const anchor = POSITIONS[settings.position] ?? POSITIONS['bottom-right']
  let x
  if (anchor.x === 'left') x = margin
  else if (anchor.x === 'right') x = w - wmW - margin
  else x = Math.round((w - wmW) / 2)

  let y
  if (anchor.y === 'top') y = margin
  else if (anchor.y === 'bottom') y = h - wmH - margin
  else y = Math.round((h - wmH) / 2)

  // 水印 + 边距超出图片时收回到图片内
  x = Math.max(0, Math.min(x, Math.max(0, w - wmW)))
  y = Math.max(0, Math.min(y, Math.max(0, h - wmH)))

  ctx.globalAlpha = settings.opacity / 100
  draw(x, y)
  ctx.globalAlpha = 1
  return canvas
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))), type, quality)
  })
}

// 处理单个文件：解码 → 合成 → 编码，保留原格式（PNG 无损；JPEG/WebP 用 settings.quality，默认 0.95）
export async function processFile(file, watermark, settings) {
  const bitmap = await loadBitmap(file)
  try {
    const canvas = composite(bitmap, watermark, settings)
    const type = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/png'
    const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
    const quality = typeof settings.quality === 'number' ? settings.quality : 0.95
    const blob = await canvasToBlob(canvas, type, quality)
    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    return { blob, filename: `${base}_watermark.${ext}` }
  } finally {
    bitmap.close?.()
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
