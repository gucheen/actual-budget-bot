import sharp from 'sharp'
import { createWorker, createScheduler, type Scheduler } from 'tesseract.js'

// 当前 scheduler 已经执行的 job 数量，100 个 job 之后，重新初始化 scheduler
let doneJobsCount = 0

let scheduler: Scheduler | null

// 像 scheduler 内添加 worker
const workerGen = async () => {
  if (scheduler) {
    const worker = await createWorker(['chi_sim', 'eng'])
    scheduler.addWorker(worker)
  }
}

// 初始化 scheduler，如果 scheduler 已经存在，则先销毁，默认 4 个 worker
const initScheduler = async () => {
  if (scheduler) {
    await scheduler.terminate()
    scheduler = null
    doneJobsCount = 0
  }
  scheduler = createScheduler()

  const workerN = 4
  for (let i = 0; i < workerN; i++) {
    await workerGen()
  }
}

await initScheduler()

// 识别微信支付截图
const ocrWechatPaymentCapture = async (imageFile: Buffer|string) => {
  const image = sharp(imageFile)
  const { width } = await image.metadata()

  // 对图片进行预处理，提高 OCR 精度
  const claheImage = image
    .clahe({
      width: 3,
      height: 3,
    })

  // 识别三个矩形区域的文本
  // 第一个矩形区域是支付对象（商家），第二个矩形区域是金额，第三个矩形区域是其他信息
  // 这个规则针对 iPhone 15 Pro，微信支付账单页面
  // 如果是其他设备，需要调整矩形区域的位置和大小
  // 如果是其他分辨率，需要调整矩形区域的位置和大小
  const rectangles = [
    {
      top: 540,
      left: 0,
      width: width || 1000,
      height: 80,
    },
    {
      top: 680,
      left: 0,
      width: width || 1000,
      height: 100,
    },
    {
      top: 1100,
      left: 0,
      width: width || 1000,
      height: 550,
    }
  ]
  console.time('ocr')
  const results = await Promise.all(rectangles.map(async (rectangle) => {
    if (scheduler) {
      doneJobsCount++
      const result = await scheduler.addJob('recognize', await claheImage.clone().extract(rectangle).toBuffer())
      return result.data.text.replaceAll(' ', '').replace(/\n$/, '')
    }
    return ''
  }))
  console.timeEnd('ocr')
  console.log('ocr results', results)

  console.log('doneJobsCount', doneJobsCount)
  if (doneJobsCount >= 100) {
    // 任务数量判断，超过 100 重新初始化 scheduler
    await initScheduler()
  }

  return results
}

export interface OCRResult {
  data: string[]
  type: 'wechat'
}

export const ocrPaymentImage = async (imageFile: Buffer|string): Promise<OCRResult> => {
  const results = await ocrWechatPaymentCapture(imageFile)
  return {
    data: results,
    type: 'wechat',
  }
}
