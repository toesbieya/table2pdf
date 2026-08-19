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
 * 支持生成超过32767大小的图片，但是需要手动用canvas拼接图像
 * @param dom
 * @param options
 */
async function domToMultipleCanvas(dom: HTMLElement, options: DomToImageOptions) {
  const { width, height } = options
  const ratio = window.devicePixelRatio

  console.debug(`dom尺寸 width: ${width}, height: ${height}`)

  // 待分割的图像
  console.time('svgToDataUrl')
  const svgUrl = await svgToDataUrl(domToSvg(dom, options))
  console.timeEnd('svgToDataUrl')
  console.time('createImage')
  const img = await createImage(svgUrl)
  console.debug('生成的图像大小', img.width, img.height)
  console.timeEnd('createImage')

  console.time('split canvas')
  // canvas最大高度，超过此高度的图像，将会被分割为多个canvas
  const canvasList: OffscreenCanvas[] = []
  const canvasMaxHeight = 16384
  const canvasWidth = width * ratio

  // 注意由于drawImage是直接使用的图片元素，所以splitPositionY和canvas缩放没有关系，是图片的原始像素
  let splitPositionY = 0, renderHeight = height * ratio
  while (renderHeight > 0) {
    const canvasHeight = Math.min(canvasMaxHeight, renderHeight)
    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight)
    const ctx = canvas.getContext('2d', { alpha: false })!
    ctx.scale(ratio, ratio)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, splitPositionY, canvasWidth, canvasHeight, 0, 0, canvasWidth, canvasHeight)
    canvasList.push(canvas)

    splitPositionY += canvasHeight / ratio
    renderHeight -= canvasHeight

    await sleep()
  }
  console.timeEnd('split canvas')

  console.debug(`拆分为${ canvasList.length }个canvas：${ canvasList.map(i => i.height).join('、') }`)

  return function drawImageToTargetCanvas(targetCtx: CanvasRenderingContext2D, sx: number, sy: number, sWidth: number, sHeight: number, dx: number, dy: number, dWidth: number, dHeight: number) {
    // 先分割第一个canvas
    const startIndex = Math.floor(sy / canvasMaxHeight)
    // 这里的sy是相对于所有canvas拼起来后的，所以需要转换为相对于第一个要分割的canvas的sy
    sy -= startIndex * canvasMaxHeight
    const firstItem = canvasList[startIndex]
    const firstSplitHeight = Math.min(sHeight, firstItem.height - sy)
    targetCtx.drawImage(firstItem, sx, sy, sWidth, firstSplitHeight, dx, dy, sWidth, firstSplitHeight)

    // 第一个分完还需要继续分后面的canvas
    let remainHeight = sHeight - firstSplitHeight
    let index = startIndex + 1
    while (remainHeight > 0) {
      const item = canvasList[index]
      const splitHeight = Math.min(remainHeight, item.height)
      targetCtx.drawImage(item, sx, 0, sWidth, splitHeight, dx, dy + sHeight - remainHeight, sWidth, splitHeight)

      remainHeight -= splitHeight
      index++
    }
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

  // const canvas = await domToCanvas(table, { css, width: elWidth, height: elHeight })
  const drawImageToTargetCanvas = await domToMultipleCanvas(table, { css, width: elWidth, height: elHeight })

  await sleep()

  // 用于截取主canvas的图像
  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = elWidth * dpr
  tempCanvas.height = 100
  const tempCtx = tempCanvas.getContext('2d')!

  for (let i = 0; i < pages.length; i++) {
    const [startPosition, endPosition] = pages[i]
    const height = endPosition - startPosition

    tempCanvas.height = height * dpr
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height)

    console.time(`drawImageToTargetCanvas 第${ i + 1 }页`)
    // tempCtx.drawImage(canvas, 0, startPosition * dpr, tempCanvas.width, tempCanvas.height, 0, 0, tempCanvas.width, tempCanvas.height)
    drawImageToTargetCanvas(tempCtx, 0, startPosition * dpr, tempCanvas.width, tempCanvas.height, 0, 0, tempCanvas.width, tempCanvas.height)
    console.timeEnd(`drawImageToTargetCanvas 第${ i + 1 }页`)

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
