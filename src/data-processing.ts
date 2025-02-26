import actualApi from '@actual-app/api'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import type { OCRResult } from './ocr'
dayjs.extend(customParseFormat)

const { PAYEE_MAP, ACCOUNT_NAME_MAP } = await import('./actual-mapping.ts')

/**
 * 从微信的支付截屏 OCR 数据中生成交易数据
 * @param ocrRawData 
 * @returns 
 */
export const getTransactionDataFromWechat = (ocrRawData: string[]): {
  payee: string
  amount: number
  accountName: string
  date: string
  note?: string
  fullPayee?: string
  importID?: string
} => {
  const [payeeRaw, amountRaw, extraInfos] = ocrRawData

  // 对支付对象（商家）的名称做映射，以解决不同平台、场景下同一个支付对象显示不同名称的情况
  const payee = PAYEE_MAP[payeeRaw] || payeeRaw

  let date, note, fullPayee, _, __, accountNameRaw, importID

  const extras = extraInfos.split('\n').filter(str => str.trim())

  // 提取不同交易信息
  for (const field of extras) {
    const fieldKey = field.substring(0, 4)
    switch (fieldKey) {
      case '支付时间':
        date = dayjs(field.substring(4), 'YYYY年M月D日HH:mm:ss')
        break
      case '商户全称':
        fullPayee = field.substring(4)
        break
      case '支付方式':
        accountNameRaw = field.substring(4)
        break
      case '交易单号':
        importID = field.substring(4)
        break
      default:
        if (field.startsWith('商品')) {
          note = field.substring(2)
        }
    }
  }

  if (typeof accountNameRaw !== 'string' || accountNameRaw.length === 0) {
    throw new Error('没有识别到支付方式')
  }

  const amount = actualApi.utils.amountToInteger(Number(amountRaw))

  // 对支付方式（账户）的名称做映射，以解决不同平台、场景下同一个支付方式（账户）显示不同名称的情况
  const accountName = ACCOUNT_NAME_MAP[accountNameRaw] || accountNameRaw

  console.log({ amount, accountName, date: date?.format('YYYY-MM-DD'), note, fullPayee, importID })

  return {
    payee,
    amount,
    accountName,
    date: date ? date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
    note,
    fullPayee,
    importID,
  }
}

/**
 * 从 OCR 结果中生成交易数据（区分不同场景）
 * @param ocrResult 
 * @returns 
 */
export const getTransactionDataFromOCR = (ocrResult: OCRResult): {
  payee: string
  amount: number
  accountName: string
  date: string
  note?: string
  fullPayee?: string
  importID?: string
} => {
  return getTransactionDataFromWechat(ocrResult.data)
}
