import Fastify from 'fastify'
import path from 'path'
import { nanoid } from 'nanoid'
import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import multipart, { type MultipartValue } from '@fastify/multipart'
import { addActualTransaction } from './actual.ts'
import { cnocr, getCnocrServiceStatus } from './cnocr.ts'
import type { PaymentType } from './constants.ts'

const port = Number(process.env.PORT) || 8000

const app = Fastify({
  logger: true,
})

app.register(multipart)

// 处理OCR请求
app.post('/ocr', async (req, reply) => {
  const data = await req.file()

  if (!data) {
    return reply.code(400).send({ message: '请上传图片文件' })
  }

  const paymentType = (data.fields.paymentType as MultipartValue).value as unknown as PaymentType

  const filepath = path.join(import.meta.dirname, '../uploads/', nanoid() + '_' + data.filename)
  await pipeline(data.file, fs.createWriteStream(filepath))

  try {
    const transactionData = await cnocr({
      image: filepath,
      paymentType,
    })

    if (transactionData) {
      const formNote = data.fields.note as MultipartValue
      if (formNote && typeof formNote.value === 'string' && formNote.value.length > 0) {
        transactionData.note = formNote.value.trim() + ';' + transactionData.note
      }
      const add = await addActualTransaction(transactionData)
      if (add) {
        return reply.type('text/html').send(`<div class="alert alert-success" role="alert">添加成功，交易日期: ${transactionData.date}，商户: ${transactionData.payee}</div>`)
      }
      return reply.code(500).send({
        message: '发生了一些未知问题',
      })
    } else {
      return reply.code(400).send({
        message: '请选择正确的支付方式并提交正确的支付截图（都应当从账单界面截取）'
      })
    }
  } catch (err) {
    console.error(err)
    return reply.code(500).send(err)
  }
})

// 处理GET请求
app.get('/', async (req, reply) => {
  try {
    const data = await fs.promises.readFile(path.join(import.meta.dirname, 'index.html'))
    return reply.type('text/html').send(data)
  } catch (err) {
    return reply.status(404).send(err)
  }
})

app.get('/cnocr-status', async (req, reply) => {
  const result = await getCnocrServiceStatus()
  reply.send(result.up ? 'CnOCR 服务正常' : 'CnOCR 未启动')
})

app.listen({ host: '0.0.0.0', port }, () => {
  console.log(`Listening on port ${port}`)
})
