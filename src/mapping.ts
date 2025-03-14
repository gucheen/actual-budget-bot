import fs from 'fs/promises'
import path from 'path'

let ACCOUNT_NAME_MAP: {
  [key: string]: string
} = {}
let PAYEE_MAP: {
  [key: string]: string
} = {}
let CATEGORP_MAP: {
  [key: string]: string
} = {}
try {
  await fs.access(path.join(import.meta.dirname, 'mapping.json'))
  const mapping = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'mapping.json'), 'utf-8'))
  ACCOUNT_NAME_MAP = mapping.ACCOUNT_NAME_MAP || {}
  PAYEE_MAP = mapping.PAYEE_MAP || {}
  CATEGORP_MAP = mapping.CATEGORP_MAP || {}
  console.log('mappings >>>')
  console.log(mapping)
} catch (error) {
  console.log('no mappings')
}

export function getMappings() {
  return {
    ACCOUNT_NAME_MAP,
    PAYEE_MAP,
    CATEGORP_MAP,
  }
}
