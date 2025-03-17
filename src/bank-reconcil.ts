import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import actualApi from '@actual-app/api'
import inquirer from 'inquirer'
import { initActual, type Transaction } from './actual.ts'
import { createKeyForTransaction, dealReconcilResults } from './reconcil.ts'
import { parseABCEml, parseBOCOMEml, parseCMBEml, type BankTransaction } from './eml-parser.ts'

dayjs.extend(customParseFormat)

async function reconcilBills(
  data: BankTransaction[],
  accountId: string,
  processor: {
    getAmount: (item: BankTransaction) => number;
    // 过滤掉不需要对账的交易
    filterUnreconciled?: (item: BankTransaction) => boolean;
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
    if (matchTransaction && !matchTransaction.cleared) {
      actualApi.updateTransaction(matchTransaction.id, { cleared: true })
    }

    return !matchTransaction
  })

  return { unmatched, unReconcilData }
}

async function reconcilABCEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseABCEml(emlFile)
  const cardGroups = Object.groupBy(transactionsOfBank, (el: any) => el.card)

  await initActual()

  const accounts = await actualApi.getAccounts()

  for (const card of Object.keys(cardGroups)) {
    console.log(`开始对账尾号${card}的银行卡`)
    const cardTransactionsOfBank = cardGroups[card]
    if (cardTransactionsOfBank) {
      const answers = await inquirer.prompt([
        {
          type: 'select',
          choices: accounts.map((account) => ({
            name: account.name,
            value: account.id,
          })),
          name: 'accountId',
          message: `请选择尾号${card}的银行卡对应的Actual账户`,
        },
      ])

      const { unReconcilData, unmatched } = await reconcilBills(cardTransactionsOfBank, answers.accountId, {
        getAmount: (item: BankTransaction) => {
          const [tradeAmount, currency] = typeof item.amount === 'string' ? item.amount.split('/') : []
          return Number(tradeAmount.trim())
        },
      })
      if (unmatched.length > 0) {
        const unAccountCashback = unmatched.filter((item) => item.summary === '刷卡金转入')
        if (unAccountCashback.length > 0) {
          console.log(`将对 ${unAccountCashback.length} 条未记账的返现交易进行追加记录`)
          const results = await actualApi.addTransactions(answers.accountId, unAccountCashback.map((item) => {
            const [tradeAmount, currency] = typeof item.amount === 'string' ? item.amount.split('/') : []
            return {
              date: item.date,
              amount: actualApi.utils.amountToInteger(Number(tradeAmount.trim())),
              notes: item.summary,
              payee_name: '农行',
            }
          }))
          if (results === 'ok') {
            console.log('追加交易完成')
          } else {
            console.log('追加交易出错')
          }
        }
      }
      console.log(`尾号${card}的银行卡对账结果：`)
      dealReconcilResults({ unReconcilData, unmatched })
    }
  }

  await actualApi.shutdown()
}

async function reconcilCMBEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseCMBEml(emlFile)
  const cardGroups = Object.groupBy(transactionsOfBank, (el: any) => el.card)

  await initActual()

  const accounts = await actualApi.getAccounts()

  // 招行信报合一，多张卡一份账单
  for (const card of Object.keys(cardGroups)) {
    console.log(`开始对账尾号${card}的银行卡`)
    const cardTransactionsOfBank = cardGroups[card]
    if (cardTransactionsOfBank) {
      const answers = await inquirer.prompt([
        {
          type: 'select',
          choices: accounts.map((account) => ({
            name: account.name,
            value: account.id,
          })),
          name: 'accountId',
          message: `请选择尾号${card}的银行卡对应的Actual账户`,
        },
      ])

      const { unReconcilData, unmatched } = await reconcilBills(cardTransactionsOfBank, answers.accountId, {
        getAmount: (item: BankTransaction) => {
          return item.amount as unknown as number
        },
      })
      console.log(`尾号${card}的银行卡对账结果：`)
      dealReconcilResults({ unReconcilData, unmatched })
    }
  }

  await actualApi.shutdown()
}

async function reconcilBOCOMEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseBOCOMEml(emlFile)
  const cardGroups = Object.groupBy(transactionsOfBank, (el: any) => el.card)

  await initActual()

  const accounts = await actualApi.getAccounts()

  for (const card of Object.keys(cardGroups)) {
    console.log(`开始对账尾号${card}的银行卡`)
    const cardTransactionsOfBank = cardGroups[card]
    if (cardTransactionsOfBank) {
      const answers = await inquirer.prompt([
        {
          type: 'select',
          choices: accounts.map((account) => ({
            name: account.name,
            value: account.id,
          })),
          name: 'accountId',
          message: `请选择尾号${card}的银行卡对应的Actual账户`,
        },
      ])

      const { unReconcilData, unmatched } = await reconcilBills(cardTransactionsOfBank, answers.accountId, {
        getAmount: (item: BankTransaction) => {
          return item.amount as unknown as number
        },
        filterUnreconciled: (item: BankTransaction) => {
          // 分期扣款暂时不对账
          return item.summary.includes('分期扣款')
        },
      })
      console.log(`尾号${card}的银行卡对账结果：`)
      dealReconcilResults({ unReconcilData, unmatched })
    }
  }

  await actualApi.shutdown()
}

export async function reconcilBankEml() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'bank',
      message: '请选择银行',
      choices: ['中国农业银行', '招商银行', '交通银行'],
    },
    {
      type: 'input',
      name: 'emlFilePath',
      message: '请输入账单eml文件路径',
    },
  ])
  console.time('对账耗时')
  if (answers.bank === '中国农业银行') {
    await reconcilABCEml(answers.emlFilePath)
  } else if (answers.bank === '招商银行') {
    await reconcilCMBEml(answers.emlFilePath)
  } else if (answers.bank === '交通银行') {
    await reconcilBOCOMEml(answers.emlFilePath)
  } else {
    console.log('暂不支持该银行')
  }
  console.timeEnd('对账耗时')
}
