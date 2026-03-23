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

dayjs.extend(customParseFormat)

// 上海电子邮件账单 eml 解析
export async function parseBOSCEml(emlfile: string) {
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
    html = html.replace('<meta content="text/html; charset=gb2312" http-equiv="Content-Type" />', '<meta content="text/html; charset=utf-8" http-equiv="Content-Type" />')
    const browser = new Browser()
    const page = browser.newPage()
    page.content = html
    const content = page.mainFrame.document.body.textContent
    const texts = content.split('\n').map(str => str.trim()).filter(str => str.length > 0 && str !== '</tr loop2>')
    await browser.close()
  
    const transactionIndex = texts.indexOf('人民币账户') + 4
    const transactionEndIndex = texts.indexOf('本期余额')

    const originalLines = texts.slice(transactionIndex, transactionEndIndex)
    const originalTransactionData: string[][] = originalLines.reduce((arr, str, index, thisArr) => {
      if (/^\d{4}年\d{2}月\d{2}日$/.test(str) && /^\d{4}年\d{2}月\d{2}日$/.test(thisArr[index + 1])) {
        // 当前元素是日期，后一个元素是日期
        arr.push([str])
        return arr
      }
      arr.at(arr.length - 1)?.push(str)
      return arr
    }, [] as string[][])

    /**
     * 交易日	记账日 交易描述 交易金额 卡号后四位
     */

    const transactionsOfBank: BankTransaction[] = originalTransactionData.map(transaction => {
      const [date, , summary, originalAmount, card] = transaction
      const sign = originalAmount.charAt(originalAmount.length - 1)
      let amount = Number(originalAmount.substring(0, originalAmount.length - 1))
      if (sign === '+') {
        amount = -amount
      }
      return {
        date: dayjs(date, 'YYYY年MM月DD日').format('YYYY-MM-DD'),
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

// 上海银行电子邮件账单导入
export async function importBOSCEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseBOSCEml(emlFile)
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
