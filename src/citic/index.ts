import { readEml, type ReadedEmlJson } from 'eml-parse-js'
import fs from 'node:fs/promises'
import util from 'node:util'
import { Browser } from 'happy-dom'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import actualApi from '@actual-app/api'
import { chunkArray } from '../utils.ts'
import { initActual } from '../actual.ts'
import type { BankTransaction } from '../eml-parser'
import { select, input } from '@inquirer/prompts'
import Big from 'big.js'
import { importBills } from '../bank-import.ts'
import { dealReconcilResults } from '../import.ts'

dayjs.extend(customParseFormat)

// 中信电子邮件账单 eml 解析
export async function parseCITICEml(emlfile: string) {
  try {
    await fs.access(emlfile)
  } catch (error) {
    console.error('eml 文件不存在')
    return process.exit(1)
  }

  const content = await fs.readFile(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadedEmlJson

  if (emlJson.html) {
    let html = emlJson.html
    const browser = new Browser()
    const page = browser.newPage()
    page.content = html
    const content = page.mainFrame.document.body.textContent
    const texts = content.split('\n').map(str => str.trim()).filter(str => str.length > 0)
    console.log(texts)
    await browser.close()

    const transactionIndex = texts.indexOf('【本期账务明细】') + 1
    const transactionEndIndex = texts.indexOf('【温馨提示】')

    const originalLines = texts.slice(transactionIndex, transactionEndIndex)
    const spliter: number[] = []
    for (let i = 0; i < originalLines.length; i++) {
      if (originalLines[i].startsWith('卡号 ')) {
        spliter.push(i)
      }
    }
    let originalTransactionData: string[][] = []
    spliter.forEach((splitIndex, index) => {
      originalTransactionData = originalTransactionData.concat(originalLines.slice(splitIndex + 15, spliter[index + 1]))
    })

    /**
     * 交易日	银行记账日	卡号后四位	交易描述		交易货币 金额	记账货币 金额
     */

    const transactionsOfBank: BankTransaction[] = chunkArray(originalTransactionData, 8).map(transaction => {
      const [date, , card, summary, transCurrency, transAmount, postCurrency, postAmount] = transaction
      // 中信转入是负，支出是正
      const amount = -Number(postAmount)
      return {
        date: dayjs(date, 'YYYYMMDD').format('YYYY-MM-DD'),
        card,
        summary,
        amount,
        currency: postCurrency,
      }
    })

    return {
      transactionsOfBank,
      html,
      emlJson,
      texts,
    }
  }

  return {
    transactionsOfBank: [],
    html: '',
    emlJson,
  }
}

// 中信银行电子邮件账单导入
export async function importCITICEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseCITICEml(emlFile)
  console.log(transactionsOfBank)
  const cardGroups = Object.groupBy(transactionsOfBank, (el: any) => el.card)

  await initActual()

  const accounts = await actualApi.getAccounts()

  for (const card of Object.keys(cardGroups)) {
    console.log(`开始导入尾号${card}的银行卡`)
    const cardTransactionsOfBank = cardGroups[card]
    if (cardTransactionsOfBank) {
      const accountId = await select({
        choices: accounts.map((account) => ({
          name: account.name,
          value: account.id,
        })),
        message: `请选择尾号${card}的银行卡对应的Actual账户`,
      })

      const getAmount = (item: BankTransaction) => {
        return item.amount as unknown as number
      }

      const { unReconcilData, unmatched } = await importBills(cardTransactionsOfBank, accountId, {
        getAmount,
      })
      console.log(`尾号${card}的银行卡导入结果：`)
      dealReconcilResults({ unReconcilData, unmatched })
    }
  }

  await actualApi.shutdown()
}
