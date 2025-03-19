JSON.stringify(Array.from(document.querySelectorAll('.height-80')).map(item => {
  const [, block1, block2] = item.children
  const [summary, cardDesc, datetime] = Array.from(block1.children).map(block1Item => block1Item.textContent)
  const tradeAmount = block2.textContent

  return {
    summary: summary.trim(),
    cardDesc,
    datetime,
    tradeAmount,
  }
}))
