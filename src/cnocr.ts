import { FormData, File } from 'formdata-node'
import { fileFromPath } from 'formdata-node/file-from-path'
import actual from '@actual-app/api'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { PaymentType } from './constants.ts'
dayjs.extend(customParseFormat)

interface CNOCRData {
  text: string
  score: number
  position: [number, number][]
}

// 交易金额正则，正负号，数字（可能存在分隔符），小数点，两位小数
// 微信、支付宝、云闪付的支付金额都满足这个条件，因此使用这个详细的正则来匹配金额数字，避免匹配到一些非金额数字
const TradeAmountPattern = /^[+-]?.?[\d,]+\.\d{2}$/

function parseTradeAmount(tradeAmountString: string): number {
  if (typeof tradeAmountString !== 'string') {
    return NaN
  }
  let tradeAmountStr = tradeAmountString.trim()
  // 去除金额中的非数字字符，但保留负数标识 -
  tradeAmountStr = tradeAmountStr.replace(/[^\d.-]/g, '')
  return Number(tradeAmountStr)
}

/**
 * 由于支付对象（商家）名称可能会很长导致折行，并且也有可能因为符号的存在导致OCR识别为多个区块
 * 因此这里需要用反向查找的方式来寻找完整的支付对象（商家）的名称
 * 首个锚点是支付金额的前一个区块（当前主要支付平台的样式都是支付对象名称 换行 支付金额），之后继续向前查找
 * 如果前一个区块的上边 Y 轴坐标和当前区块的上边 Y 轴坐标相距小于阈值 10，那么就认为是同一行的文本
 * block1 block2
 * 如果前一个区块的下边 Y 轴坐标和当前区块的上边 Y 轴坐标相距小于阈值 20，那么就认为是连续的多行文本
 * block 3
 * block 4
 * 这两种情况将对应区块按正序拼接作为完整的商家名称
 * @param startIndex - 从哪个索引开始寻找
 * @param ocrData - OCR数据
 * @returns 完整的支付对象（商家）的名称
 */
const seekMultilinePayee = (startIndex: number, ocrData: CNOCRData[]): string => {
  let payeeRaw = ''
  let seekIndex = startIndex
  payeeRaw = ocrData[seekIndex].text
  while (seekIndex >= 1) {
    const isSameLine = Math.abs(ocrData[seekIndex - 1].position[0][1] - ocrData[seekIndex].position[0][1]) < 10
    const isSameParagraph = Math.abs(ocrData[seekIndex - 1].position[3][1] - ocrData[seekIndex].position[0][1]) < 20
    if (isSameLine || isSameParagraph) {
      payeeRaw = ocrData[seekIndex - 1].text + payeeRaw
      seekIndex = seekIndex - 1
    } else {
      break
    }
  }
  return payeeRaw.replace('>', '').trim()
}

