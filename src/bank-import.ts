import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import actualApi, { utils } from '@actual-app/api'
import { input, select } from '@inquirer/prompts'
import { initActual, type Transaction } from './actual.ts'
import { createKeyForTransaction, dealReconcilResults } from './import.ts'
import { parseBOCOMEml, parseCMBEml, type BankTransaction } from './eml-parser.ts'
import { parseNBCBWebBills } from './nbcb/nbcb.ts'
import { importABCEml } from './abc/index.ts'
import { importCCBEml } from './ccb/index.ts'
import { importICBCEml } from './icbc/index.ts'

dayjs.extend(customParseFormat)

export async function importBills(
  data: BankTransaction[],
  accountId: string,
  processor: {
    getAmount: (item: BankTransaction) => number
    // 过滤掉不需要对账的交易
    filterUnreconciled?: (item: BankTransaction) => boolean
  }
): Promise<{ unmatched: BankTransaction[], unReconcilData: BankTransaction[] }> {
  if (!Array.isArray(data) || data.length === 0) {
    return { unmatched: [], unReconcilData: [] }
  }
  const startDate = data.at(0)?.date
  const endDate = data.at(-1)?.date

  console.log(`账单日期范围：${startDate} ~ ${endDate}`)
  const transactions: Transaction[] = await actualApi.getTransactions(accountId, startDate, endDate)
  console.log(`actual budget 对应日期范围共 ${transactions.length} 条交易`)

  // 这个map用来记录同一天多笔相同支付账户和金额的交易
  const multipleTransactionIndex = new Map<string, number>()
  const unReconcilData: any[] = []
  const unmatched = data.filter(item => {
    if (typeof processor.filterUnreconciled === 'function' && processor.filterUnreconciled(item)) {
      unReconcilData.push(item)
      return false
    }

    const amount = actualApi.utils.amountToInteger(processor.getAmount(item))
    const date = item.date

    const matchTrans = transactions.filter(t =>
      // 日期、金额一致认为是匹配的
      t.date === date && t.amount === amount
    )

    let index = 0
    if (matchTrans.length > 1) {
      // 同一天多笔相同支付账户和金额的交易
      const key = createKeyForTransaction({ date, account: accountId, amount })
      index = multipleTransactionIndex.get(key) || 0
      multipleTransactionIndex.set(key, index + 1)
    }

    const matchTransaction = matchTrans[index]
    if (matchTransaction && !matchTransaction.cleared && matchTransaction.id) {
      actualApi.updateTransaction(matchTransaction.id, { cleared: true })
    }

    return !matchTransaction
  })

  if (Array.isArray(unmatched) && unmatched.length > 0) {
    await actualApi.addTransactions(accountId, unmatched.map(item => {
      return {
        date: item.date,
        notes: item.summary,
        amount: utils.amountToInteger(processor.getAmount(item)),
        cleared: false,
      }
    }))
  }

  return { unmatched: [], unReconcilData }
}

// 招行电子邮件账单对账
async function importCMBEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseCMBEml(emlFile)
  const cardGroups = Object.groupBy(transactionsOfBank, (el: any) => el.card)

  await initActual()

  const accounts = await actualApi.getAccounts()

  // 招行信报合一，多张卡一份账单
  for (const card of Object.keys(cardGroups)) {
    console.log(`开始导入尾号${card}的银行卡`)
    const cardTransactionsOfBank = cardGroups[card]
    if (cardTransactionsOfBank) {
      const answers = await select({
        choices: accounts.map((account) => ({
          name: account.name,
          value: account.id,
        })),
        message: `请选择尾号${card}的银行卡对应的Actual账户`,
      })

      const { unReconcilData, unmatched } = await importBills(cardTransactionsOfBank, answers, {
        getAmount: (item: BankTransaction) => {
          return item.amount as unknown as number
        },
      })
      console.log(`尾号${card}的银行卡导入结果：`)
      dealReconcilResults({ unReconcilData, unmatched })
    }
  }

  await actualApi.shutdown()
}

// 交行电子邮件账单对账
async function importBOCOMEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseBOCOMEml(emlFile)
  const cardGroups = Object.groupBy(transactionsOfBank, (el: any) => el.card)

  await initActual()

  const accounts = await actualApi.getAccounts()

  for (const card of Object.keys(cardGroups)) {
    console.log(`开始导入尾号${card}的银行卡`)
    const cardTransactionsOfBank = cardGroups[card]
    if (cardTransactionsOfBank) {
      const answers = await select({
        choices: accounts.map((account) => ({
          name: account.name,
          value: account.id,
        })),
        message: `请选择尾号${card}的银行卡对应的Actual账户`,
      })

      const { unReconcilData, unmatched } = await importBills(cardTransactionsOfBank, answers, {
        getAmount: (item: BankTransaction) => {
          return item.amount as unknown as number
        },
      })
      console.log(`尾号${card}的银行卡导入结果：`)
      dealReconcilResults({ unReconcilData, unmatched })
    }
  }

  await actualApi.shutdown()
}

export async function importBankEML() {
  const bank = await select({
    message: '请选择银行',
    choices: ['农业银行', '招商银行', '交通银行', '宁波银行', '建设银行', '工商银行'],
  })

  if (bank === '宁波银行') {
    console.time('账单导入耗时')
    const nbcbJSON = await input({
      message: '请输入宁波银行账单页面提取JSON',
    })
    await parseNBCBWebBills(nbcbJSON)
    console.timeEnd('账单导入耗时')
    return
  }

  const emlPath = await input({
    message: '请输入账单eml文件路径',
  })

  console.time('账单导入耗时')
  if (bank === '农业银行') {
    await importABCEml(emlPath)
  } else if (bank === '招商银行') {
    await importCMBEml(emlPath)
  } else if (bank === '交通银行') {
    await importBOCOMEml(emlPath)
  } else if (bank === '建设银行') {
    await importCCBEml(emlPath)
  } else if (bank === '工商银行') {
    await importICBCEml(emlPath)
  } else {
    console.log('暂不支持该银行')
  }
  console.timeEnd('账单导入耗时')
}
