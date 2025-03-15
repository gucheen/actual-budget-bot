import { readEml } from 'eml-parse-js'
import { Browser } from 'happy-dom'
import fs from 'node:fs'
import util from 'node:util'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(customParseFormat)

interface EmailAddress {
  name: string
  email: string
}

interface EmlHeaders {
  'Content-Type': string
  'Content-Transfer-Encoding': string
}

type BoundaryHeaders = any

interface Attachment {
  name: string;
  contentType: string;
  inline: boolean;
  data: string | Uint8Array;
  data64: string;
  filename?: string;
  mimeType?: string;
  id?: string;
  cid?: string;
}

interface ReadEmlJson {
  date: Date | string;
  subject: string;
  from: EmailAddress | EmailAddress[] | null;
  to: EmailAddress | EmailAddress[] | null;
  cc?: EmailAddress | EmailAddress[] | null;
  headers: EmlHeaders;
  multipartAlternative?: {
    'Content-Type': string;
  };
  text?: string;
  textheaders?: BoundaryHeaders;
  html?: string; // email html data
  htmlheaders?: BoundaryHeaders;
  attachments?: Attachment[];
  data?: string;
}

export interface BankTransaction {
  date: string
  summary: string
  amount: string|number // 真实账单金额，需要符合几个要求：与支付金额一致，能表达支出、收入信息
  location?: string
  card?: string
  [key: string]: unknown
}

export async function parseABCEml(emlfile: string) {
  if (!fs.existsSync(emlfile)) {
    console.error('eml 文件不存在')
    process.exit(1)
  }

  const content = fs.readFileSync(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadEmlJson

  if (Array.isArray(emlJson.attachments)) {
    for (const att of emlJson.attachments) {
      if (att.contentType.includes('Text/HTML') && att.data64) {
        let html = ''
        const body = Buffer.from(att.data64, 'base64')
        if (typeof att.contentType === 'string' && (att.contentType.includes('gbk') || att.contentType.includes('gb2312'))) {
          const decoder = new util.TextDecoder('gbk')
          html = decoder.decode(body)
          html.replace("<meta http-equiv='Content-Type' content='text/html;charset=gbk'>", "<meta http-equiv='Content-Type' content='text/html;charset=utf-8'>")
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
export async function parseCMBEml(emlfile: string) {
  if (!fs.existsSync(emlfile)) {
    console.error('eml 文件不存在')
    process.exit(1)
  }

  const content = fs.readFileSync(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadEmlJson

  if (emlJson.html) {
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
        const [_, tradeDate, recordDate, summary, RMBAmount, card, originalAmount,, location = 'CN'] = trans
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
