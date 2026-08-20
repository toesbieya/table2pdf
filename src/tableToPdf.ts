import { jsPDF } from 'jspdf'

type DomToImageOptions = {
  css?: string
  width: number
  height: number
}

const sleep = () => new Promise(resolve => window.requestAnimationFrame(resolve))

function svgToDataUrl(svg: SVGElement): Promise<string> {
  return Promise.resolve()
    .then(() => new XMLSerializer().serializeToString(svg))
    .then(encodeURIComponent)
    .then((html) => `data:image/svg+xml;charset=utf-8,${ html }`)
}

function domToSvg(dom: HTMLElement, options: DomToImageOptions): SVGElement {
  const { css, width, height } = options

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', `${ width }`)
  svg.setAttribute('height', `${ height }`)
  svg.setAttribute('viewBox', `0 0 ${ width } ${ height }`)

  if (css) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.innerHTML = css
    svg.appendChild(style)
  }

  const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  foreignObject.setAttribute('width', '100%')
  foreignObject.setAttribute('height', '100%')
  foreignObject.setAttribute('x', '0')
  foreignObject.setAttribute('y', '0')
  foreignObject.setAttribute('externalResourcesRequired', 'true')
  foreignObject.appendChild(dom.cloneNode(true))
  svg.appendChild(foreignObject)

  return svg
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.src = url
  })
}

/**
 * dom转canvas，canvas的高度不能超过32767
 * @param dom
 * @param options
 */
function domToCanvas(dom: HTMLElement, options: DomToImageOptions): Promise<HTMLCanvasElement> {
  const { width, height } = options
  const canvas = document.createElement('canvas')
  const ratio = window.devicePixelRatio
  const maxSize = 32767
  canvas.width = width * ratio
  canvas.height = height * ratio

  if (canvas.width > maxSize || canvas.height > maxSize) {
    alert(`canvas大小：${ canvas.width }x${ canvas.height } 超出最大限制：${ maxSize }x${ maxSize }`)
  }

  const context = canvas.getContext('2d')!
  context.scale(ratio, ratio)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  return svgToDataUrl(domToSvg(dom, options))
    .then(createImage)
    .then(img => {
      context.drawImage(img, 0, 0, width, height)
      return canvas
    })
}

/**
 * canvas分块绘制的最大高度，超过此高度的单页切片需要分块拼接
 */
const canvasMaxHeight = 16384

/**
 * dom转图片，图片尺寸为dom的offsetWidth×offsetHeight（CSS像素）
 * @param dom
 * @param options
 */
const domToImage = async (dom: HTMLElement, options: DomToImageOptions): Promise<HTMLImageElement> => {
  const { width, height } = options

  console.debug(`dom尺寸 width: ${width}, height: ${height}`)

  console.time('svgToDataUrl')
  const svgUrl = await svgToDataUrl(domToSvg(dom, options))
  console.timeEnd('svgToDataUrl')
  console.time('createImage')
  const img = await createImage(svgUrl)
  console.debug('生成的图像大小', img.width, img.height)
  console.timeEnd('createImage')

  return img
}

/**
 * 把整图指定区域绘制到目标canvas
 * 目标canvas尺寸须为 width*dpr × height*dpr；区域高度超过canvas上限时自动分块绘制
 * @param img 整图
 * @param width 区域宽度（CSS px）
 * @param height 区域高度（CSS px）
 * @param startY 区域起始y（CSS px）
 * @param targetCtx 目标canvas上下文
 */
const drawTableSlice = (img: HTMLImageElement, width: number, height: number, startY: number, targetCtx: CanvasRenderingContext2D) => {
  const ratio = window.devicePixelRatio
  const targetWidth = width * ratio

  targetCtx.fillStyle = '#fff'
  targetCtx.fillRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height)

  // 高度未超过canvas上限，单次绘制
  if (targetCtx.canvas.height <= canvasMaxHeight) {
    targetCtx.drawImage(img, 0, startY, width, height, 0, 0, targetWidth, targetCtx.canvas.height)
    return
  }

  // 超过canvas上限，分块绘制后拼接
  let chunkStartY = startY, chunkTop = 0
  while (chunkTop < targetCtx.canvas.height) {
    const chunkHeight = Math.min(canvasMaxHeight, targetCtx.canvas.height - chunkTop)
    const chunk = new OffscreenCanvas(targetWidth, chunkHeight)
    const chunkCtx = chunk.getContext('2d', { alpha: false })!
    chunkCtx.fillStyle = '#fff'
    chunkCtx.fillRect(0, 0, chunk.width, chunk.height)
    chunkCtx.drawImage(img, 0, chunkStartY, width, chunkHeight / ratio, 0, 0, chunk.width, chunkHeight)
    targetCtx.drawImage(chunk, 0, chunkTop)
    chunkStartY += chunkHeight / ratio
    chunkTop += chunkHeight
  }
}

