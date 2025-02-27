import Fastify from 'fastify'
import path from 'path'
import { nanoid } from 'nanoid'
import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import multipart from '@fastify/multipart'
import { addActualTransaction } from './actual.ts'
import { cnocr } from './cnocr.ts'
import type { PaymentType } from './constants.ts'

const port = Number(process.env.PORT) || 8000

const app = Fastify({
  logger: true,
})

app.register(multipart)

// 处理OCR请求
app.post('/ocr', async (req, reply) => {
  const data = await req.file()

  if (!data?.fields.paymentType) {
    return reply.code(400).send({ message: '请选择支付方式' })
  }

  if (!data.file) {
    return reply.code(400).send({ message: '请上传图片文件' })
  }

  await pipeline(data.file, fs.createWriteStream(path.join(import.meta.dirname, '../uploads/', nanoid() + '_' + data.filename)))

  try {
    const transactionData = await cnocr({
      image: await data.toBuffer(),
      paymentType: data.fields.paymentType as unknown as PaymentType,
    })

    if (transactionData) {
      const add = await addActualTransaction(transactionData)
      return reply.send({
        success: add === 'ok',
        transactionData,
      })
    } else {
      return reply.code(400).send({
        message: '请选择正确的支付方式并提交正确的支付截图（都应当从账单界面截取）'
      })
    }
  } catch (err) {
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

app.listen({ port }, () => {
  console.log(`Listening on port ${port}`)
})
