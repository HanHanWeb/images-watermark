<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { ElMessage, genFileId } from 'element-plus'
import { Delete, Download, Files, Loading, Picture, Setting, Stamp, UploadFilled, View } from '@element-plus/icons-vue'
import JSZip from 'jszip'
import PositionGrid from './components/PositionGrid.vue'
import { composite, downloadBlob, loadBitmap, processFile } from './utils/image'
import { filesFromDataTransfer } from './utils/files'
import { idbDelete, idbGet, idbSet } from './utils/store'

const SETTINGS_KEY = 'iw-settings'

const exporting = ref(false)
const progress = reactive({ done: 0, total: 0 })

const wmMode = ref('image') // image | text
const watermarkUrl = ref('')
const watermarkBitmap = shallowRef(null)
const watermarkInfo = ref('')

const fileList = ref([])
const imagesUploadRef = ref(null)
const rawImages = computed(() => fileList.value.map((f) => f.raw).filter(Boolean))

const settings = reactive({
  position: 'bottom-right',
  scalePct: 20,
  marginPct: 2,
  opacity: 100,
})
const textSettings = reactive({
  content: '',
  font: 'system',
  sizePct: 6,
  color: '#FFFFFF',
  strokePct: 12,
  strokeColor: '#000000',
})

// 文字水印可选字体：CSS 与字体文件托管在 jsDelivr，按 unicode-range 分片，用到才下载
const FONTS = [
  { label: '系统默认（黑体）', value: 'system', css: null },
  { label: '思源黑体', value: 'Noto Sans SC', css: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/400.css' },
  { label: '思源宋体', value: 'Noto Serif SC', css: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5/400.css' },
  { label: '霞鹜文楷', value: 'LXGW WenKai', css: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1/style.css' },
  { label: '马善政毛笔楷书', value: 'Ma Shan Zheng', css: 'https://cdn.jsdelivr.net/npm/@fontsource/ma-shan-zheng@5/400.css' },
  { label: '站酷快乐体', value: 'ZCOOL KuaiLe', css: 'https://cdn.jsdelivr.net/npm/@fontsource/zcool-kuaile@5/400.css' },
  { label: '站酷小薇LOGO体', value: 'ZCOOL XiaoWei', css: 'https://cdn.jsdelivr.net/npm/@fontsource/zcool-xiaowei@5/400.css' },
]

const loadedFontCss = new Set()
const fontLoading = ref(false)
let fontLoadingCount = 0
async function ensureFont(family, text) {
  const f = FONTS.find((x) => x.value === family)
  if (!f?.css) return
  const firstTime = !loadedFontCss.has(f.value)
  if (firstTime) {
    loadedFontCss.add(f.value)
    fontLoadingCount++
    fontLoading.value = true
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = f.css
    document.head.appendChild(link)
  }
  try {
    // 传入实际文字，让浏览器只加载包含这些字符的字体分片
    await document.fonts.load(`bold 64px "${f.value}"`, text || '水印')
  } catch {
    /* 字体加载失败时用回退字体渲染 */
  } finally {
    if (firstTime && --fontLoadingCount <= 0) {
      fontLoadingCount = 0
      fontLoading.value = false
    }
  }
}

// 字体 / 文字变化：先用回退字体立即渲染，字体就绪后再渲染一次
watch(
  () => [textSettings.font, textSettings.content],
  async ([family]) => {
    schedulePreview()
    if (wmMode.value === 'text' && family !== 'system') {
      await ensureFont(family, textSettings.content)
      schedulePreview()
    }
  },
)

// 导出质量弹窗：低/中/高 三档，质量仅对 JPEG/WebP 等有损格式生效，PNG 始终无损
const QUALITY_MAP = { low: 0.6, mid: 0.8, high: 1 }
const exportDialog = reactive({ visible: false, quality: 'high' })
const qualityCaptions = {
  low: '文件最小，画质压缩较明显',
  mid: '兼顾画质与文件大小',
  high: '画质最佳，接近原图（文件最大）',
}

// 当前水印源：图片位图或文字配置
const wmSource = computed(() => {
  if (wmMode.value === 'text') {
    const content = textSettings.content.trim()
    if (!content) return null
    return {
      type: 'text',
      content,
      fontFamily: textSettings.font,
      sizePct: textSettings.sizePct,
      color: textSettings.color,
      strokePct: textSettings.strokePct,
      strokeColor: textSettings.strokeColor,
    }
  }
  return watermarkBitmap.value ? { type: 'image', img: watermarkBitmap.value } : null
})

// ---------- 预览 ----------
const previewIndex = ref(0)
const previewFile = computed(() => rawImages.value[previewIndex.value] ?? rawImages.value[0] ?? null)
const previewCanvas = ref(null)
const previewInfo = ref('')
const showOriginal = ref(false)
const thumbs = ref([])

let previewTimer = null
function schedulePreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(renderPreview, 120)
}

watch([previewFile, wmSource], schedulePreview, { flush: 'post' })
watch(settings, schedulePreview, { deep: true, flush: 'post' })

let renderSeq = 0
async function renderPreview() {
  const canvas = previewCanvas.value
  const file = previewFile.value
  if (!canvas || !file) return
  const seq = ++renderSeq
  try {
    const bitmap = await loadBitmap(file)
    const c = composite(bitmap, showOriginal.value ? null : wmSource.value, settings, 1000, 600)
    if (seq !== renderSeq) {
      bitmap.close?.()
      return
    }
    canvas.width = c.width
    canvas.height = c.height
    canvas.getContext('2d').drawImage(c, 0, 0)
    const w = bitmap.naturalWidth || bitmap.width
    const h = bitmap.naturalHeight || bitmap.height
    previewInfo.value = `原图 ${w} × ${h} · 按住图片看原图`
    bitmap.close?.()
  } catch (e) {
    console.error(e)
    if (seq === renderSeq) {
      previewInfo.value = ''
      ElMessage.error('这张图片无法在浏览器中解码（可能是损坏的文件），已跳过预览')
    }
  }
}

// 按住看原图
function previewDown() {
  if (!wmSource.value) return
  showOriginal.value = true
  renderPreview()
}
function previewUp() {
  if (!showOriginal.value) return
  showOriginal.value = false
  renderPreview()
}

// 缩略图条：给每张目标图建一个 object URL，列表变化时回收旧的
watch(rawImages, (files) => {
  thumbs.value.forEach((t) => URL.revokeObjectURL(t.url))
  thumbs.value = files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))
  if (previewIndex.value >= files.length) previewIndex.value = Math.max(0, files.length - 1)
})