/**
 * 计算表格分页信息
 * 表格不支持thead、tbody标签
 * @param table
 * @param pageHeight 每页高度，单位px
 */
const getTablePageBreakPosition = (table: HTMLTableElement, pageHeight: number): [number, number][] => {
  // 每页的起始结束位置，单位px
  const pages: [number, number][] = [[0, 0]]
  let currentPage: number = 0

  const rows = table.querySelectorAll('tbody > tr') as NodeListOf<HTMLTableRowElement>

  for (let i = 0; i < rows.length; i++) {
    const page = pages[currentPage]
    const row = rows[i]
    const newEndPosition = page[1] + row.offsetHeight

    // 超出一页，下一页
    if (newEndPosition - page[0] > pageHeight) {
      pages.push([page[1], newEndPosition])
      // 确保被截断的两行中间的边框能完整显示
      page[1]++
      currentPage++
      continue
    }

    // 未超出，则增加当前页的截断位置
    page[1] = newEndPosition
  }

  // 表格实际高度是所有tr高度之和+1px边框
  pages[pages.length - 1][1]++

  console.debug(`表格分为${ pages.length }页:`, pages)

  return pages
}

/**
 * 表格转PDF文档
 * @param table 表格dom元素
 * @param css 表格的css样式文本
 */
export const tableToPdfDocument = async (table: HTMLTableElement, css?: string) => {
  // 不需要知道物理像素和实际像素的比值，只要控制宽高比例以jspdf为准的就好

  const dpr = window.devicePixelRatio
  const doc = new jsPDF({
    orientation: 'p',
    unit: 'pt',
    format: 'a4'
  })
  const { height: pageHeight, width: pageWidth } = doc.internal.pageSize
  const { offsetWidth: elWidth, offsetHeight: elHeight } = table
  console.debug('生成的表格大小', elWidth, elHeight)

  // 每页的padding距离值，相对单位
  const pagePadding = 5
  // a4宽度最大值，相对单位
  const maxContentWidth = pageWidth - pagePadding * 2
  // a4高度最大值，相对单位
  const maxContentHeight = pageHeight - pagePadding * 2
  // px转相对单位的比例
  const pxToRelative = maxContentWidth / elWidth

  console.time('getTablePageBreakPosition')
  const pages = getTablePageBreakPosition(table, Math.floor(maxContentHeight / pxToRelative))
  console.timeEnd('getTablePageBreakPosition')

  const img = await domToImage(table, { css, width: elWidth, height: elHeight })

  await sleep()

  // 用于截取整图的canvas
  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = elWidth * dpr
  tempCanvas.height = 100
  // alpha:false 保证与旧版分块烘焙效果一致（透明区域直接白底），且png不含alpha通道
  const tempCtx = tempCanvas.getContext('2d', { alpha: false })!

  for (let i = 0; i < pages.length; i++) {
    const [startPosition, endPosition] = pages[i]
    const height = endPosition - startPosition

    tempCanvas.height = height * dpr

    console.time(`drawTableSlice 第${ i + 1 }页`)
    drawTableSlice(img, elWidth, height, startPosition, tempCtx)
    console.timeEnd(`drawTableSlice 第${ i + 1 }页`)

    await sleep()

    // 传入canvas元素产生的pdf文件大小最小，使用imageData生成的会大20倍
    console.time(`addImage 第${ i + 1 }页`)
    // 传入alias避免jsdoc进行hash运算，此图片并不会重复使用
    doc.addImage(tempCanvas, 'png', pagePadding, pagePadding, maxContentWidth, Math.ceil(height * pxToRelative), i + '')
    console.timeEnd(`addImage 第${ i + 1 }页`)

    await sleep()

    i < pages.length - 1 && doc.addPage()
  }

  tempCanvas.remove()

  return doc
}
