import fs from 'fs'
import { cnocr } from '../src/cnocr'
import path from 'path'
import { PaymentType } from '../src/constants'

try {
  const results = await cnocr({
    image: fs.readFileSync(path.join(import.meta.dirname, '../IMG_3653.PNG')),
    paymentType: PaymentType.UnionPayQuickPass,
  })

  console.log(results)

} catch (error) {
  console.error(error)
}
