# actual-budget-bot

actual-budget-bot 一个自动导入交易信息到 actual budget 的应用。主要针对中国的常见支付应用（微信、支付宝、云闪付等）。

## 核心原理

- 对支付结果进行截屏（从支付宝、微信、云闪付等应用的账单详情页截屏）
- 把截屏上传到应用内
- 使用 [cnocr](https://github.com/breezedeus/CnOCR) 对图片进行OCR识别（区分支付应用）
- 将OCR结果转换成可用的交易数据
- 将交易数据导入 actual budget

### 自动识别支付应用原理

根据支付截图中的特征文案，识别支付应用

- 微信支付：`交易单号`
- 支付宝: `订单号`
- 云闪付: `订单编号`

## 使用方法

### Docker

现在提供 nightly 版本的持续构建 Docker 镜像。

1. 下载 `compose.yml`
2. 复制 `.env.example` 为 `.env`，修改变量值，注意 `cnocr_server` 在 Docker compose 环境下应该设置为 `http://cnocr:8501`
3. 新建 `actual-mapping.ts`，配置账户、支付对象映射
4. 运行 `docker compose up -d`
5. 访问 `http://localhost:8000` 或者 `http://你的ip:8000`

### 手动安装

1. 部署你的 [cnocr](https://github.com/breezedeus/CnOCR) 服务
2. clone 项目到本地
3. `npm install`
4. 复制 `.env.example` 为 `.env`，修改变量值
5. 新建 `actual-mapping.ts`，配置账户、支付对象映射
6. 运行 `npm start`
7. 访问 `http://localhost:8000` 或者 `http://你的ip:8000`

## 界面预览

![actual-budget-bot 界面](preview.png)
