import { readEml, parseEml } from 'eml-parse-js'
import type { ReadedEmlJson, ParsedEmlJson } from 'eml-parse-js'
import { Browser } from 'happy-dom'
import fs from 'node:fs'
import util from 'node:util'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { chunkArray } from './utils.ts'

dayjs.extend(customParseFormat)

export interface BankTransaction {
  date: string
  summary: string
  amount: string | number // 真实账单金额，需要符合几个要求：与支付金额一致，能表达支出、收入信息
  location?: string
  card?: string
  [key: string]: unknown
}

type CMBTransactionType = '' | '还款' | '分期' | '消费'
// 招行电子邮件账单 eml 解析
export async function parseCMBEml(emlfile: string) {
  if (!fs.existsSync(emlfile)) {
    console.error('eml 文件不存在')
    process.exit(1)
  }

  const content = fs.readFileSync(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadedEmlJson

  if (typeof emlJson.html === 'string') {
    const html = emlJson.html

    const browser = new Browser()
    const page = browser.newPage()
    page.content = html
    const trs = page.mainFrame.document.body.querySelectorAll('.bgTable tr tr')
    const originalTransactionData = Array.from(trs).map(tr => {
      return Array.from(tr.children).map(child => child.textContent)
    })

    await browser.close()

    let mode: CMBTransactionType = ''

    /**
     * [
     * 空白,
     * 交易日,
     * 记账日,
     * 交易摘要,
     * ￥ 人民币金额(支出是正数，收入是负数),
     * 卡号后四位,
     * 交易地金额（可能是外币）,
     * 交易地,
     * ]
     */
    const transactionsOfBank: BankTransaction[] = originalTransactionData.map((trans) => {
      if (trans.length === 1) {
        mode = trans[0].trim() as unknown as CMBTransactionType
      } else {
        // 优先使用交易日
        const [_, tradeDate, recordDate, summary, RMBAmount, card, originalAmount, , location = 'CN'] = trans
        const [RMBSymbol, amountStr] = RMBAmount.split(' ').map(item => item.trim())
        if (mode === '还款') {
          // 招行账单还款记为负数
          const amount = Math.abs(Number(amountStr))
          return {
            date: dayjs(tradeDate || recordDate, 'MMDD').format('YYYY-MM-DD'),
            amount,
            summary,
            card,
            location,
            originalAmount,
          }
        } else if (mode === '分期') {
          // 分期暂时不处理
        } else if (mode === '消费') {
          // 招行账单消费记为正数
          const amount = -Math.abs(Number(amountStr))
          return {
            date: dayjs(tradeDate || recordDate, 'MMDD').format('YYYY-MM-DD'),
            amount,
            summary,
            card,
            location,
            originalAmount,
          }
        }
      }
      return null
    }).filter(item => item !== null).toSorted((a, b) => dayjs(a.date).diff(dayjs(b.date)))

    return {
      transactionsOfBank,
      html,
      emlJson,
    }
  }
  return {
    transactionsOfBank: [],
    html: '',
    emlJson,
  }
}

// 交通银行电子邮件账单 eml 解析
export async function parseBOCOMEml(emlfile: string) {
  if (!fs.existsSync(emlfile)) {
    console.error('eml 文件不存在')
    process.exit(1)
  }

  const content = fs.readFileSync(emlfile, 'utf-8')

  const emlJson = parseEml(content) as ParsedEmlJson

  //交通银行 html 原始编码就是 gbk
  if (typeof emlJson.body === 'string') {
    const decoder = new util.TextDecoder('gbk')
    const html = decoder.decode(Buffer.from(emlJson.body, 'base64')).replaceAll('charset=gbk', 'charset=utf-8')

    const browser = new Browser()
    const page = browser.newPage()
    page.content = html
    const strings = page.mainFrame.document.body.textContent.split('\n').map(str => str.trim()).filter(str => str.length > 0)
    const repayTitleIndex = strings.indexOf('还款、退货、费用返还明细')
    const transactionTitleIndex = strings.indexOf('消费、取现、其他费用明细')
    const repayListTrs = chunkArray(strings.slice(repayTitleIndex + 7, transactionTitleIndex), 6)
    const takeListTrs = chunkArray(strings.slice(transactionTitleIndex + 8, strings.indexOf('用卡无忧尊享版')), 6)

    await browser.close()

    /**
     * [
     * 交易日,
     * 记账日,
     * 卡号后四位,
     * 交易说明,
     * CNY交易金额,
     * CNY入账金额,
     * ]
     */
    const transactionsOfBank: BankTransaction[] = repayListTrs.map((trans) => {
      // 优先使用交易日
      const [tradeDate, recordDate, card, summary, tradeAmountStr, originalAmountStr] = trans
      // 前三位是交易金额的符号，需要去掉
      const amountStr = tradeAmountStr.substring(3)
      const amount = Number(amountStr)
      return {
        date: dayjs(tradeDate || recordDate, 'MM/DD').format('YYYY-MM-DD'),
        amount,
        summary,
        card,
        originalAmount: originalAmountStr.substring(3),
      }
    }).concat(takeListTrs.map((trans) => {
      // 优先使用交易日
      const [tradeDate, recordDate, card, summary, tradeAmountStr, originalAmountStr] = trans
      // 前三位是交易金额的符号，需要去掉
      const amountStr = tradeAmountStr.substring(3)
      const amount = -Number(amountStr)
      return {
        date: dayjs(tradeDate || recordDate, 'MM/DD').format('YYYY-MM-DD'),
        amount,
        summary,
        card,
        originalAmount: originalAmountStr.substring(3),
      }
    })).toSorted((a, b) => dayjs(a.date).diff(dayjs(b.date)))

    return {
      transactionsOfBank,
      html,
      emlJson,
    }
  }
  return {
    transactionsOfBank: [],
    html: '',
    emlJson,
  }
}
