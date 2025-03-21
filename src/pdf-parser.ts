import actualApi from '@actual-app/api'
import inquirer from 'inquirer'
import PDFParser from 'pdf2json'
import { reconcilBills } from './bank-reconcil.ts'
import { dealReconcilResults } from './reconcil.ts'
import { initActual } from './actual.ts'
import dayjs from 'dayjs'

export async function parseCMBPDF(pdfFile: string) {
  /**
 * 日期
 * 货币
 * 金额
 * 余额
 * 摘要
 * 对手信息
 */
  const pdfParser = new PDFParser()

  pdfParser.on("pdfParser_dataError", (errData) =>
    console.error(errData.parserError)
  )
  pdfParser.on("pdfParser_dataReady", async (pdfData) => {
    const data: string[][] = []
    let card = ''

    pdfData.Pages.forEach((page) => {
      let seekIndex = 0
      while (seekIndex < page.Texts.length) {
        const Text = page.Texts[seekIndex]
        const text = decodeURIComponent(Text.R[0].T)
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          data.push(page.Texts.slice(seekIndex, seekIndex + 6).map(t => decodeURIComponent(t.R[0].T)))
          seekIndex += 6
        } else if (text.startsWith('账号：')) {
          card = text.substring(text.length - 4)
          seekIndex++
        } else {
          seekIndex++
        }
      }
    })
    const transactions = data.map(tr => {
      const [date, currency, amount, _, summary, payee] = tr
      return {
        date,
        currency,
        amount,
        summary,
        payee,
        card,
      }
    })
    await initActual()

    const accounts = await actualApi.getAccounts()
    const answers = await inquirer.prompt([
      {
        type: 'select',
        choices: accounts.map((account) => ({
          name: account.name,
          value: account.id,
        })),
        name: 'accountId',
        message: `请选择银行卡对应的Actual账户`,
      },
    ])

    const results = await reconcilBills(transactions, answers.accountId, {
      getAmount: (item: any) => Number(item.amount.replaceAll(',', '')),
      filterUnreconciled: (item: any) => typeof item.summary === 'string' && item.summary.includes('朝朝宝'),
    })

    await actualApi.shutdown()

    dealReconcilResults(results)
  })

  pdfParser.loadPDF(pdfFile)
}

// 中信PDF
export async function parseCITICPDF(pdfFile: string) {
  const pdfParser = new PDFParser()

  pdfParser.on("pdfParser_dataError", (errData) =>
    console.error(errData.parserError)
  )

  /**
 * 交易日
 * 记账日
 * 卡号
 * 描述
 * ...
 * 描述
 * 货币
 * 金额
 * 记账货币
 * 记账金额
 */
  pdfParser.on("pdfParser_dataReady", async (pdfData) => {
    const data: string[][] = []
    pdfData.Pages.forEach((page) => {
      const slice: string[] = []
      let push = false
      let seekIndex = 0
      while (seekIndex < page.Texts.length) {
        const Text = page.Texts[seekIndex]
        const text = decodeURIComponent(Text.R[0].T).trim()
        if (text) {
          if (push) {
            slice.push(text)
          } else if (/^\d{8}$/.test(text)) {
            slice.push(text)
            push = true
          }
          if (slice.filter(str => str === 'CNY').length === 2 && slice.at(-2) === 'CNY') {
            data.push([...slice])
            slice.length = 0
            push = false
          }
        }
        seekIndex++
      }
    })

    // console.log(data)

    const transactions = data.map(tr => {
      const date = dayjs(tr.at(0) || tr.at(1), 'YYYYMMDD').format('YYYY-MM-DD')
      const card = tr.at(2) || ''
      const summary = tr.slice(3, -4).join('')
      const currency = tr.at(-2) || ''
      const amount = tr.at(-1) || ''
      return {
        date,
        currency,
        amount,
        summary,
        card,
        payee: summary,
      }
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
        const results = await reconcilBills(cardTransactionsOfBank, answers.accountId, {
          getAmount: (item: any) => -Number(item.amount.replaceAll(',', '')),
        })

        dealReconcilResults(results)
      }
    }

    await actualApi.shutdown()
  })

  pdfParser.loadPDF(pdfFile)
}
