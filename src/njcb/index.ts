import { readEml, type ReadedEmlJson } from 'eml-parse-js'
import fs from 'node:fs/promises'
import { Browser } from 'happy-dom'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import actualApi from '@actual-app/api'
import { initActual } from '../actual.ts'
import type { BankTransaction } from '../eml-parser'
import { select, input } from '@inquirer/prompts'
import { importBills } from '../bank-import.ts'
import { dealReconcilResults } from '../import.ts'
import { chunkArray } from '../utils.ts'

dayjs.extend(customParseFormat)

// 南京银行电子邮件账单 eml 解析
export async function parseNJCBEml(emlfile: string) {
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
    html = html.replace('<meta http-equiv="Content-Type" content="text/html; charset=gb2312">', '<meta http-equiv="Content-Type" content="text/html; charset=utf8">')
    const browser = new Browser()
    const page = browser.newPage()
    page.content = html
    const content = page.mainFrame.document.body.textContent
    const texts = content.split('\n').map(str => str.trim()).filter(str => str.length > 0)
    await browser.close()
  
    const transactionIndex = texts.indexOf('交易日') + 5
    const transactionEndIndex = texts.indexOf('★ 上述交易摘要中的商户名称仅供参考，如与签购单不符，请以签购单为准。')

    const originalLines = texts.slice(transactionIndex, transactionEndIndex)
    const originalTransactionData: string[][] = chunkArray(originalLines, 5)

    /**
     * 交易日	记账日	交易摘要	人民币金额	卡号末四位
     */

    const transactionsOfBank: BankTransaction[] = originalTransactionData.map(transaction => {
      const [date, , summary, originalAmount, card] = transaction
      let amount = -Number(originalAmount.substring(0, originalAmount.length - 1))
      return {
        date: dayjs(date, 'YYYY/MM/DD').format('YYYY-MM-DD'),
        card,
        summary,
        amount,
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

// 南京银行电子邮件账单导入
export async function importNJCBEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseNJCBEml(emlFile)
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
