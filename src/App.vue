<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox, genFileId } from 'element-plus'
import { CircleCloseFilled, Delete, Download, Loading, Moon, Picture, Plus, Setting, Stamp, Star, Sunny, UploadFilled, View } from '@element-plus/icons-vue'
import JSZip from 'jszip'
import PositionGrid from './components/PositionGrid.vue'
import { composite, downloadBlob, loadBitmap, processFile } from './utils/image'
import { filesFromDataTransfer, isImageFile } from './utils/files'
import { idbDelete, idbGet, idbSet } from './utils/store'

const SETTINGS_KEY = 'iw-settings'

const exporting = ref(false)
const progress = reactive({ done: 0, total: 0 })

const wmMode = ref('image') // image | text
const watermarkUrl = ref('')
const watermarkBitmap = shallowRef(null)
const watermarkInfo = ref('')

const fileList = ref([])
const imagesInputRef = ref(null)
const rawImages = computed(() => fileList.value.map((f) => f.raw).filter(Boolean))

const settings = reactive({
  position: 'bottom-right',
  scalePct: 20,
  marginPct: 2,
  opacity: 100,
  layout: 'single',
  rotation: 0,
  tileGapPct: 50,
  shadowPct: 0,
})

// ---------- 预设：保存 / 应用 / 删除 ----------
const PRESETS_KEY = 'iw-presets'
const presets = ref([])
const selectedPreset = ref('')

function persistPresets() {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.value))
  } catch {
    /* 忽略存储错误 */
  }
}

function applyPreset(name) {
  const p = presets.value.find((x) => x.name === name)
  if (!p) return
  wmMode.value = p.wmMode
  Object.assign(settings, p.settings)
  Object.assign(textSettings, p.textSettings)
  if (wmMode.value === 'text' && textSettings.font !== 'system') {
    ensureFont(textSettings.font, textSettings.content).then(schedulePreview)
  }
  ElMessage.success(`已应用预设「${p.name}」`)
}

async function savePreset() {
  const current = presets.value.find((x) => x.name === selectedPreset.value)
  try {
    const { value } = await ElMessageBox.prompt('保存当前的水印模式、位置、大小、边距、透明度及文字设置', '保存预设', {
      inputValue: current?.name ?? '',
      inputPattern: /\S/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    })
    const name = value.trim()
    const preset = {
      name,
      wmMode: wmMode.value,
      settings: { ...settings },
      textSettings: { ...textSettings },
    }
    const idx = presets.value.findIndex((x) => x.name === name)
    if (idx >= 0) presets.value[idx] = preset
    else presets.value.push(preset)
    selectedPreset.value = name
    persistPresets()
    ElMessage.success(idx >= 0 ? `预设「${name}」已更新` : `预设「${name}」已保存`)
  } catch {
    /* 用户取消 */
  }
}

function removePreset() {
  const name = selectedPreset.value
  if (!name) return
  presets.value = presets.value.filter((x) => x.name !== name)
  selectedPreset.value = ''
  persistPresets()
  ElMessage.success(`预设「${name}」已删除`)
}
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
    // 必须等样式表加载完、@font-face 注册后，fonts.load 才能真正触发分片下载
    await new Promise((resolve) => {
      link.onload = resolve
      link.onerror = resolve // 样式表加载失败时也继续，用回退字体渲染
      document.head.appendChild(link)
    })
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
const exportDialog = reactive({ visible: false, quality: 'high', nameTemplate: '{name}_watermark', keepExif: false })
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
// 首次使用提示：点"知道了"或实际按住过一次后永久隐藏
const holdHintVisible = ref(true)
try {
  holdHintVisible.value = localStorage.getItem('iw-hold-hint') !== '1'
} catch {
  holdHintVisible.value = true
}
function dismissHoldHint() {
  holdHintVisible.value = false
  try {
    localStorage.setItem('iw-hold-hint', '1')
  } catch {
    /* 忽略存储错误 */
  }
}
const thumbs = ref([])

let previewTimer = null
function schedulePreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(renderPreview, 120)
}