// ---------- 水印上传 ----------
async function setWatermarkFile(raw) {
  try {
    const bitmap = await loadBitmap(raw)
    if (watermarkUrl.value) URL.revokeObjectURL(watermarkUrl.value)
    watermarkUrl.value = URL.createObjectURL(raw)
    watermarkBitmap.value = bitmap
    watermarkInfo.value = `${bitmap.naturalWidth || bitmap.width} × ${bitmap.naturalHeight || bitmap.height}`
    await idbSet('watermark', raw)
  } catch (e) {
    console.error(e)
    ElMessage.error('水印图片读取失败，请换一张试试')
  }
}

function onWatermarkChange(uploadFile) {
  if (uploadFile.raw) setWatermarkFile(uploadFile.raw)
}

async function clearWatermark() {
  if (watermarkUrl.value) URL.revokeObjectURL(watermarkUrl.value)
  watermarkUrl.value = ''
  watermarkBitmap.value = null
  watermarkInfo.value = ''
  try {
    await idbDelete('watermark')
  } catch {
    /* 忽略存储错误 */
  }
}

// ---------- 文件夹拖入 ----------
async function onDropCapture(e) {
  const dt = e.dataTransfer
  if (!dt) return
  // entry 必须在事件回调里同步取出，事件结束后 dataTransfer 不可读
  const entries = [...(dt.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean)
  if (!entries.some((en) => en.isDirectory)) return // 普通文件拖拽仍走 el-upload 自身逻辑
  e.preventDefault()
  e.stopPropagation()
  const files = await filesFromDataTransfer(dt, entries)
  for (const f of files) imagesUploadRef.value?.handleStart(f)
  if (files.length) ElMessage.success(`已从文件夹添加 ${files.length} 张图片`)
}

// ---------- 设置记忆 ----------
let saveTimer = null
watch([wmMode, settings, textSettings, () => exportDialog.quality], () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          wmMode: wmMode.value,
          settings: { ...settings },
          textSettings: { ...textSettings },
          quality: exportDialog.quality,
        }),
      )
    } catch {
      /* 存储空间不足等情况忽略 */
    }
  }, 300)
}, { deep: true })

onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    if (saved.wmMode === 'image' || saved.wmMode === 'text') wmMode.value = saved.wmMode
    Object.assign(settings, saved.settings ?? {})
    Object.assign(textSettings, saved.textSettings ?? {})
    if (['low', 'mid', 'high'].includes(saved.quality)) exportDialog.quality = saved.quality
  } catch {
    /* 配置损坏时用默认值 */
  }
  if (wmMode.value === 'text' && textSettings.font !== 'system') {
    ensureFont(textSettings.font, textSettings.content).then(schedulePreview)
  }
  try {
    const blob = await idbGet('watermark')
    if (blob) await setWatermarkFile(blob)
  } catch {
    /* 无持久化水印或读取失败则跳过 */
  }
})

onBeforeUnmount(() => {
  if (watermarkUrl.value) URL.revokeObjectURL(watermarkUrl.value)
  thumbs.value.forEach((t) => URL.revokeObjectURL(t.url))
})

// ---------- 导出 ----------
function requestExport() {
  if (wmMode.value === 'text' && !textSettings.content.trim()) {
    ElMessage.warning('请先输入水印文字')
    return
  }
  if (wmMode.value === 'image' && !watermarkBitmap.value) {
    ElMessage.warning('请先上传水印图片')
    return
  }
  if (!rawImages.value.length) {
    ElMessage.warning('请先上传待处理图片')
    return
  }
  exportDialog.visible = true
}

async function exportAll(overrides = {}) {
  const files = rawImages.value
  const wm = wmSource.value
  exporting.value = true
  progress.total = files.length
  progress.done = 0
  const exportSettings = { ...settings, ...overrides }
  const failed = []
  try {
    if (files.length === 1) {
      try {
        const { blob, filename } = await processFile(files[0], wm, exportSettings)
        downloadBlob(blob, filename)
      } catch (e) {
        console.error(e)
        failed.push(files[0].name)
      }
      progress.done = 1
    } else {
      const zip = new JSZip()
      for (const file of files) {
        try {
          const { blob, filename } = await processFile(file, wm, exportSettings)
          zip.file(filename, blob)
        } catch (e) {
          console.error(e)
          failed.push(file.name)
        }
        progress.done++
        await new Promise((r) => setTimeout(r, 0))
      }
      if (failed.length === files.length) {
        ElMessage.error('所有图片都处理失败（可能是浏览器不支持的格式）')
        return
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `水印图片_${files.length - failed.length}张.zip`)
    }
    if (failed.length) {
      ElMessage.warning(`有 ${failed.length} 张处理失败（可能是浏览器不支持的格式）：${failed.join('、')}`)
    } else {
      ElMessage.success('导出完成，已开始下载')
    }
  } finally {
    exporting.value = false
  }
}

