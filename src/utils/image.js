// 九宫格位置 key → 水平 / 垂直锚点
import { extractJpegExif, insertJpegExif, neutralizeExifOrientation } from './exif.js'

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

// 给绘制上下文加阴影；pct 为阴影强度（相对内容宽度的百分比）
function applyShadow(ctx, contentW, pct) {
  if (!pct) return
  const k = Math.max(1, (contentW * pct) / 100)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = k
  ctx.shadowOffsetX = k * 0.35
  ctx.shadowOffsetY = k * 0.35
}

// 生成水印精灵画布（图像或文字，含描边/阴影），阴影通过四周留白避免被裁切
function buildSprite(watermark, settings, targetW) {
  let contentW
  let contentH
  let drawContent
  if (watermark.type === 'text') {
    const fontSize = Math.max(6, (targetW * watermark.sizePct) / 100)
    const strokePx = (fontSize * (watermark.strokePct || 0)) / 100
    const custom =
      watermark.fontFamily && watermark.fontFamily !== 'system'
        ? `"${watermark.fontFamily.replace(/"/g, '')}", `
        : ''
    const font = `bold ${fontSize}px ${custom}system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`
    const probe = document.createElement('canvas').getContext('2d')
    probe.font = font
    const m = probe.measureText(watermark.content)
    const ascent = m.actualBoundingBoxAscent ?? fontSize * 0.8
    const descent = m.actualBoundingBoxDescent ?? fontSize * 0.3
    contentW = Math.ceil(m.width + strokePx * 2)
    contentH = Math.ceil(ascent + descent + strokePx * 2)
    drawContent = (ctx) => {
      ctx.font = font
      ctx.textBaseline = 'alphabetic'
      ctx.lineJoin = 'round'
      if (strokePx > 0) {
        ctx.lineWidth = Math.max(1, strokePx * 2)
        ctx.strokeStyle = watermark.strokeColor
        ctx.strokeText(watermark.content, strokePx, strokePx + ascent)
      }
      applyShadow(ctx, contentW, settings.shadowPct)
      ctx.fillStyle = watermark.color
      ctx.fillText(watermark.content, strokePx, strokePx + ascent)
    }
  } else {
    const { w: ww, h: wh } = dims(watermark.img)
    contentW = Math.max(1, Math.round((targetW * settings.scalePct) / 100))
    contentH = Math.max(1, Math.round((contentW * wh) / ww))
    drawContent = (ctx) => {
      applyShadow(ctx, contentW, settings.shadowPct)
      ctx.drawImage(watermark.img, 0, 0, contentW, contentH)
    }
  }

  const pad = settings.shadowPct ? Math.ceil((contentW * settings.shadowPct * 1.8) / 100) : 0
  const canvas = document.createElement('canvas')
  canvas.width = contentW + pad * 2
  canvas.height = contentH + pad * 2
  const ctx = canvas.getContext('2d')
  ctx.translate(pad, pad)
  drawContent(ctx)
  return canvas
}

// 把水印按设置合成到目标图上，返回新 canvas。
// maxWidth/maxHeight 仅用于预览缩放；导出时不传，按原图分辨率输出。
// 大小、边距都是相对目标图宽度的百分比，因此预览与导出严格成比例。
// watermark: null | { type:'image', img } | { type:'text', content, fontFamily, sizePct, color, strokePct, strokeColor }
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

  const sprite = buildSprite(watermark, settings, w)
  const wmW = sprite.width
  const wmH = sprite.height
  const rad = ((settings.rotation || 0) * Math.PI) / 180

  ctx.globalAlpha = settings.opacity / 100
  if (settings.layout === 'tile') {
    // 平铺：把水印做成重复单元，整体旋转后铺满对角线范围
    const gapX = Math.round((wmW * (settings.tileGapPct ?? 50)) / 100)
    const gapY = Math.round((wmH * (settings.tileGapPct ?? 50)) / 100)
    const cell = document.createElement('canvas')
    cell.width = Math.max(1, wmW + gapX)
    cell.height = Math.max(1, wmH + gapY)
    cell.getContext('2d').drawImage(sprite, 0, 0)
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate(rad)
    const span = Math.ceil(Math.hypot(w, h))
    ctx.fillStyle = ctx.createPattern(cell, 'repeat')
    ctx.fillRect(-span, -span, span * 2 + cell.width, span * 2 + cell.height)
    ctx.restore()
  } else {
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

    ctx.save()
    ctx.translate(x + wmW / 2, y + wmH / 2)
    if (rad) ctx.rotate(rad)
    ctx.drawImage(sprite, -wmW / 2, -wmH / 2)
    ctx.restore()
  }
  ctx.globalAlpha = 1
  return canvas
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))), type, quality)
  })
}

// 处理单个文件：解码 → 合成 → 编码，保留原格式（PNG 无损；JPEG/WebP 用 settings.quality，默认 0.95）
// 可选保留 EXIF（仅 JPEG），文件名按模板生成，支持 {name} {i} {date}
export async function processFile(file, watermark, settings, index = 0) {
  const bitmap = await loadBitmap(file)
  try {
    const canvas = composite(bitmap, watermark, settings)
    const type = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/png'
    const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
    const quality = typeof settings.quality === 'number' ? settings.quality : 0.95
    let blob = await canvasToBlob(canvas, type, quality)

    if (settings.keepExif && type === 'image/jpeg') {
      try {
        const exif = extractJpegExif(await file.arrayBuffer())
        if (exif) {
          blob = new Blob([insertJpegExif(await blob.arrayBuffer(), neutralizeExifOrientation(exif))], { type })
        }
      } catch {
        /* EXIF 处理失败时保持无 EXIF 的导出结果 */
      }
    }

    const tpl = (settings.nameTemplate || '{name}_watermark').trim() || '{name}_watermark'
    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    const now = new Date()
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const name = tpl.replaceAll('{name}', base).replaceAll('{i}', String(index + 1)).replaceAll('{date}', dateStr)
    return { blob, filename: `${name}.${ext}` }
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