watch([previewFile, wmSource], schedulePreview, { flush: 'post' })
watch(settings, schedulePreview, { deep: true, flush: 'post' })

let renderSeq = 0
// 解码结果按文件缓存：滑块高频重绘时避免反复解码大图
const previewBitmapCache = { file: null, bitmap: null }
async function getPreviewBitmap(file) {
  if (previewBitmapCache.file === file && previewBitmapCache.bitmap) return previewBitmapCache.bitmap
  previewBitmapCache.bitmap?.close?.()
  const bitmap = await loadBitmap(file)
  previewBitmapCache.file = file
  previewBitmapCache.bitmap = bitmap
  return bitmap
}

async function renderPreview() {
  const canvas = previewCanvas.value
  const file = previewFile.value
  if (!canvas || !file) return
  const seq = ++renderSeq
  try {
    const bitmap = await getPreviewBitmap(file)
    const tw = bitmap.naturalWidth || bitmap.width
    const th = bitmap.naturalHeight || bitmap.height
    // 按"显示尺寸 × 设备像素比"渲染：视觉与原图一致，又不必全分辨率渲染
    const stage = canvas.parentElement
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const availW = Math.max(100, (stage?.clientWidth ?? 800) - 16)
    const availH = Math.max(100, window.innerHeight * 0.6)
    const s = Math.min(1, (availW * dpr) / tw, (availH * dpr) / th)
    const c = composite(bitmap, showOriginal.value ? null : wmSource.value, settings, availW * dpr, availH * dpr)
    if (seq !== renderSeq) return
    canvas.width = c.width
    canvas.height = c.height
    if (s < 1) {
      canvas.style.width = `${Math.round(c.width / dpr)}px`
      canvas.style.height = `${Math.round(c.height / dpr)}px`
    } else {
      canvas.style.width = ''
      canvas.style.height = ''
    }
    canvas.getContext('2d').drawImage(c, 0, 0)
    previewInfo.value = `原图 ${tw} × ${th}`
  } catch (e) {
    console.error(e)
    if (seq === renderSeq) {
      previewInfo.value = ''
      ElMessage.error('这张图片无法在浏览器中解码（可能是损坏的文件），已跳过预览')
    }
  }
}

function onWindowResize() {
  schedulePreview()
}
window.addEventListener('resize', onWindowResize)

// 按住看原图
function previewDown() {
  if (!wmSource.value) return
  showOriginal.value = true
  dismissHoldHint()
  renderPreview()
}
function previewUp() {
  if (!showOriginal.value) return
  showOriginal.value = false
  renderPreview()
}

// 缩略图条：给每张目标图建一个 object URL，列表变化时回收旧的
watch(() => fileList.value.map((f) => ({ raw: f.raw, uid: f.uid })), (items) => {
  thumbs.value.forEach((t) => URL.revokeObjectURL(t.url))
  thumbs.value = items
    .filter((it) => it.raw)
    .map((it) => ({ name: it.raw.name, uid: it.uid, url: URL.createObjectURL(it.raw) }))
  if (previewIndex.value >= thumbs.value.length) previewIndex.value = Math.max(0, thumbs.value.length - 1)
})

// ---------- 导出勾选：默认全部参与，可取消勾选跳过 ----------
const excludedUids = ref(new Set())
const includedImages = computed(() =>
  fileList.value.filter((f) => f.raw && !excludedUids.value.has(f.uid)).map((f) => f.raw),
)
function isExcluded(uid) {
  return excludedUids.value.has(uid)
}
function toggleExclude(uid) {
  const next = new Set(excludedUids.value)
  if (next.has(uid)) next.delete(uid)
  else next.add(uid)
  excludedUids.value = next
}
const allSelected = computed(
  () => thumbs.value.length > 0 && includedImages.value.length === thumbs.value.length,
)
const someSelected = computed(
  () => includedImages.value.length > 0 && includedImages.value.length < thumbs.value.length,
)
function toggleAll(checked) {
  excludedUids.value = checked ? new Set() : new Set(thumbs.value.map((t) => t.uid))
}

