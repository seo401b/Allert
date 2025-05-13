require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const _ = require('lodash');
const xlsx = require('xlsx');
const stringSimilarity = require('string-similarity');

// Load DB
const workbook = xlsx.readFile('식품_제품_리스트.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const productDB = xlsx.utils.sheet_to_json(sheet);

/** OCR로 텍스트 추출 - REST API 방식 */
async function extractTextFromImage(imagePath) {
  const imageBytes = fs.readFileSync(imagePath, { encoding: 'base64' });

  const requestBody = {
    requests: [
      {
        image: { content: imageBytes },
        features: [{ type: 'TEXT_DETECTION' }]
      }
    ]
  };

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

  const response = await axios.post(url, requestBody, {
    headers: { 'Content-Type': 'application/json' }
  });

  const annotations = response.data.responses[0].textAnnotations;
  return annotations && annotations.length > 0 ? annotations[0].description : '';
}

/** 텍스트 후보 필터링 (상품명 후보) */
function filterProductCandidates(text) {
  const lines = text.split(/\n/).map(line => line.trim());
  return lines.filter(line => /^[가-힣a-zA-Z0-9\s\-]+$/.test(line));
}

/** 문자열 정규화 */
function normalize(str) {
  return str.replace(/\s+/g, '').toLowerCase();
}

/** DB와 후보 매칭 - 유사도 기반 상위 3개만 반환 */

function matchProductName(candidates) {
  const matchScores = [];

  for (const line of candidates) {
    const normLine = normalize(line);

    for (const product of productDB) {
      const names = [product.제품명, ...(product.Alias || '').split(',')];

      for (const name of names) {
        const normName = normalize(name);
        const score = stringSimilarity.compareTwoStrings(normLine, normName);

        matchScores.push({
          match: product.제품명,
          alias: name,
          line,
          score,
          allergens: (product.알레르기 || '').split(',').map(s => s.trim())
        });
      }
    }
  }

  const sorted = _.orderBy(matchScores, ['score'], ['desc']);
  const topMatches = _.uniqBy(sorted, 'match').slice(0, 3); // 상위 3개

  return topMatches.map(({ match, line, allergens }) => ({ match, line, allergens }));
}

module.exports = {
  extractTextFromImage,
  filterProductCandidates,
  matchProductName
};
