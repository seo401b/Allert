const path = require('path');
const { extractTextFromImage, filterProductCandidates, matchProductName } = require('./ocrMatcher');

async function main() {
  try {
    const imagePath = path.resolve(__dirname, 'test_img', 'milkpopcorn.png');
    const text = await extractTextFromImage(imagePath);

    const candidates = filterProductCandidates(text);
    const matches = matchProductName(candidates);

    console.log('✅ OCR 추출 텍스트 후보:\n', candidates);
    console.log('\n🎯 최종 매칭 결과:\n', matches);
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  }
}

main();
