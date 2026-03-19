import { readEml, type ReadedEmlJson } from 'eml-parse-js'
import fs from 'node:fs/promises'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import actualApi from '@actual-app/api'
import { chunkArray } from '../utils.ts'
import { initActual } from '../actual.ts'
import type { BankTransaction } from '../eml-parser'
import { select } from '@inquirer/prompts'
import { importBills } from '../bank-import.ts'
import { dealReconcilResults } from '../import.ts'
import { parse } from 'node-html-parser'

dayjs.extend(customParseFormat)

// 建设银行电子邮件账单 eml 解析
export async function parseCCBEml(emlfile: string) {
  try {
    await fs.access(emlfile)
  } catch (error) {
    console.error('eml 文件不存在')
    return process.exit(1)
  }

  const content = await fs.readFile(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadedEmlJson

  if (typeof emlJson.html === 'string') {
    const html = emlJson.html
    await fs.writeFile('test.html', html)

    const page = parse(html)
    const texts = page.textContent.split('\n').map(str => str.trim()).filter(str => str)
    const startKeyIndex = texts.indexOf('【交易明细】')
    const endKeyIndex = texts.indexOf('*** 结束 The End ***')
    const transactionTexts = texts.slice(startKeyIndex + 16, endKeyIndex)
    if (transactionTexts.length > 0) {

      /**
     * [
     * 交易日,
     * 记账日,
     * 卡号后四位,
     * 交易描述,
     * 交易币种,
     * 交易金额,
     * 结算币种,
     * 结算金额,
     * ]
     */
      const transactionsOfBank = chunkArray(transactionTexts, 8).map(tr => {
        const [date, pDate, card, summary, tradeCurrency, tradeAmount, clearCurrency, clearAmount] = tr

        return {
          date: date || pDate,
          card: card.replace('/扫码', ''),
          summary,
          // 建行支出记为正数，收入记为负数
          amount: -Number(clearAmount.replace(',', '')),
          tradeCurrency,
          tradeAmount,
          clearCurrency,
          clearAmount,
        }
      })

      return {
        transactionsOfBank,
        html,
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

// 建行电子邮件账单对账
export async function importCCBEml(emlFile: string) {
  const {
    transactionsOfBank,
  } = await parseCCBEml(emlFile)
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
