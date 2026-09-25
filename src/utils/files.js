function isImageFile(f) {
  return f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|bmp|gif)$/i.test(f.name || '')
}

// 从拖拽事件里收集文件，支持整个文件夹：
// entries 需要在事件回调里同步收集（事件结束后 dataTransfer 就不可读了），再异步递归遍历
export async function filesFromDataTransfer(dt, entries) {
  const list =
    entries ?? [...(dt?.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean)
  if (!list.length) return [...(dt?.files ?? [])].filter(isImageFile)

  const files = []
  async function walk(entry) {
    if (entry.isFile) {
      const f = await new Promise((resolve, reject) => entry.file(resolve, reject))
      files.push(f)
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      // readEntries 每次最多返回 100 条，读到空数组才算遍历完
      const readBatch = () => new Promise((resolve, reject) => reader.readEntries(resolve, reject))
      let batch
      do {
        batch = await readBatch()
        for (const e of batch) await walk(e)
      } while (batch.length)
    }
  }
  for (const e of list) await walk(e)
  return files.filter(isImageFile)
}
