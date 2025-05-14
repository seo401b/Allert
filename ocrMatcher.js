require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const _ = require('lodash');
const xlsx = require('xlsx');
const stringSimilarity = require('string-similarity');

// Load DB
const path = require('path');
const workbook = xlsx.readFile(path.join(__dirname, 'DB', 'all_data.xlsx'));
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
  if (!str || typeof str !== 'string') return '';
  return str.replace(/\s+/g, '').toLowerCase();
}

/** DB와 후보 매칭 - 유사도 기반 상위 3개만 반환 */

function matchProductName(candidates) {
  const matchScores = [];

  for (const line of candidates) {
    const normLine = normalize(line);

    for (const product of productDB) {
      const names = [product.prdlstNm, ...(product.Alias || '').split(',')];

      for (const name of names) {
        if (!name) continue;
        const normName = normalize(name);
        const score = stringSimilarity.compareTwoStrings(normLine, normName);

        matchScores.push({
          match: product.prdlstNm,
          alias: name,
          line,
          score,
          allergens: (product.allergy || '').split(',').map(s => s.trim())
        });
      }
    }
  }

  const sorted = _.orderBy(matchScores, ['score'], ['desc']);
  const topMatches = _.uniqBy(sorted, 'match').slice(0, 3); // 상위 3개

  return topMatches.map(({ match, line, allergens }) => ({ match, line, allergens }));
}

const { GoogleGenerativeAI } = require('@google/generative-ai')
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({model: "gemini-2.0-flash"});

//한영 변환
async function getKorEngJSONPair(name) {
  const prompt = `
  "${name}"를 한국어 <-> 영어 1:1 변환.
  다른 출력 없이 JSON 형식으로만.
  예시 :
  {
    "korean": "한글",
    "english": "영어"
  }
  `;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt}] }],
  });

  let raw = result.response.text().trim();
  raw = raw.replace(/```json|```/g, '').trim();


  try {
    const parsed = JSON.parse(raw);

    console.log(' Gemini 응답 파싱 결과 (JS 객체):', parsed);
  
    const variants = new Set([name]);
    if (parsed.korean) variants.add(parsed.korean);
    if (parsed.english) variants.add(parsed.english);
    return Array.from(variants);
  } catch (err) {
    console.error('Gemini JSON 파싱 실패:', raw);
    return [name];
  }
}

const { getDefaultImagePath } = require('./commonConfig');

async function getTopMatches() {
  const imagePath = getDefaultImagePath();
  const text = await extractTextFromImage(imagePath);
  const rawCandidates = filterProductCandidates(text);

  const variantSet = new Set();

  for (const cand of rawCandidates) {
    const variants = await getKorEngJSONPair(cand);
    variants.forEach(v => variantSet.add(v));
  }

  return matchProductName(Array.from(variantSet));
}

module.exports = {
  extractTextFromImage,
  filterProductCandidates,
  matchProductName,
  getKorEngJSONPair,
  getTopMatches
};