const processAlipayOCRResults = (ocrData: CNOCRData[]): {
  payee: string
  amount: number
  accountName: string
  date: string
  note: string
  fullPayee: string
  importedID: string
  category?: string
} => {
  let payeeRaw = '',
    amount = 0,
    accountNameRaw = '',
    date = '',
    note = '',
    fullPayee = '',
    importedID = '',
    category = ''
  let firstAmountCatch = false
  let pushToNote = false
  const noteStrs: string[] = []
  ocrData.filter(item => item.text && item.score > 0.2).forEach((item, index, arr) => {
    // 首个符合金额数字规则的区块作为交易金额处理
    if (TradeAmountPattern.test(item.text) && !firstAmountCatch) {
      firstAmountCatch = true
      amount = actual.utils.amountToInteger(parseTradeAmount(item.text))
      // 查找完整的商家名称，详细逻辑请看 seekMultilinePayee 方法说明
      const seekIndex = index - 1
      payeeRaw = seekMultilinePayee(seekIndex, arr)
    } else if (pushToNote) {
      if (item.text === '推荐服务' || item.text === '订单号') {
        pushToNote = false
      } else if (/^共\d件$/.test(item.text)) {
        // pass
      } else {
        noteStrs.push(item.text)
      }
    }
    switch (item.text) {
      case '创建时间':
      case '支付时间':
        date = dayjs(arr[index + 1].text, 'YYYY-MM-DDHH:mm:ss').format('YYYY-MM-DD')
        break
      case '付款方式':
      case '退款方式':
        accountNameRaw = typeof arr[index + 1].text === 'string' ? arr[index + 1].text.replace('>', '') : ''
        // ()的识别存在问题，这里做一下处理
        if (accountNameRaw.includes('(') && !accountNameRaw.endsWith(')')) {
          accountNameRaw += ')'
        }
        break
      case '缴费说明':
      case '商品说明':
        note = arr[index + 1].text
        break
      case '交易详情':
        pushToNote = true
        break
      case '收款方全称':
        fullPayee = arr[index + 1].text
        break
      case '订单号':
        importedID = arr[index + 1].text
        break
      case '账单分类':
        category = typeof arr[index + 1].text === 'string' ? arr[index + 1].text.replace('>', '').trim() : ''
        break
      default:
    }
  })

  const transactionData = {
    payee: payeeRaw,
    amount,
    accountName: accountNameRaw,
    date: date ?? dayjs().format('YYYY-MM-DD'),
    note: noteStrs.concat(note).filter(str => str).join(''),
    fullPayee,
    importedID,
  }
  console.log('transactionData >>>')
  console.log(transactionData)
  return transactionData
}

const processWechatOCRResults = (ocrData: CNOCRData[]): {
  payee: string
  amount: number
  accountName: string
  date: string
  note: string
  fullPayee: string
  importedID: string
} => {
  let payeeRaw = '',
    amount = 0,
    accountNameRaw = '',
    date = '',
    fullPayee = '',
    importedID = ''
  let firstAmountCatch = false
  let pushToNote = false
  const noteStrs: string[] = []
  ocrData.filter(item => item.text && item.score > 0.2).forEach((item, index, arr) => {
    // 首个符合金额数字规则的区块作为交易金额处理
    if (TradeAmountPattern.test(item.text) && !firstAmountCatch) {
      firstAmountCatch = true
      amount = actual.utils.amountToInteger(parseTradeAmount(item.text))
      // 查找完整的商家名称，详细逻辑请看 seekMultilinePayee 方法说明
      const seekIndex = index - 1
      payeeRaw = seekMultilinePayee(seekIndex, arr)
    } else if (pushToNote) {
      if (item.text === '收单机构' || item.text === '商户全称') {
        pushToNote = false
      } else {
        noteStrs.push(item.text)
      }
    }
    switch (item.text) {
      case '退款时间':
      case '支付时间':
        date = dayjs(arr[index + 1].text, 'YYYY年M月D日HH:mm:ss').format('YYYY-MM-DD')
        break
      case '商品':
        pushToNote = true
        break
      case '商户全称':
        fullPayee = arr[index + 1].text
        break
      case '退款方式':
      case '支付方式':
        accountNameRaw = arr[index + 1].text
        if (accountNameRaw.includes('(') && !accountNameRaw.endsWith(')')) {
          accountNameRaw += ')'
        }
        break
      case '退款单号':
      case '交易单号':
        importedID = arr[index + 1].text
        break
      default:
    }
  })

  const transactionData = {
    payee: payeeRaw,
    amount,
    accountName: accountNameRaw,
    date: date ?? dayjs().format('YYYY-MM-DD'),
    note: noteStrs.join(''),
    fullPayee,
    importedID,
  }
  console.log('transactionData >>>')
  console.log(transactionData)
  return transactionData
}