// ---------- 进度恢复：未导出的图片列表存 IndexedDB，导出成功即清除 ----------
watch(() => fileList.value.map((f) => f.raw), (files) => {
  if (!files.length) {
    idbDelete('progress').catch(() => {})
    return
  }
  idbSet('progress', files).catch(() => {})
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

// ---------- 添加图片（预览区点击 / 缩略图"+"按钮 / 拖拽文件夹） ----------
function addImages(files) {
  for (const f of files) {
    if (!isImageFile(f)) continue
    fileList.value.push({ name: f.name, raw: f, uid: genFileId(), status: 'ready' })
  }
}

function openImagesPicker() {
  imagesInputRef.value?.click()
}

function onImagesChange(e) {
  addImages([...(e.target.files ?? [])])
  e.target.value = '' // 清空以便下次能选同一文件
}

function removeImage(index) {
  fileList.value.splice(index, 1)
}

// ---------- 文件夹拖入 ----------
async function onDropCapture(e) {
  const dt = e.dataTransfer
  if (!dt) return
  // entry 必须在事件回调里同步取出，事件结束后 dataTransfer 不可读
  const entries = [...(dt.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean)
  if (!entries.some((en) => en.isDirectory)) return // 普通文件拖拽交给浏览器原生行为
  e.preventDefault()
  e.stopPropagation()
  const files = await filesFromDataTransfer(dt, entries)
  addImages(files)
  if (files.length) ElMessage.success(`已从文件夹添加 ${files.length} 张图片`)
}

// ---------- 设置记忆 ----------
let saveTimer = null
watch([wmMode, settings, textSettings, exportDialog], () => {
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
          nameTemplate: exportDialog.nameTemplate,
          keepExif: exportDialog.keepExif,
        }),
      )
    } catch {
      /* 存储空间不足等情况忽略 */
    }
  }, 300)
}, { deep: true })

// ---------- 深浅色主题 ----------
const THEME_KEY = 'iw-theme'
const isDark = ref(false)

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0a' : '#409eff')
}

watch(isDark, (dark) => {
  applyTheme(dark)
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  } catch {
    /* 忽略存储错误 */
  }
})

onMounted(async () => {
  // 恢复主题：没存过偏好时跟随系统
  let saved = null
  try {
    saved = localStorage.getItem(THEME_KEY)
  } catch {
    /* 忽略存储错误 */
  }
  isDark.value = saved ? saved === 'dark' : !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  applyTheme(isDark.value)

  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    if (saved.wmMode === 'image' || saved.wmMode === 'text') wmMode.value = saved.wmMode
    Object.assign(settings, saved.settings ?? {})
    Object.assign(textSettings, saved.textSettings ?? {})
    if (['low', 'mid', 'high'].includes(saved.quality)) exportDialog.quality = saved.quality
    if (typeof saved.nameTemplate === 'string' && saved.nameTemplate.trim()) exportDialog.nameTemplate = saved.nameTemplate
    if (typeof saved.keepExif === 'boolean') exportDialog.keepExif = saved.keepExif
  } catch {
    /* 配置损坏时用默认值 */
  }
  try {
    const list = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]')
    if (Array.isArray(list)) presets.value = list.filter((p) => p && p.name)
  } catch {
    /* 预设损坏时忽略 */
  }
  if (wmMode.value === 'text' && textSettings.font !== 'system') {
    ensureFont(textSettings.font, textSettings.content).then(schedulePreview)
  }
  try {
    const stored = await idbGet('progress')
    if (Array.isArray(stored) && stored.length) {
      try {
        await ElMessageBox.confirm(
          `上次有 ${stored.length} 张图片还没有导出，要恢复继续处理吗？`,
          '发现未导出的进度',
          { confirmButtonText: '恢复', cancelButtonText: '不恢复', type: 'info' },
        )
        addImages(stored)
        ElMessage.success('已恢复上次的图片列表')
      } catch {
        // 不恢复：清掉存储，避免下次再问
        await idbDelete('progress').catch(() => {})
      }
    }
  } catch {
    /* 读取失败忽略 */
  }
  try {
    const blob = await idbGet('watermark')
    if (blob) await setWatermarkFile(blob)
  } catch {
    /* 无持久化水印或读取失败则跳过 */
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  previewBitmapCache.bitmap?.close?.()
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
  if (!includedImages.value.length) {
    ElMessage.warning(rawImages.value.length ? '请至少勾选一张要导出的图片' : '请先上传待处理图片')
    return
  }
  exportDialog.visible = true
}

