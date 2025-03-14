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
  card: string
  summary: string
  location: string
  amount: string
  balance: string
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
         * 空白，
         * 交易日，
         * 入账日，
         * 卡号后四位，
         * 交易摘要，
         * 交易地点，
         * 交易金额/币种，
         * 入账金额/币种（支出为-)
         * ]
         */

        const transactionsOfBank: BankTransaction[] = originalTransactionData.map(transaction => {
          const [_, date, __, card, summary, location, amount, balance] = transaction
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
