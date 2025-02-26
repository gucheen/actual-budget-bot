import http from 'http'
import fs from 'fs'
import path from 'path'
import multer from 'multer' // 引入multer模块
import { nanoid } from 'nanoid'
import { ocrPaymentImage } from './ocr.ts'
import { addActualTransaction } from './actual.ts'
import { getTransactionDataFromOCR } from './data-processing.ts'

const port = process.env.PORT || 8000

// 配置multer存储
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(import.meta.dirname, '../uploads/'),
    filename(req, file, callback) {
      callback(null, nanoid() + '_' + file.originalname)
    },
  })
})

http.createServer(function (req, res) {
  if (req.method === 'POST' && req.url === '/ocr') {
    // 使用multer处理文件上传
    upload.single('image')(req as unknown as any, res as unknown as any, function (err) {
      if (err) {
        res.writeHead(500)
        res.end(JSON.stringify(err))
        return
      }

      // 处理上传的文件
      const file = (req as unknown as any).file

      if (!file) {
        res.writeHead(500)
        res.end(JSON.stringify({ message: '请上传图片文件' }))
        return
      }

      const filePath = file.path

      fs.readFile(filePath, async function (err, data) {
        if (err) {
          res.writeHead(500)
          res.end(JSON.stringify(err))
          return
        }

        // 使用OCR处理图片
        const ocrResults = await ocrPaymentImage(data)
        // 转换交易数据
        const transactionData = getTransactionDataFromOCR(ocrResults)
        // 向 actual 添加实际交易数据
        const add = await addActualTransaction(transactionData)

        // 处理结果
        const ocrResult = { success: add === 'ok', ocrResults, transactionData }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(ocrResult))
      })
    })
    return
  }

  // 处理GET请求
  fs.readFile(path.join(import.meta.dirname, 'index.html'), function (err, data) {
    if (err) {
      res.writeHead(404)
      res.end(JSON.stringify(err))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(data)
  })
}).listen(port, () => {
  console.log(`Listening on port ${port}`)
})
