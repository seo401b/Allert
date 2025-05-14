require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mime = require('mime-types');
const { getTopMatches } = require('./ocrMatcher'); // 이 함수가 ocrMatcher.js에 export 되어 있어야 함
const xlsx = require('xlsx');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Gemini 설정
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro-preview-05-06" });

/** 이미지 파일을 base64로 인코딩하고 mime-type 자동 판별 */
// async function prepareImageForGemini(pathOrUrl, isUrl = false) {
//   let buffer;
//   let mimeType;

//   if (isUrl) {
//     const response = await axios.get(pathOrUrl, { responseType: 'arraybuffer' });
//     buffer = Buffer.from(response.data);
//     const extension = path.extname(pathOrUrl).split('?')[0]; // 쿼리스트링 제거
//     mimeType = mime.lookup(extension) || 'image/png';
//   } else {
//     buffer = fs.readFileSync(pathOrUrl);
//     const extension = path.extname(pathOrUrl);
//     mimeType = mime.lookup(extension) || 'image/png';
//   }

//   return {
//     inlineData: {
//       mimeType,
//       data: buffer.toString('base64'),
//     },
//   };
// }

/** Gemini를 통해 비교 수행 */
async function compareImagesWithGemini(comparePath, matchImageUrls) {
    const baseImage = await prepareImageForGemini(comparePath);
    const results = [];
  
    for (const url of matchImageUrls) {
      const targetImage = await prepareImageForGemini(url, true);
  
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "두 이미지를 비교해서 제품명이 같은 제품인지 판단해줘. 같으면 '유사함', 다르면 '다름'이라고만 대답해.",
              },
              baseImage,
              targetImage,
            ],
          },
        ],
      });
  
      results.push({ url, result: result.response.text().trim() });
    }
  
    return results;
  }
  

/** 엑셀에서 URL 가져오기 */
function getImageUrlsFromExcel(matches) {
  const workbook = xlsx.readFile(path.join(__dirname, 'DB', 'all_data.xlsx'));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  return matches
    .map(({ match }) => {
      const item = data.find(row => row.prdlstNm === match);
      return item?.imgurl1;
    })
    .filter(Boolean);
}

const { getDefaultImagePath, prepareImageForGemini } = require('./commonConfig');

// 메인 함수
(async () => {
  const topMatches = await getTopMatches();

  console.log('OCR 분석된 유사 제품 3가지:');
  topMatches.forEach((match, idx) => {
    console.log(`${idx + 1}. 제품명: ${match.match}, 원본 텍스트: "${match.line}", 알레르겐: [${match.allergens.join(', ')}]`);
  });

  const urls = getImageUrlsFromExcel(topMatches);

  const compareImagePath = getDefaultImagePath(); // ✅ 공통 함수 사용
  const results = await compareImagesWithGemini(compareImagePath, urls);

  console.log('\n Gemini 비교 결과:');
  results.forEach(r => console.log(`✅ URL: ${r.url} → 결과: ${r.result}`));
})();

