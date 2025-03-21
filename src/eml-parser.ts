import { readEml, parseEml } from 'eml-parse-js'
import type { ReadedEmlJson, ParsedEmlJson } from 'eml-parse-js'
import { Browser } from 'happy-dom'
import fs from 'node:fs'
import util from 'node:util'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { parse } from 'node-html-parser'

dayjs.extend(customParseFormat)

export interface BankTransaction {
  date: string
  summary: string
  amount: string | number // 真实账单金额，需要符合几个要求：与支付金额一致，能表达支出、收入信息
  location?: string
  card?: string
  [key: string]: unknown
}

// 农行电子邮件账单 eml 解析
export async function parseABCEml(emlfile: string) {
  if (!fs.existsSync(emlfile)) {
    console.error('eml 文件不存在')
    process.exit(1)
  }

  const content = fs.readFileSync(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadedEmlJson

  if (Array.isArray(emlJson.attachments)) {
    for (const att of emlJson.attachments) {
      if (att.contentType.includes('Text/HTML') && att.data64) {
        let html = ''
        const body = Buffer.from(att.data64, 'base64')
        if (typeof att.contentType === 'string' && (att.contentType.includes('gbk') || att.contentType.includes('gb2312'))) {
          const decoder = new util.TextDecoder('gbk')
          html = decoder.decode(body)
          html = html.replace("<meta http-equiv='Content-Type' content='text/html;charset=gbk'>", "<meta http-equiv='Content-Type' content='text/html;charset=utf-8'>")
        } else {
          html = body.toString()
        }
        const browser = new Browser()
        const page = browser.newPage()
        page.content = html
        const trs = page.mainFrame.document.body.querySelectorAll('#reportPanel3 #fixBand10 > table > tbody > tr > td > table > tbody > tr')
        const originalTransactionData = Array.from(trs).map(tr => {
          return Array.from(tr.querySelectorAll('td')).map(td => td.textContent)
        })

        await browser.close()

        /**
         * [
         * 空白,
         * 交易日,
         * 入账日,
         * 卡号后四位,
         * 交易摘要,
         * 交易地点,
         * 交易金额/币种,
         * 入账金额/币种（支出为-),
         * ]
         */

        const transactionsOfBank: BankTransaction[] = originalTransactionData.map(transaction => {
          const [_, date, __, card, summary, location, balance, amount] = transaction
          return {
            date: dayjs(date, 'YYYYMMDD').format('YYYY-MM-DD'),
            card,
            summary,
            location,
            amount,
            balance,
          }
        })

        return {
          transactionsOfBank,
          html,
          emlJson,
        }
      }
    }
  }

  return {
    transactionsOfBank: [],
    html: '',
    emlJson,
  }
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
    const repayListTrs = page.mainFrame.document.body.querySelectorAll('#repayList table tbody tr')
    const takeListTrs = page.mainFrame.document.body.querySelectorAll('#takeList table tbody tr')
    const repayList = Array.from(repayListTrs).map(tr => {
      return Array.from(tr.children).map(child => child.textContent)
    })
    const takeList = Array.from(takeListTrs).map(tr => {
      return Array.from(tr.children).map(child => child.textContent)
    })

    await browser.close()

    /**
     * [
     * 空白,
     * 交易日,
     * 记账日,
     * 卡号后四位,
     * 交易说明,
     * CNY交易金额,
     * CNY入账金额,
     * ]
     */
    const transactionsOfBank: BankTransaction[] = repayList.map((trans) => {
      // 优先使用交易日
      const [_, tradeDate, recordDate, card, summary, tradeAmountStr, originalAmountStr] = trans
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
    }).concat(takeList.map((trans) => {
      // 优先使用交易日
      const [_, tradeDate, recordDate, card, summary, tradeAmountStr, originalAmountStr] = trans
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

// 建设银行电子邮件账单 eml 解析
export async function parseCCBEml(emlfile: string) {
  if (!fs.existsSync(emlfile)) {
    console.error('eml 文件不存在')
    process.exit(1)
  }

  const content = fs.readFileSync(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadedEmlJson

  if (typeof emlJson.html === 'string') {
    const html = emlJson.html

    const root = parse(html)
    const target = Array.from(root.querySelectorAll('table')).find(table => table.querySelector('tr')?.textContent.includes('【交易明细】'))
    if (target) {

      /**
     * [
     * 交易日,
     * 记账日,
     * 卡号后四位,
     * 交易描述,
     * 交易币种,
     * 交易金额,
     * 结算币种,
     * 结算金额,
     * ]
     */
      const transactionsOfBank = Array.from(target.querySelectorAll('tr')).slice(4, -1).map(tr => {
        const [date, pDate, card, summary, tradeCurrency, tradeAmount, clearCurrency, clearAmount] = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())

        return {
          date: date || pDate,
          card,
          summary,
          // 建行支出记为正数，收入记为负数
          amount: -Number(clearAmount.replace(',', '')),
          tradeCurrency,
          tradeAmount,
          clearCurrency,
          clearAmount,
        }
      })

      return {
        transactionsOfBank,
        html,
        emlJson,
      }
    }
  }
  return {
    transactionsOfBank: [],
    html: '',
    emlJson,
  }
}