async function exportAll(overrides = {}) {
  const files = includedImages.value
  const wm = wmSource.value
  exporting.value = true
  progress.total = files.length
  progress.done = 0
  const exportSettings = { ...settings, ...overrides }
  const failed = []
  try {
    if (files.length === 1) {
      try {
        const { blob, filename } = await processFile(files[0], wm, exportSettings, 0)
        downloadBlob(blob, filename)
      } catch (e) {
        console.error(e)
        failed.push(files[0].name)
      }
      progress.done = 1
    } else {
      const zip = new JSZip()
      for (const [i, file] of files.entries()) {
        try {
          const { blob, filename } = await processFile(file, wm, exportSettings, i)
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
      // 导出成功即视为进度已消费，清除未导出记录
      idbDelete('progress').catch(() => {})
    }
  } finally {
    exporting.value = false
  }
}

async function confirmExport() {
  exportDialog.visible = false
  await exportAll({
    quality: QUALITY_MAP[exportDialog.quality],
    nameTemplate: exportDialog.nameTemplate,
    keepExif: exportDialog.keepExif,
  })
}
</script>

<template>
  <div class="page">
    <header class="header">
      <div class="header-row">
        <div>
          <h1 class="title"><el-icon class="title-icon"><Stamp /></el-icon>图片水印工具</h1>
          <p>所有图片仅在你的浏览器本地处理，不会上传到任何服务器</p>
        </div>
        <el-switch
          v-model="isDark"
          inline-prompt
          :active-icon="Moon"
          :inactive-icon="Sunny"
          title="切换深浅色"
        />
      </div>
    </header>

    <main class="layout">
      <div class="left-col">
      <section class="preview">
        <el-card shadow="never" class="preview-card" @dragover.capture.prevent @drop.capture="onDropCapture">
          <template #header>
            <div class="preview-header">
              <div class="preview-title"><el-icon><View /></el-icon><b>实时预览</b></div>
              <span class="tip">{{ previewInfo }}</span>
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
          <div v-else class="preview-empty" @click="openImagesPicker">
            <el-empty description="点击上传图片，或拖拽图片 / 整个文件夹到这里" />
          </div>
          <div v-if="holdHintVisible && wmSource" class="hold-hint-bar">
            <span>小提示：按住图片可临时查看无水印原图</span>
            <el-button text size="small" @click="dismissHoldHint">知道了</el-button>
          </div>
          <div v-if="thumbs.length" class="thumb-strip">
            <div v-for="(t, i) in thumbs" :key="t.url" class="thumb-item">
              <img
                :src="t.url"
                :title="t.name"
                :class="{ active: i === previewIndex }"
                @click="previewIndex = i"
              />
              <el-icon class="thumb-remove" title="移除这张图片" @click.stop="removeImage(i)">
                <CircleCloseFilled />
              </el-icon>
            </div>
            <div class="thumb-add" title="添加图片" @click="openImagesPicker">
              <el-icon><Plus /></el-icon>
            </div>
          </div>
          <input
            ref="imagesInputRef"
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            hidden
            @change="onImagesChange"
          />
        </el-card>
      </section>
      </div>

      <section class="panel">
        <el-button
          type="primary"
          size="large"
          class="export-btn"
          :icon="Download"
          :loading="exporting"
          :disabled="!includedImages.length || !wmSource"
          @click="requestExport"
        >
          {{ exporting ? `正在导出 ${progress.done}/${progress.total}…` : `导出${includedImages.length ? `（${includedImages.length} 张）` : ''}` }}
        </el-button>
        <el-progress
          v-if="exporting && progress.total > 1"
          :percentage="Math.round((progress.done / progress.total) * 100)"
        />

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
            <div class="card-header"><el-icon><Setting /></el-icon><b>水印设置</b></div>
          </template>
          <div class="setting">
            <div class="label">预设</div>
            <div class="preset-row">
              <el-select
                v-model="selectedPreset"
                class="preset-select"
                placeholder="选择预设"
                clearable
                @change="applyPreset"
              >
                <el-option v-for="p in presets" :key="p.name" :label="p.name" :value="p.name" />
              </el-select>
              <el-button title="保存当前设置为预设" :icon="Star" @click="savePreset" />
              <el-button title="删除选中的预设" :icon="Delete" :disabled="!selectedPreset" @click="removePreset" />
            </div>
          </div>
          <div v-if="settings.layout === 'single'" class="setting">
            <div class="label">位置</div>
            <PositionGrid v-model="settings.position" />
          </div>
          <div class="setting">
            <div class="label">布局</div>
            <el-radio-group v-model="settings.layout">
              <el-radio-button value="single">单个</el-radio-button>
              <el-radio-button value="tile">平铺</el-radio-button>
            </el-radio-group>
          </div>
          <div class="setting">
            <div class="label">旋转角度</div>
            <el-slider
              v-model="settings.rotation"
              :min="-180"
              :max="180"
              :step="5"
              :marks="{ '-90': '-90°', 0: '0°', 90: '90°' }"
            />
          </div>
          <div v-if="wmMode === 'image'" class="setting">
            <div class="label">水印大小</div>
            <el-slider v-model="settings.scalePct" :min="5" :max="100" :step="1" />
          </div>
          <div v-if="settings.layout === 'single'" class="setting">
            <div class="label">边距</div>
            <el-slider v-model="settings.marginPct" :min="0" :max="15" :step="0.5" />
          </div>
          <div v-if="settings.layout === 'tile'" class="setting">
            <div class="label">平铺间距</div>
            <el-slider v-model="settings.tileGapPct" :min="0" :max="100" :step="5" />
          </div>
          <div class="setting">
            <div class="label">不透明度<span class="tip">{{ settings.opacity }}%</span></div>
            <el-slider v-model="settings.opacity" :min="10" :max="100" :step="1" />
          </div>
          <div class="setting">
            <div class="label">阴影</div>
            <el-slider v-model="settings.shadowPct" :min="0" :max="10" :step="0.5" />
          </div>
        </el-card>
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
      <div class="pick-header">
        <span class="pick-title">选择图片</span>
        <el-checkbox
          :model-value="allSelected"
          :indeterminate="someSelected"
          @change="toggleAll"
        >全选</el-checkbox>
      </div>
      <div class="img-pick-list">
        <div
          v-for="t in thumbs"
          :key="t.uid"
          class="img-pick-item"
          :class="{ off: isExcluded(t.uid) }"
          @click="toggleExclude(t.uid)"
        >
          <img :src="t.url" />
          <span class="img-pick-name" :title="t.name">{{ t.name }}</span>
          <el-checkbox
            class="img-pick-check"
            :model-value="!isExcluded(t.uid)"
            @click.stop
            @change="toggleExclude(t.uid)"
          />
        </div>
      </div>
      <div class="quality-label name-field">
        文件名
        <span class="tip">支持 {name} 原文件名、{i} 序号、{date} 日期</span>
      </div>
      <el-input v-model="exportDialog.nameTemplate" placeholder="{name}_watermark" />
      <div class="quality-label name-field">
        保留照片信息（EXIF）
        <span class="tip">仅对 JPEG 生效；默认关闭，避免拍摄位置等敏感信息外泄</span>
      </div>
      <el-switch v-model="exportDialog.keepExif" />
      <div class="export-info">
        将导出 {{ includedImages.length }} 张图片{{ includedImages.length > 1 ? '，打包为 ZIP' : '，直接下载' }}。
      </div>
      <template #footer>
        <el-button @click="exportDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="exporting" :icon="Download" @click="confirmExport">开始导出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style>
/* 颜色变量：暗色模式在 html.dark 下覆盖 */
:root {
  --iw-page-bg: #f5f7fa;
  --iw-content-bg: #ffffff;
  --iw-border: #dcdfe6;
  --iw-text-primary: #303133;
  --iw-text-secondary: #909399;
  --iw-check-a: #f0f2f5;
  --iw-check-b: #ffffff;
}
html.dark {
  --iw-page-bg: #0a0a0a;
  --iw-content-bg: #141414;
  --iw-border: #4c4d4f;
  --iw-text-primary: #e5eaf3;
  --iw-text-secondary: #a3a6ad;
  --iw-check-a: #262727;
  --iw-check-b: #1d1d1d;
}
/* 全局重置：去掉 body 默认外边距，避免页面四周出现白边 */
body {
  margin: 0;
  background: var(--iw-page-bg);
}
</style>

<style scoped>
.page {
  min-height: 100vh;
  background: var(--iw-page-bg);
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
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.header p {
  margin: 4px 0 0;
  color: var(--iw-text-secondary);
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
  color: var(--iw-text-secondary);
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
.preset-row {
  display: flex;
  gap: 8px;
}
.preset-select {
  flex: 1;
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
  color: var(--iw-text-primary);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.wm-preview img {
  max-height: 120px;
  max-width: 100%;
  border-radius: 4px;
  background: conic-gradient(var(--iw-check-a) 25%, var(--iw-check-b) 0 50%, var(--iw-check-a) 0 75%, var(--iw-check-b) 0) 0 0 / 16px 16px;
}
.wm-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  color: var(--iw-text-secondary);
  font-size: 12px;
}
.left-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  background: conic-gradient(var(--iw-check-a) 25%, var(--iw-check-b) 0 50%, var(--iw-check-a) 0 75%, var(--iw-check-b) 0) 0 0 / 20px 20px;
  user-select: none;
  cursor: pointer;
}
.hold-hint-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 0 4px;
  color: var(--iw-text-secondary);
  font-size: 12px;
}
.preview-canvas {
  max-width: 100%;
  max-height: 60vh;
  display: block;
  box-shadow: 0 0 0 1px var(--iw-border) inset;
}
.preview-empty {
  cursor: pointer;
}
.thumb-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin-top: 12px;
  padding: 2px;
}
.thumb-item {
  position: relative;
  flex-shrink: 0;
}
.thumb-strip img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
  display: block;
  background: conic-gradient(var(--iw-check-a) 25%, var(--iw-check-b) 0 50%, var(--iw-check-a) 0 75%, var(--iw-check-b) 0) 0 0 / 12px 12px;
}
.thumb-strip img.active {
  border-color: #409eff;
}
.thumb-remove {
  position: absolute;
  top: -7px;
  right: -7px;
  font-size: 18px;
  color: var(--iw-text-secondary);
  background: var(--iw-content-bg);
  border-radius: 50%;
  cursor: pointer;
  display: none;
}
.thumb-item:hover .thumb-remove {
  display: block;
}
.thumb-remove:hover {
  color: #f56c6c;
}
.pick-header {
  margin-top: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: var(--iw-text-primary);
}
.pick-title {
  font-weight: 500;
}
.img-pick-list {
  margin-top: 8px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--iw-border);
  border-radius: 6px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.img-pick-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.img-pick-item:hover {
  background: var(--iw-check-a);
}
.img-pick-item.off img {
  opacity: 0.35;
}
.img-pick-item img {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.img-pick-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--iw-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.img-pick-check {
  height: auto;
}
.thumb-check :deep(.el-checkbox__inner::after) {
  height: 7px;
  left: 4px;
  top: 1px;
}
.thumb-add {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  border: 1px dashed var(--iw-border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--iw-text-secondary);
  cursor: pointer;
  font-size: 18px;
}
.thumb-add:hover {
  border-color: #409eff;
  color: #409eff;
}
.quality-label {
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--iw-text-primary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quality-caption {
  margin-top: 12px;
  color: var(--iw-text-secondary);
  font-size: 12px;
}
.name-field {
  margin-top: 16px;
}
.export-info {
  margin-top: 28px;
  color: var(--iw-text-secondary);
  font-size: 12px;
}
@media (max-width: 900px) {
  .layout {
    flex-direction: column;
  }
  .panel {
    width: 100%;
  }
}
</style>
