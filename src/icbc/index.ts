import { readEml, type ReadedEmlJson } from 'eml-parse-js'
import fs from 'node:fs/promises'
import { Browser } from 'happy-dom'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import actualApi from '@actual-app/api'
import { initActual } from '../actual.ts'
import type { BankTransaction } from '../eml-parser'
import { select } from '@inquirer/prompts'
import { importBills } from '../bank-import.ts'
import { dealReconcilResults } from '../import.ts'

dayjs.extend(customParseFormat)

// 工商银行账单邮件eml解析
export async function parseICBCEml(emlfile: string) {
  try {
    await fs.access(emlfile)
  } catch (error) {
    console.error('eml 文件不存在')
    return process.exit(1)
  }

  const content = await fs.readFile(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadedEmlJson

  if (emlJson.html) {
    const browser = new Browser()
    const page = browser.newPage()
    page.content = emlJson.html
    const titleElement = Array.from(page.mainFrame.document.querySelectorAll('b')).find(element => element.textContent.trim() === '---主卡明细---')
    const tr = titleElement?.parentElement?.parentElement
    const table = tr?.parentElement?.parentElement
    if (tr && table) {
      const index = Array.from(table.firstElementChild.children).indexOf(tr)
      const transactionTrs = Array.from(table.firstElementChild.children).slice(index + 1)
      /**
       * 卡号后四位	交易日	记账日	交易类型	商户名称/城市	交易金额/币种	记账金额/币种
       */
      const transactions = transactionTrs.map(tr => {
        const [card, date, postDate, type, summary, value, postValue] = Array.from(tr.children).map(child => child.textContent.trim())
        const [baseAmount, curAndDir] = postValue.split('/')
        let amount = Number(baseAmount)
        if (curAndDir.includes('(支出)')) {
          amount = -baseAmount
        }
        return {
          card,
          date,
          postDate,
          type,
          summary: summary.replace('支付宝-', ''),
          amount
        }
      })

      return {
        transactionsOfBank: transactions,
        html: emlJson.html,
        emlJson,
      }
    }
  }

  return {
    transactionsOfBank: [],
    html: '',
    emlJson,
  }
}

// 工行电子邮件账单对账
export async function importICBCEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseICBCEml(emlFile)
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