const processQuickPassOCRResults = (ocrData: CNOCRData[]): {
  payee: string
  amount: number
  accountName: string
  date: string
  note: string
  fullPayee: string
  importedID: string
} => {
  let payeeRaw = '',
    amount = 0,
    accountNameRaw = '',
    date = '',
    note = '',
    fullPayee = '',
    importedID = ''
  let firstAmountCatch = false
  ocrData.filter(item => item.text && item.score > 0.2).forEach((item, index, arr) => {
    // 首个符合金额数字规则的区块作为交易金额处理
    if (TradeAmountPattern.test(item.text) && !firstAmountCatch) {
      firstAmountCatch = true
      amount = actual.utils.amountToInteger(parseTradeAmount(item.text))
      // 查找完整的商家名称，详细逻辑请看 seekMultilinePayee 方法说明
      const seekIndex = index - 1
      payeeRaw = seekMultilinePayee(seekIndex, arr)
    }
    switch (item.text) {
      case '付款方式':
        accountNameRaw = arr[index + 1].text
        if (accountNameRaw.includes('[') && !accountNameRaw.endsWith(']')) {
          accountNameRaw += ']'
        }
        break
      case '订单时间':
        date = dayjs(arr[index + 1].text, 'YYYY年M月D日 HH:mm:ss').format('YYYY-MM-DD')
        break
      case '订单描述':
        note = arr[index + 1].text
        break
      case '订单编号':
        importedID = arr[index + 1].text
        break
      default:
    }
  })

  const transactionData = {
    payee: payeeRaw,
    amount,
    accountName: accountNameRaw,
    date: date ?? dayjs().format('YYYY-MM-DD'),
    note,
    fullPayee,
    importedID,
  }
  console.log('transactionData >>>')
  console.log(transactionData)
  return transactionData
}

const determinePaymentTypeFromOCR = (ocrData: CNOCRData[]): PaymentType | null => {
  for (const item of ocrData) {
    if (item.text === '交易单号') {
      return PaymentType.Wechat
    } else if (item.text === '订单号') {
      return PaymentType.Alipay
    } else if (item.text === '订单编号') {
      return PaymentType.UnionPayQuickPass
    }
  }
  return null
}

export const postImageToCNOcr = async (image: Buffer | string): Promise<CNOCRData[]> => {
  const form = new FormData()
  if (Buffer.isBuffer(image)) {
    form.set('image', new File([image], 'image.png'))
  } else if (typeof image === 'string' && image.length > 0) {
    form.set('image', await fileFromPath(image))
  }
  const response: { status_code: number, results: CNOCRData[] } = await (await fetch(new URL('/ocr', process.env.cnocr_server).toString(), {
    method: 'POST',
    body: form as unknown as any,
  })).json()
  console.log('cnocr results >>>')
  console.log(response)
  return response.results
}

export const cnocr = async (args: {
  image: Buffer | string
  paymentType?: PaymentType
}): Promise<{
  payee: string
  amount: number
  accountName: string
  date: string
  note: string
  fullPayee: string
  importedID: string
  category?: string
} | null> => {
  const results = await postImageToCNOcr(args.image)
  let paymentType: PaymentType | undefined = args.paymentType
  if (typeof paymentType === 'undefined' || paymentType === null || paymentType === PaymentType.Auto) {
    const determinePaymentType = determinePaymentTypeFromOCR(results)
    if (determinePaymentType) {
      paymentType = determinePaymentType
    } else {
      throw new Error('无法自动识别支付类型')
    }
  }
  if (paymentType === PaymentType.Alipay) {
    return processAlipayOCRResults(results)
  } else if (paymentType === PaymentType.Wechat) {
    return processWechatOCRResults(results)
  } else if (paymentType === PaymentType.UnionPayQuickPass) {
    return processQuickPassOCRResults(results)
  }
  return null
}

export const getCnocrServiceStatus = async () => {
  try {
    const result = await (await fetch(new URL('/', process.env.cnocr_server).toString())).json()
    if (result.message === 'Welcome to CnOCR Server!') {
      return { up: true }
    }
    return { up: false }
  } catch (error) {
    return { up: false }
  }
}
