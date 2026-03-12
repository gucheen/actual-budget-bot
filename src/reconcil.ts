import actualApi, { aqlQuery, q } from '@actual-app/api'
import csv from 'csv-parser'
import fs from 'node:fs'
import path from 'node:path'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { select, input } from '@inquirer/prompts'
import { initActual } from './actual.ts'
import type { UUID, Transaction } from './actual.ts'
import { getMappings } from './mapping.ts'
import { reconcilBankEml } from './bank-reconcil.ts'

dayjs.extend(customParseFormat)

export function createKeyForTransaction(transaction: Transaction) {
  return `${transaction.date}_${transaction.account}_${transaction.amount}`
}

async function getActualAccountsNameIdMap(): Promise<{ [key: string]: UUID }> {
  const accounts = await actualApi.getAccounts()
  return accounts.reduce((acc, account) => {
    acc[account.name] = account.id
    return acc
  }, {} as { [key: string]: UUID })
}

async function readCSV(filePath: string, options: { skipLines: number; logMessage: string }): Promise<{ [key: string]: string }[]> {
  try {
    await fs.promises.access(filePath)
  } catch (error) {
    console.error('csv 文件不存在')
    process.exit(1)
  }
  return new Promise((resolve) => {
    const results: any[] = []
    fs.createReadStream(filePath)
      .pipe(csv({ skipLines: options.skipLines }))
      .on('data', data => results.push(data))
      .on('end', () => {
        console.log(options.logMessage.replace('${length}', results.length.toString()))
        resolve(results)
      })
  })
}

async function reconcilAlipayBills(billFilePath: string): Promise<{ unmatched: any[], unReconcilData: any[] }> {
  return reconcilBills(billFilePath, {
    // 支付宝导出个人对账单，前 24 行是注释说明
    readCSVOptions: { skipLines: 24, logMessage: '支付宝账单共 ${length} 条数据' },
    filterUnreconciled: item => {
      if (item['收/付款方式'] === '' || item['交易分类'] === '转账红包') {
        // 没有收付款方式一般是天猫、淘宝的各种充值金账户（比如猫超卡）
        // 转账红包暂时不对账
        return true
      }
      if (item['交易分类'] === '投资理财' && item['交易对方'] === '余额宝' && item['收/付款方式'] === '账户余额') {
        // 支付宝账户余额操作的余额宝买入、卖出暂时不对账
        return true
      }
      return false
    },
    getAccountName: item => {
      const { ACCOUNT_NAME_MAP } = getMappings()
      let originalAccountName = item['收/付款方式']
      if (originalAccountName.includes('&')) {
        // 导出的支付方式会用 & 分隔，第一个是真正的付款方式，后面是各种优惠活动
        originalAccountName = originalAccountName.split('&')[0]
      }
      const accountName = ACCOUNT_NAME_MAP[originalAccountName] || originalAccountName
      return accountName
    },
    getAmount: item => {
      let amount = Number(item['金额'])
      if (item['收/支'] === '支出') {
        amount = -amount
      } else if (item['收/支'] === '不计收支' && item['交易分类'] === '投资理财' && item['商品说明'].includes('买入')) {
        // 投资买入在 actual 中记作转账，对于转出账户来说是支出，买入的基金等对账暂时不处理
        amount = -amount
      }
      return amount
    },
  })
}

async function reconcilWechatBills(billFilePath: string): Promise<{ unmatched: any[], unReconcilData: any[] }> {
  return reconcilBills(billFilePath, {
    // 微信导出个人对账单，前 16 行是注释说明
    readCSVOptions: { skipLines: 16, logMessage: '微信支付账单共 ${length} 条数据' },
    getAccountName: item => {
      const { ACCOUNT_NAME_MAP } = getMappings()
      const originalAccountName = item['支付方式']
      const accountName = ACCOUNT_NAME_MAP[originalAccountName] || originalAccountName
      return accountName
    },
    getAmount: item => {
      let amount = Number(item['金额(元)'].replace('¥', ''))
      if (item['收/支'] === '支出') {
        amount = -amount
      }
      return amount
    },
  })
}

async function reconcilBills(
  billFilePath: string,
  processor: {
    readCSVOptions: { skipLines: number; logMessage: string }
    getAccountName: (item: any) => string
    getAmount: (item: any) => number
    // 过滤掉不需要对账的交易
    filterUnreconciled?: (item: any) => boolean
  }
): Promise<{ unmatched: any[], unReconcilData: any[] }> {
  const data = await readCSV(billFilePath, processor.readCSVOptions)
  await initActual()
  const accountsMap = await getActualAccountsNameIdMap()

  const endDate = data[0]['交易时间'].substring(0, 10)
  const startDate = data[data.length - 1]['交易时间'].substring(0, 10)

  console.log(`账单日期范围：${startDate} ~ ${endDate}`)
  const transactions: Transaction[] = (await aqlQuery(q('transactions').filter({ date: { $gte: startDate, $lte: endDate } }).select('*' as any)) as any).data
  console.log(`actual budget 对应日期范围共 ${transactions.length} 条交易`)

  // 这个map用来记录同一天多笔相同支付账户和金额的交易
  const multipleTransactionIndex = new Map<string, number>()
  const unReconcilData: any[] = []
  const unmatched = data.filter(item => {
    if (typeof processor.filterUnreconciled === 'function' && processor.filterUnreconciled(item)) {
      unReconcilData.push(item)
      return false
    }

    const accountId = accountsMap[processor.getAccountName(item)]
    const amount = actualApi.utils.amountToInteger(processor.getAmount(item))
    const date = item['交易时间'].substring(0, 10)

    const matchTrans = transactions.filter(t =>
      // 日期、金额、账户一致认为是匹配的
      t.date === date && t.amount === amount && t.account === accountId
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

  await actualApi.shutdown()
  return { unmatched, unReconcilData }
}

export async function dealReconcilResults(results: { unmatched: any[], unReconcilData: any[] }) {
  const { unReconcilData, unmatched } = results
  if (unmatched.length > 0) {
    console.log(`对账异常共 ${unmatched.length} 条`)
    console.log(unmatched)
  } else {
    console.log('对账成功!!! 🎉')
    if (unReconcilData.length > 0) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'showUnReconcilData',
          message: '是否查看未对账数据？',
        }
      ])
      if (answers.showUnReconcilData) {
        console.log(unReconcilData)
      }
    }
  }
}

if (import.meta.url.replaceAll(path.sep, path.posix.sep).endsWith(process.argv[1].replaceAll(path.sep, path.posix.sep))) {
  // 清空终端
  process.stdout.write('\x1Bc')

  const answers1 = await select({
    message: '选择账单对应的支付应用',
    choices: ['支付宝', '微信支付', '银行邮件账单'],
  })
  if (answers1 === '银行邮件账单') {
    reconcilBankEml()
  } else {
    const answers2 = await input({
      message: '请输入账单CSV文件路径',
    })
    console.time('对账耗时')
    if (answers1 === '支付宝') {
      const results = await reconcilAlipayBills(answers2)
      dealReconcilResults(results)
    } else if (answers1 === '微信支付') {
      const results = await reconcilWechatBills(answers2)
      dealReconcilResults(results)
    } else {
      console.log('暂不支持该应用')
    }
    console.timeEnd('对账耗时')
  }
}
