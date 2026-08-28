import { tableToPdfDocument } from '@/tableToPdf'
import css from './style.css?inline'

const genTable = <T>(
  columns: { title: string; prop?: keyof T | string }[],
  data: T[]
) => {
  let iframe = window.document.createElement('iframe')
  iframe.style.cssText = 'position: fixed; bottom: -9999px; right: -9999px; visibility: hidden'
  // iframe.style.cssText = 'position: fixed; top: 0; left: 0; overflow: auto; background: white; z-index: 1000; height: 100vh; width: 100vw'
  window.document.body.appendChild(iframe)
  const document = iframe.contentDocument!

  const style = document.createElement('style')
  style.innerHTML = css
  document.head.appendChild(style)

  const table = document.createElement('table')
  table.classList.add('params-table-pdf-uHjiO9')

  const thead = `<tr class="tr-head">\n${columns
    .map((i) => `<th>${i.title}</th>`)
    .join('\n')}\n</tr>\n`
  const empty = `<tr><th colspan="${columns.length}"><div style="line-height: 50px; color: #909399">暂无数据</div></th></tr>`
  const splitLine = `<tr style="border: none;"><th style="border: none;" colspan="${columns.length}"><div style="height: 20px;"></div></th></tr>`

  let html = ''

  html += `<tr><th colspan="${columns.length}" style="font-weight: bold; text-align: left;">变前后参数</th></tr>\n`
  html += thead
  html += splitLine

  html += `<tr><th colspan="${columns.length}" style="font-weight: bold; text-align: left;">所有参数</th></tr>\n`
  html += thead
  const allRowsHTML = data.length <= 0
    ? empty
    : data
      .map((row) => {
        const tds = columns.map((col) => `<td>${row[col.prop as keyof T] || ''}</td>`)
        return `<tr>\n${tds.join('\n')}\n</tr>`
      })
      .join('\n')
  html += allRowsHTML + '\n'

  table.innerHTML = html
  document.body.appendChild(table)

  return {
    table,
    clear: () => {
      window.document.body.removeChild(iframe);
      (iframe as any) = undefined
    },
  }
}

interface Row {
  name: string
  value: string
  address?: string
}

const shortAddr = '短地址'
const longAddr = '长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址长地址'
const rows: Row[] = Array(1000).fill(0).map((_, i) => ({
  name: '名称' + i,
  value: '值' + i,
  address: i % 3 === 0 ? longAddr : shortAddr
}))

const run = async () => {
  const { table, clear } = genTable(
    [
      { title: '名称', prop: 'name' },
      { title: '值', prop: 'value' },
      { title: '地址', prop: 'address' },
    ],
    rows
  )
  const doc = await tableToPdfDocument(table, css)
  doc.save('1.pdf')
  clear()
}

document.querySelector('button')!.addEventListener('click', run)
