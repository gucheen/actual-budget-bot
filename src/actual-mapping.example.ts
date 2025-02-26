// 对支付对象的名称做映射，以解决不同平台、场景下同一个支付对象显示不同名称的情况
export const PAYEE_MAP: {
  [key: string]: string
} = {
  'payee from payment screenshot': 'payee in actual',
}

// 对支付方式（账户）的名称做映射，以解决不同平台、场景下同一个支付方式（账户）显示不同名称的情况
export const ACCOUNT_NAME_MAP: {
  [key: string]: string
} = {
  'account name from payment screenshot': 'account name in actual',
}
