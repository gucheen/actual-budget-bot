import actualApi, { runQuery, q } from '@actual-app/api'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import fs from 'node:fs/promises'
import path from 'node:path'
dayjs.extend(customParseFormat)

let ACCOUNT_NAME_MAP: {
  [key: string]: string
} = {}
let PAYEE_MAP: {
  [key: string]: string
} = {}
let CATEGORP_MAP: {
  [key: string]: string
} = {}

try {
  await fs.access(path.join(import.meta.dirname, 'mapping.json'))
  const mapping = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'mapping.json'), 'utf-8'))
  ACCOUNT_NAME_MAP = mapping.ACCOUNT_NAME_MAP || {}
  PAYEE_MAP = mapping.PAYEE_MAP || {}
  CATEGORP_MAP = mapping.CATEGORP_MAP || {}
  console.log('mappings >>>')
  console.log(mapping)
} catch (error) {
  console.log('no mappings')
}

export type UUID = string

export interface Transaction {
  id?: UUID
  account: UUID
  date: string
  amount?: number
  payee?: UUID
  payee_name?: string
  imported_payee?: string
  category?: UUID
  notes?: string
  imported_id?: string
  transfer_id?: string
  cleared?: boolean
  subtransactions?: Transaction[]
}

export async function initActual() {
  await actualApi.init({
    dataDir: './actual-data',
    serverURL: process.env.actual_server,
    password: process.env.actual_password,
  })

  await actualApi.downloadBudget(process.env.actual_budget_id, {
    password: process.env.actual_encrypted_password,
  })
}

/**
 * 向 actual 添加一笔交易
 * @param trasnactionData 
 * @returns 
 */
export const addActualTransaction = async (trasnactionData: {
  payee: string
  amount: number
  accountName: string
  date: string
  note?: string
  fullPayee?: string
  importedID?: string
  category?: string
}): Promise<'ok'> => {
  const {
    payee,
    amount,
    accountName,
    date,
    note,
    fullPayee,
    importedID,
    category,
  } = trasnactionData

  await initActual()

  // 对支付对象（商家）的名称做映射，以解决不同平台、场景下同一个支付对象显示不同名称的情况
  const formatPayee = PAYEE_MAP[payee] || payee

  // 对支付方式（账户）的名称做映射，以解决不同平台、场景下同一个支付方式（账户）显示不同名称的情况
  const formatAccountName = ACCOUNT_NAME_MAP[accountName] || accountName

  // 匹配支付方式
  const accounts = await actualApi.getAccounts()
  const matchAccount = accounts.find(account => account.name === formatAccountName)

  if (!matchAccount) {
    throw new Error(`没有找到账户 ${formatAccountName}`)
  }

  console.log('matchAccount', matchAccount)

  if (importedID) {
    const dulplicatedTransaction = await runQuery(q('transactions').filter({ account: matchAccount.id, imported_id: importedID }).select(['*'])) as { data: Transaction[], dependencies: string[] }
    if (dulplicatedTransaction && Array.isArray(dulplicatedTransaction.data) && dulplicatedTransaction.data.length > 0) {
      console.log('dulplicatedTransaction', dulplicatedTransaction)
      throw new Error(`已经存在相同的交易，imported_id：${importedID}`)
    }
  }

  const transaction: Transaction = {
    account: matchAccount.id,
    date: date ?? dayjs().format('YYYY-MM-DD'),
    amount,
    payee_name: formatPayee,
    imported_payee: fullPayee,
    notes: note,
    imported_id: importedID,
  }

  // 目前只允许配置了映射的分类，其他分类不支持
  if (category) {
    // 对分类的名称做映射，以解决不同平台、场景下同一个分类显示不同名称的情况
    const formatCategory = CATEGORP_MAP[category] || category
    const categories = await actualApi.getCategories()
    const matchCategory = await categories.find(category => category.name === formatCategory)
    if (matchCategory) {
      transaction.category = matchCategory.id
    }
  }

  console.log('transaction', transaction)

  const addResult = await actualApi.addTransactions(matchAccount.id, [transaction])

  console.log('addResult', addResult)

  await actualApi.shutdown()

  return addResult
}
