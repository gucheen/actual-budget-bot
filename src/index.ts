import Fastify from 'fastify'
import path from 'path'
import fs from 'node:fs'
import multipart from '@fastify/multipart'

const port = Number(process.env.PORT) || 8000

const app = Fastify({
  logger: true,
})

app.register(multipart)

// 处理GET请求
app.get('/', async (req, reply) => {
  try {
    const data = await fs.promises.readFile(path.join(import.meta.dirname, 'index.html'))
    return reply.type('text/html').send(data)
  } catch (err) {
    return reply.status(404).send(err)
  }
})

app.listen({ host: '0.0.0.0', port }, () => {
  console.log(`Listening on port ${port}`)
})