async function confirmExport() {
  exportDialog.visible = false
  await exportAll({ quality: QUALITY_MAP[exportDialog.quality] })
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1 class="title"><el-icon class="title-icon"><Stamp /></el-icon>图片水印工具</h1>
      <p>所有图片仅在你的浏览器本地处理，不会上传到任何服务器</p>
    </header>

    <main class="layout">
      <section class="preview">
        <el-card shadow="never" class="preview-card">
          <template #header>
            <div class="preview-header">
              <div class="preview-title"><el-icon><View /></el-icon><b>实时预览</b></div>
              <span class="tip">{{ previewInfo || '显示第 1 张图片的效果' }}</span>
            </div>
          </template>
          <div
            v-if="previewFile"
            class="preview-stage"
            @pointerdown="previewDown"
            @pointerup="previewUp"
            @pointerleave="previewUp"
            @pointercancel="previewUp"
          >
            <canvas ref="previewCanvas" class="preview-canvas"></canvas>
          </div>
          <el-empty v-else description="先上传待处理图片" />
          <div v-if="thumbs.length > 1" class="thumb-strip">
            <img
              v-for="(t, i) in thumbs"
              :key="t.url"
              :src="t.url"
              :title="t.name"
              :class="{ active: i === previewIndex }"
              @click="previewIndex = i"
            />
          </div>
        </el-card>
      </section>

      <section class="panel">
        <el-card shadow="never" class="card">
          <template #header>
            <div class="card-header"><el-icon><Picture /></el-icon><b>水印内容</b></div>
          </template>
          <el-radio-group v-model="wmMode" class="wm-mode">
            <el-radio-button value="image">图片水印</el-radio-button>
            <el-radio-button value="text">文字水印</el-radio-button>
          </el-radio-group>

          <template v-if="wmMode === 'image'">
            <el-upload
              v-if="!watermarkUrl"
              :auto-upload="false"
              :show-file-list="false"
              accept="image/*,.heic,.heif"
              :on-change="onWatermarkChange"
              drag
            >
              <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
              <div class="el-upload__text">点击或拖拽上传水印图片</div>
            </el-upload>
            <div v-else class="wm-preview">
              <img :src="watermarkUrl" alt="水印预览" />
              <div class="wm-meta">
                <span>{{ watermarkInfo }}</span>
                <el-button text type="danger" :icon="Delete" @click="clearWatermark">移除</el-button>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="setting text-input">
              <el-input
                v-model="textSettings.content"
                placeholder="输入水印文字，如 @摄影日记"
                maxlength="30"
                clearable
              />
            </div>
            <div class="setting">
              <div class="label font-label">
                <span>字体</span>
                <el-icon v-if="fontLoading" class="is-loading"><Loading /></el-icon>
              </div>
              <el-select v-model="textSettings.font" class="font-select">
                <el-option v-for="f in FONTS" :key="f.value" :label="f.label" :value="f.value" />
              </el-select>
            </div>
            <div class="setting">
              <div class="label">字号</div>
              <el-slider v-model="textSettings.sizePct" :min="1" :max="30" :step="0.5" />
            </div>
            <div class="setting row">
              <div class="label">文字颜色</div>
              <el-color-picker v-model="textSettings.color" />
            </div>
            <div class="setting">
              <div class="label">描边</div>
              <el-slider v-model="textSettings.strokePct" :min="0" :max="50" :step="1" />
            </div>
            <div class="setting row">
              <div class="label">描边颜色</div>
              <el-color-picker v-model="textSettings.strokeColor" />
            </div>
          </template>
        </el-card>

        <el-card shadow="never" class="card">
          <template #header>
            <div class="card-header"><el-icon><Files /></el-icon><b>待处理图片（{{ rawImages.length }} 张）</b></div>
          </template>
          <div @dragover.capture.prevent @drop.capture="onDropCapture">
            <el-upload ref="imagesUploadRef" v-model:file-list="fileList" :auto-upload="false" multiple accept="image/*,.heic,.heif" drag>
              <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
              <div class="el-upload__text">点击或拖拽图片到这里，可多选，支持整个文件夹</div>
            </el-upload>
          </div>
        </el-card>

        <el-card shadow="never" class="card">
          <template #header>
            <div class="card-header"><el-icon><Setting /></el-icon><b>水印设置</b></div>
          </template>
          <div class="setting">
            <div class="label">位置</div>
            <PositionGrid v-model="settings.position" />
          </div>
          <div v-if="wmMode === 'image'" class="setting">
            <div class="label">水印大小<span class="tip">占图片宽度 {{ settings.scalePct }}%</span></div>
            <el-slider v-model="settings.scalePct" :min="5" :max="100" :step="1" />
          </div>
          <div class="setting">
            <div class="label">边距<span class="tip">图片宽度的 {{ settings.marginPct }}%</span></div>
            <el-slider v-model="settings.marginPct" :min="0" :max="15" :step="0.5" />
          </div>
          <div class="setting">
            <div class="label">不透明度<span class="tip">{{ settings.opacity }}%</span></div>
            <el-slider v-model="settings.opacity" :min="10" :max="100" :step="1" />
          </div>
        </el-card>

        <el-button
          type="primary"
          size="large"
          class="export-btn"
          :icon="Download"
          :loading="exporting"
          :disabled="!rawImages.length || !wmSource"
          @click="requestExport"
        >
          {{ exporting ? `正在导出 ${progress.done}/${progress.total}…` : `导出${rawImages.length ? `（${rawImages.length} 张）` : ''}` }}
        </el-button>
        <el-progress
          v-if="exporting && progress.total > 1"
          :percentage="Math.round((progress.done / progress.total) * 100)"
        />
      </section>
    </main>

    <el-dialog v-model="exportDialog.visible" title="导出设置" width="420px">
      <div class="quality-label">
        导出质量
        <span class="tip">仅对 JPEG / WebP 生效，PNG 始终无损导出</span>
      </div>
      <el-radio-group v-model="exportDialog.quality">
        <el-radio-button value="low">低</el-radio-button>
        <el-radio-button value="mid">中</el-radio-button>
        <el-radio-button value="high">高（原图）</el-radio-button>
      </el-radio-group>
      <div class="quality-caption">{{ qualityCaptions[exportDialog.quality] }}</div>
      <div class="export-info">
        将导出 {{ rawImages.length }} 张图片{{ rawImages.length > 1 ? '，打包为 ZIP' : '，直接下载' }}。
      </div>
      <template #footer>
        <el-button @click="exportDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="exporting" :icon="Download" @click="confirmExport">开始导出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style>
/* 全局重置：去掉 body 默认外边距，避免页面四周出现白边 */
body {
  margin: 0;
  background: #f5f7fa;
}
</style>

<style scoped>
.page {
  min-height: 100vh;
  background: #f5f7fa;
}
.header {
  padding: 20px 32px 0;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 22px;
  color: #409eff;
}
.title-icon {
  color: #409eff;
}
.header p {
  margin: 4px 0 0;
  color: #909399;
  font-size: 13px;
}
.layout {
  display: flex;
  gap: 16px;
  padding: 16px 32px 32px;
  align-items: flex-start;
}
.panel {
  width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.export-btn {
  width: 100%;
}
.wm-mode {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #409eff;
}
.card-header :deep(.el-icon),
.preview-title :deep(.el-icon) {
  color: #409eff;
}
.preview-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #409eff;
}
.tip {
  color: #909399;
  font-size: 12px;
  font-weight: normal;
}
.setting {
  margin-bottom: 20px;
}
.setting.text-input {
  margin-bottom: 16px;
}
.font-select {
  width: 100%;
}
.font-label {
  justify-content: flex-start;
  align-items: center;
  gap: 6px;
}
.font-label :deep(.el-icon) {
  color: #409eff;
}
.setting.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.setting.row .label {
  margin-bottom: 0;
}
.setting:last-child {
  margin-bottom: 4px;
}
.setting .label {
  margin-bottom: 10px;
  font-size: 14px;
  color: #303133;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.wm-preview img {
  max-height: 120px;
  max-width: 100%;
  border-radius: 4px;
  background: conic-gradient(#f0f2f5 25%, #fff 0 50%, #f0f2f5 0 75%, #fff 0) 0 0 / 16px 16px;
}
.wm-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
}
.preview {
  flex: 1;
  min-width: 0;
  position: sticky;
  top: 16px;
}
.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.preview-stage {
  display: flex;
  justify-content: center;
  border-radius: 4px;
  padding: 8px;
  background: conic-gradient(#f0f2f5 25%, #fff 0 50%, #f0f2f5 0 75%, #fff 0) 0 0 / 20px 20px;
  user-select: none;
  cursor: pointer;
}
.preview-canvas {
  max-width: 100%;
  max-height: 60vh;
  display: block;
  box-shadow: 0 0 0 1px #dcdfe6 inset;
}
.thumb-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin-top: 12px;
  padding: 2px;
}
.thumb-strip img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
  flex-shrink: 0;
  background: conic-gradient(#f0f2f5 25%, #fff 0 50%, #f0f2f5 0 75%, #fff 0) 0 0 / 12px 12px;
}
.thumb-strip img.active {
  border-color: #409eff;
}
.quality-label {
  margin-bottom: 16px;
  font-size: 14px;
  color: #303133;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quality-caption {
  margin-top: 12px;
  color: #909399;
  font-size: 12px;
}
.export-info {
  margin-top: 28px;
  color: #909399;
  font-size: 12px;
}
@media (max-width: 900px) {
  .layout {
    flex-direction: column;
  }
  .panel {
    width: 100%;
  }
  .preview {
    position: static;
    width: 100%;
  }
}
</style>
