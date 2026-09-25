# 图片水印工具

纯前端图片加水印工具：支持图片水印和文字水印，九宫格选择位置，可调大小 / 边距 / 不透明度，批量导出。所有处理均在浏览器本地完成，图片不经过任何服务器。

技术栈：Vue 3 + Vite + Element Plus + 原生 Canvas + JSZip，HEIC 支持（heic2any 按需加载）。

## 功能

- **两种水印**：图片水印（支持透明 PNG / HEIC）或文字水印（思源黑体 / 宋体、霞鹜文楷等字体可选，字号、颜色、描边可调；字体文件经 jsDelivr 按需加载）
- **九宫格 9 个位置**（含左上 / 上 / 右上 / 左下 / 下 / 右下）
- **精细调节**：水印大小按目标图宽度百分比缩放、边距、不透明度
- **实时预览**：缩略图条切换预览不同图片，按住预览图临时查看无水印原图
- **设置记忆**：水印图（IndexedDB）与全部参数（localStorage）自动保存，下次打开自动恢复
- **批量上传**：多选、拖拽、整个文件夹拖入
- **HEIC 支持**：iPhone 照片可直接使用（heic2any 按需动态加载，不影响首屏体积）
- **导出**：导出前弹窗选择质量（低 / 中 / 高（原图），仅对 JPEG/WebP 生效，PNG 无损），保留原格式与原图分辨率，多张打包 ZIP，输出文件名为 `原名_watermark.扩展名`

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build    # 产物在 dist/
npm run preview  # 本地预览构建产物
```

## 部署到 Vercel

- 方式一：代码推到 GitHub 后，在 vercel.com 导入仓库，框架会自动识别为 Vite（构建命令 `npm run build`，输出目录 `dist`），直接点部署即可。
- 方式二：命令行 `npm i -g vercel && vercel`。

纯静态站点，不需要任何环境变量或服务端配置。

## 测试素材

`test-assets/` 下有脚本生成的示例图（`target.jpg`、`target2.jpg`、`watermark.png`），可直接用来试用；`gen.ps1` 是生成它们的 PowerShell 脚本。
