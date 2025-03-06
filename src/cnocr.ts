import got from 'got'
import { FormData, File } from 'formdata-node'
import { fileFromPath } from 'formdata-node/file-from-path'
import actual from '@actual-app/api'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import fs from 'fs/promises'
import { PaymentType } from './constants.ts'
import path from 'path'
dayjs.extend(customParseFormat)

let ACCOUNT_NAME_MAP: {
  [key: string]: string
} = {}
let PAYEE_MAP: {
  [key: string]: string
} = {}

try {
  await fs.access(path.join(import.meta.dirname, 'mapping.json'))
  const mapping = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'mapping.json'), 'utf-8'))
  ACCOUNT_NAME_MAP = mapping.ACCOUNT_NAME_MAP
  PAYEE_MAP = mapping.PAYEE_MAP
  console.log('mappings >>>')
  console.log(mapping)
} catch (error) {
  console.log('no mappings')
}

interface CNOCRData {
  text: string
  score: number
  position: [number, number][]
}

const processAlipayOCRResults = (ocrData: CNOCRData[]): {
  payee: string
  amount: number
  accountName: string
  date: string
  note: string
  fullPayee: string
  importID: string
} => {
  let payeeRaw = '',
    amount = 0,
    accountNameRaw = '',
    date = '',
    note = '',
    fullPayee = '',
    importID = ''
  let firstAmountCatch = false
  ocrData.filter(item => item.text && item.score > 0.3).forEach((item, index, arr) => {
    if (/^-?[\d.]+$/.test(item.text) && !firstAmountCatch) {
      firstAmountCatch = true
      amount = actual.utils.amountToInteger(Number(item.text))
      payeeRaw = arr[index - 1].text
    }
    switch (item.text) {
      case '创建时间':
      case '支付时间':
        date = dayjs(arr[index + 1].text, 'YYYY-MM-DDHH:mm:ss').format('YYYY-MM-DD')
        break
      case '付款方式':
      case '退款方式':
        accountNameRaw = typeof arr[index + 1].text === 'string' ? arr[index + 1].text.replace('>', '') : ''
        break
      case '缴费说明':
      case '商品说明':
        note = arr[index + 1].text
        break
      case '收款方全称':
        fullPayee = arr[index + 1].text
        break
      case '订单号':
        importID = arr[index + 1].text
        break
      default:
    }
  })

  // 对支付对象（商家）的名称做映射，以解决不同平台、场景下同一个支付对象显示不同名称的情况
  const payee = PAYEE_MAP[payeeRaw] || payeeRaw

  // 对支付方式（账户）的名称做映射，以解决不同平台、场景下同一个支付方式（账户）显示不同名称的情况
  const accountName = ACCOUNT_NAME_MAP[accountNameRaw] || accountNameRaw

  const transactionData = {
    payee,
    amount,
    accountName,
    date: date ?? dayjs().format('YYYY-MM-DD'),
    note,
    fullPayee,
    importID,
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
  importID: string
} => {
  let payeeRaw = '',
    amount = 0,
    accountNameRaw = '',
    date = '',
    fullPayee = '',
    importID = ''
  let firstAmountCatch = false
  let pushToNote = false
  const noteStrs: string[] = []
  ocrData.filter(item => item.text && item.score > 0.3).forEach((item, index, arr) => {
    if (/^-?[\d.]+$/.test(item.text) && !firstAmountCatch) {
      firstAmountCatch = true
      amount = actual.utils.amountToInteger(Number(item.text))
      payeeRaw = arr[index - 1].text
    } else if (pushToNote) {
      if (item.text === '收单机构' || item.text === '商户全称') {
        pushToNote = false
      } else {
        noteStrs.push(item.text)
      }
    }
    switch (item.text) {
      case '支付时间':
        date = dayjs(arr[index + 1].text, 'YYYY年M月D日HH:mm:ss').format('YYYY-MM-DD')
        break
      case '商品':
        pushToNote = true
        break
      case '商户全称':
        fullPayee = arr[index + 1].text
        break
      case '支付方式':
        accountNameRaw = arr[index + 1].text
        if (accountNameRaw.includes('(') && !accountNameRaw.endsWith(')')) {
          accountNameRaw += ')'
        }
        break
      case '交易单号':
        importID = arr[index + 1].text
        break
      default:
    }
  })

  // 对支付对象（商家）的名称做映射，以解决不同平台、场景下同一个支付对象显示不同名称的情况
  const payee = PAYEE_MAP[payeeRaw] || payeeRaw

  // 对支付方式（账户）的名称做映射，以解决不同平台、场景下同一个支付方式（账户）显示不同名称的情况
  const accountName = ACCOUNT_NAME_MAP[accountNameRaw] || accountNameRaw

  const transactionData = {
    payee,
    amount,
    accountName,
    date: date ?? dayjs().format('YYYY-MM-DD'),
    note: noteStrs.join(''),
    fullPayee,
    importID,
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
  importID: string
} => {
  let payeeRaw = '',
    amount = 0,
    accountNameRaw = '',
    date = '',
    note = '',
    fullPayee = '',
    importID = ''
  let firstAmountCatch = false
  ocrData.filter(item => item.text && item.score > 0.3).forEach((item, index, arr) => {
    if (/^-?¥?[\d.]+$/.test(item.text) && !firstAmountCatch) {
      firstAmountCatch = true
      amount = actual.utils.amountToInteger(Number(item.text.replace('¥', '')))
      payeeRaw = arr[index - 1].text
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
      case '订单编号':
        importID = arr[index + 1].text
        break
      default:
    }
  })

  // 对支付对象（商家）的名称做映射，以解决不同平台、场景下同一个支付对象显示不同名称的情况
  const payee = PAYEE_MAP[payeeRaw] || payeeRaw

  // 对支付方式（账户）的名称做映射，以解决不同平台、场景下同一个支付方式（账户）显示不同名称的情况
  const accountName = ACCOUNT_NAME_MAP[accountNameRaw] || accountNameRaw

  const transactionData = {
    payee,
    amount,
    accountName,
    date: date ?? dayjs().format('YYYY-MM-DD'),
    note,
    fullPayee,
    importID,
  }
  console.log('transactionData >>>')
  console.log(transactionData)
  return transactionData
}

const determinePaymentTypeFromOCR = (ocrData: CNOCRData[]): PaymentType|null => {
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

export const cnocr = async (args: {
  image: Buffer | string
  paymentType: PaymentType
}): Promise<{
  payee: string
  amount: number
  accountName: string
  date: string
  note: string
  fullPayee: string
  importID: string
} | null> => {
  const form = new FormData()
  if (Buffer.isBuffer(args.image)) {
    form.set('image', new File([args.image], 'image.png'))
  } else if (typeof args.image === 'string' && args.image.length > 0) {
    form.set('image', await fileFromPath(args.image))
  }
  const response: { status_code: number, results: CNOCRData[] } = await got.post(new URL('/ocr', process.env.cnocr_server).toString(), {
    body: form as unknown as any,
  }).json()
  console.log('cnocr results >>>')
  console.log(response)
  let paymentType: PaymentType = args.paymentType
  if (typeof paymentType === 'undefined' || paymentType === null || paymentType === PaymentType.Auto) {
    const determinePaymentType = determinePaymentTypeFromOCR(response.results)
    if (determinePaymentType) {
      paymentType = determinePaymentType
    } else {
      throw new Error('无法自动识别支付类型')
    }
  }
  if (paymentType === PaymentType.Alipay) {
    return processAlipayOCRResults(response.results)
  } else if (paymentType === PaymentType.Wechat) {
    return processWechatOCRResults(response.results)
  } else if (paymentType === PaymentType.UnionPayQuickPass) {
    return processQuickPassOCRResults(response.results)
  }
  return null
}

export const getCnocrServiceStatus = async () => {
  try {
    const result = await got.get(new URL('/', process.env.cnocr_server).toString()).json()
    if (result.message === 'Welcome to CnOCR Server!') {
      return { up: true }
    }
    return { up: false }
  } catch(error) {
    return { up: false }
  }
}
