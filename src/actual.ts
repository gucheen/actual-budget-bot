import actualApi from '@actual-app/api'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
dayjs.extend(customParseFormat)

type UUID = string

interface Transaction {
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
  importID?: string
}): Promise<'ok'> => {
  const {
    payee,
    amount,
    accountName,
    date,
    note,
    fullPayee,
    importID,
  } = trasnactionData

  await actualApi.init({
    dataDir: './actual-data',
    serverURL: process.env.actual_server,
    password: process.env.actual_password,
  })

  await actualApi.downloadBudget(process.env.actual_budget_id, {
    password: process.env.actual_encrypted_password,
  })

  // 匹配支付方式
  const accounts = await actualApi.getAccounts()
  const matchAccount = accounts.find(account => account.name === accountName)

  if (!matchAccount) {
    throw new Error(`没有找到账户 ${accountName}`)
  }

  console.log('matchAccount', matchAccount)

  const transaction = {
    account: matchAccount.id,
    date: date ?? dayjs().format('YYYY-MM-DD'),
    amount,
    payee_name: payee,
    imported_payee: fullPayee,
    notes: note,
    imported_id: importID,
  } satisfies Transaction

  console.log('transaction', transaction)

  const addResult = await actualApi.addTransactions(matchAccount.id, [transaction])

  console.log('addResult', addResult)

  await actualApi.shutdown()

  return addResult
}
