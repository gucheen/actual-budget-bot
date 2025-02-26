# actual-budget-bot

actual-budget-bot 一个自动导入交易信息到 actual budget 的应用。主要针对中国的常见支付应用（微信、支付宝、云闪付等）。

## 核心原理

- 对支付结果进行截屏
- 把截屏上传到应用内
- 使用预设的规则对截屏图片进行OCR识别（区分支付应用、设备）
- 将OCR结果转换成可用的交易数据
- 将交易数据导入 actual budget
