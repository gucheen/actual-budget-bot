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
import crypto from 'node:crypto'
import { fetch, Agent } from 'undici'

dayjs.extend(customParseFormat)

// 农行电子邮件账单 eml 解析
export async function parseABCEml(emlfile: string) {
  try {
    await fs.access(emlfile)
  } catch (error) {
    console.error('eml 文件不存在')
    return process.exit(1)
  }

  const content = await fs.readFile(emlfile, 'utf-8')

  const emlJson = readEml(content) as ReadedEmlJson

  if (Array.isArray(emlJson.attachments)) {
    for (const att of emlJson.attachments) {
      if (att.contentType.includes('Text/HTML') && att.data64) {
        let html = ''
        const body = Buffer.from(att.data64, 'base64')
        if (typeof att.contentType === 'string' && (att.contentType.includes('gbk') || att.contentType.includes('gb2312'))) {
          const decoder = new util.TextDecoder('gbk')
          html = decoder.decode(body)
          html = html.replace("<meta http-equiv='Content-Type' content='text/html;charset=gbk'>", "<meta http-equiv='Content-Type' content='text/html;charset=utf-8'>")
        } else {
          html = body.toString()
        }
        const browser = new Browser()
        const page = browser.newPage()
        page.content = html
        const content = page.mainFrame.document.body.textContent
        const texts = content.split('\n').map(str => str.trim()).filter(str => str.length > 0)
        const cardNoStr = texts.at(texts.indexOf('卡号') + 2) || ''
        const cardNo = cardNoStr.substring(cardNoStr.length - 4)
        const billDate = texts.indexOf('账单周期') + 2
        const [billStartStr, billEndStr] = texts.at(billDate)?.split('-') || ['', '']
        const billStartDate = dayjs(billStartStr, 'YYYY/MM/DD').format('YYMMDD')
        const billEndDate = dayjs(billEndStr, 'YYYY/MM/DD').format('YYMMDD')
        const repayIndex = texts.indexOf('还款') + 1
        const transactionIndex = texts.indexOf('消费') + 1
        const repayEndIndex = transactionIndex - 3
        const transactionEndIndex = texts.indexOf('积分统计') - 1
        const cashBackIndex = texts.indexOf('本期使用刷卡金') + 1

        let originalLines = texts.slice(repayIndex, repayEndIndex + 1).concat(texts.slice(transactionIndex, transactionEndIndex + 1))
        if (originalLines.length % 6 !== 0) {
          // 这种情况是因为部分交易记录没有卡号字段，补充账单的默认卡号即可
          originalLines = originalLines.map((td, index, thisArr) => {
            if (/^\d{6}$/.test(td) && /^\d{6}$/.test(thisArr[index - 1]) && !/^\d{4}$/.test(thisArr[index + 1])) {
              // 当前元素是日期，前一个元素是日期，但是后一个元素不是卡号
              return [td, cardNo]
            }
            return td
          }).flat()
        }
        const originalTransactionData: string[][] = chunkArray(originalLines, 6)
        if (Number(texts.at(cashBackIndex)) > 0) {
          originalTransactionData.push([billEndDate, billEndDate, cardNo, '本期使用刷卡金', `${texts.at(cashBackIndex)}/CNY`, `${texts.at(cashBackIndex)}/CNY`])
        }

        await browser.close()

        /**
         * [
         * 交易日,
         * 入账日,
         * 卡号后四位,
         * 交易摘要,
         * 交易金额/币种,
         * 入账金额/币种（支出为-),
         * ]
         */

        const transactionsOfBank: BankTransaction[] = originalTransactionData.map(transaction => {
          const [date, __, card, summary, balance, amount] = transaction
          return {
            date: dayjs(date, 'YYMMDD').format('YYYY-MM-DD'),
            card,
            summary,
            amount,
            balance,
          }
        })

        return {
          transactionsOfBank,
          html,
          emlJson,
          texts,
        }
      }
    }
  }

  return {
    transactionsOfBank: [],
    html: '',
    emlJson,
  }
}

async function getABCExchangeRate() {
  const res = await fetch("https://ewealth.abchina.com/app/data/api/DataService/ExchangeRateV2", {
    headers: {
      Accept: 'application/json',
    },
    mode: "cors",
    dispatcher: new Agent({
      connect: {
        rejectUnauthorized: false,
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
      },
    })
  }).then(res => res.json()) as {
    ErrorCode: string
    ErrorMsg: string
    Data: {
      ErrorCode: string
      Table: {
        BenchMarkPrice: string
        BuyingPrice: string
        CurrName: string
        CurrId: number
        SellPrice: number
        PublishTime: string
        Id: string
        CashBuyingPrice: string
      }[]
    }
  }
  console.log(res)
  return res.Data.Table
}

// 农行电子邮件账单对账
export async function importABCEml(emlFile: string) {
  const {
    transactionsOfBank,
    texts,
  } = await parseABCEml(emlFile)
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

      const account = accounts.find(acc => acc.id === accountId)
      if (/\([A-Z]{3}\)$/.test(account!.name) && Array.isArray(texts)) {
        // 外币账户
        // 通过最终账单的人民币金额计算还款汇率
        const CNYBill = Big(await input({
          message: '请输入人民币账单金额',
        }))
        const FXBill = Big(texts.at(texts.indexOf('本期应还款额(欠款为-) New Balance') + 4) || '1')
        const FX_RATE = CNYBill.div(FXBill.abs())
        transactionsOfBank.forEach((item) => {
          const [tradeAmount, currency] = typeof item.amount === 'string' ? item.amount.split('/') : []
          if (currency && currency !== 'CNY' && !item.summary.includes('人民币账户自动购汇转入还款')) {
            item.summary = `${tradeAmount} ${currency} (FX rate: ${FX_RATE.toFixed(2)}) • ${item.summary}`
            item.amount = Big(tradeAmount).times(FX_RATE).round(2).toFixed(2)
          }
        })
      }

      const getAmount = (item: BankTransaction) => {
        const [tradeAmount, currency] = typeof item.amount === 'string' ? item.amount.split('/') : []
        return Number(tradeAmount.trim())
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
