import actualApi from '@actual-app/api'
import inquirer from 'inquirer'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { reconcilBills } from '../bank-reconcil.ts'
import { initActual } from '../actual.ts'
import { dealReconcilResults } from '../reconcil.ts'

dayjs.extend(customParseFormat)

export async function parseNBCBWebBills(billJSON: string) {
  const transactions = JSON.parse(billJSON)

  transactions.forEach((transaction: any) => {
    transaction.date = dayjs(transaction.datetime, 'MM-DD HH:mm').format('YYYY-MM-DD')
    // 宁波银行交易金额支出为正数，收入为负数
    transaction.amount = -Number(transaction.tradeAmount.replace('￥', ''))
    transaction.card = transaction.cardDesc.replace('卡号末四位：', '')
  })
  transactions.sort((a: any, b: any) => {
    return dayjs(a.date).diff(dayjs(b.date))
  })

  const cardGroups = Object.groupBy(transactions, (el: any) => el.card)
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
        getAmount: (item: any) => {
          return item.amount
        },
      })
      console.log(`尾号${card}的银行卡对账结果：`)
      dealReconcilResults({ unReconcilData, unmatched })
    }
  }

  await actualApi.shutdown()
}
