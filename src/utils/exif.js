// 从 JPEG 原始字节中提取完整的 EXIF APP1 段（含 marker 与长度）
export function extractJpegExif(buffer) {
  const v = new Uint8Array(buffer)
  if (v[0] !== 0xff || v[1] !== 0xd8) return null
  let i = 2
  while (i + 4 <= v.length) {
    if (v[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = v[i + 1]
    if (marker === 0xff) {
      i += 1
      continue
    }
    // 无长度的段
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xda) break // 扫描数据开始，后面不会再有 APP1
    const len = (v[i + 2] << 8) | v[i + 3]
    if (marker === 0xe1 && len >= 8) {
      const isExif =
        v[i + 4] === 0x45 && v[i + 5] === 0x78 && v[i + 6] === 0x69 && v[i + 7] === 0x66 && v[i + 8] === 0x00 && v[i + 9] === 0x00
      if (isExif) return v.slice(i, i + 2 + len)
    }
    i += 2 + len
  }
  return null
}

// 把 EXIF 段插回重新编码的 JPEG（紧随 SOI 标记）
export function insertJpegExif(jpegBuffer, exifSegment) {
  const src = new Uint8Array(jpegBuffer)
  const out = new Uint8Array(src.length + exifSegment.length)
  out.set(src.subarray(0, 2), 0)
  out.set(exifSegment, 2)
  out.set(src.subarray(2), 2 + exifSegment.length)
  return out
}

// 重编码后的像素已按 EXIF 方向摆正，需把方向标记改为 1，避免查看器二次旋转
export function neutralizeExifOrientation(seg) {
  try {
    const little = seg[10] === 0x49 && seg[11] === 0x49
    const big = seg[10] === 0x4d && seg[11] === 0x4d
    if (!little && !big) return seg
    const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength)
    const ifdStart = 10 + dv.getUint32(12, little)
    const count = dv.getUint16(ifdStart, little)
    for (let k = 0; k < count; k++) {
      const entry = ifdStart + 2 + k * 12
      if (dv.getUint16(entry, little) === 0x0112) {
        dv.setUint16(entry + 8, 1, little)
        break
      }
    }
  } catch {
    /* 解析失败则原样保留 */
  }
  return seg
}
