import actualApi from '@actual-app/api'
import inquirer from 'inquirer'
import PDFParser from 'pdf2json'
import { reconcilBills } from './bank-reconcil.ts'
import { dealReconcilResults } from './reconcil.ts'
import { initActual } from './actual.ts'

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
      while (seekIndex < page.Texts.length - 1) {
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
