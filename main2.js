require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mime = require("mime-types");
const XLSX = require("xlsx");
const stringSimilarity = require("string-similarity");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });

function cleanUrl(url) {
  if (!url) return null;
  let cleaned = url
    .replace("hacccp.or.kr", "haccp.or.kr")
    .replace(".krr", ".kr")
    .replace(/[\s\n\r\t]+/g, "")
    .trim();

  if (!/^https?:\/\//.test(cleaned)) {
    cleaned = "https://" + cleaned;
  }

  return cleaned;
}

function deduplicateByImageUrl(candidates) {
  const seen = new Set();
  return candidates.filter(c => {
    const url = cleanUrl(c.row.imgurl1);
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

async function prepareImageForGemini(pathOrUrl, isUrl = false) {
  let buffer, mimeType;
  if (isUrl) {
    const response = await axios.get(pathOrUrl, { responseType: "arraybuffer" });
    buffer = Buffer.from(response.data);
    const ext = path.extname(pathOrUrl).split("?")[0];
    mimeType = mime.lookup(ext) || "image/png";
  } else {
    buffer = fs.readFileSync(pathOrUrl);
    const ext = path.extname(pathOrUrl);
    mimeType = mime.lookup(ext) || "image/png";
  }
  return {
    inlineData: {
      mimeType,
      data: buffer.toString("base64"),
    },
  };
}

async function analyzeImageWithGemini(base64Image, maxRetries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const requestData = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: `다음 이미지를 분석해서 상품별로 반드시 다음 형식의 JSON만을 반환. 
            {
              "상품명1": { "한글": "한글명", "영어": "영문명" },
              "상품명2": { "한글": "한글명", "영어": "영문명" }
            }`
          }
        ]
      }
    ]
  };

  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await axios.post(url, requestData);
      let rawText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      rawText = rawText.trim();

      if (rawText.startsWith("```")) {
        rawText = rawText.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
      }

      const parsed = JSON.parse(rawText);
      return parsed;
    } catch (error) {
      attempt++;
      console.warn(`❗ Gemini 응답 파싱 실패 - 재시도 중 (${attempt}/${maxRetries})`);
      if (attempt >= maxRetries) {
        throw new Error("📛 Gemini 응답을 JSON으로 파싱하지 못했습니다. 최대 재시도 횟수 초과.");
      }
    }
  }
}


async function isSameProductImage(baseImagePath, compareImageUrl) {
    const baseImage = await prepareImageForGemini(baseImagePath);
    const targetImage = await prepareImageForGemini(compareImageUrl, true);
  
    const prompt = `
  You are an expert-level image comparison system specializing in product identification.
  
  Your task is to determine if the two provided images represent the **same exact product**.
  
  Use the following strict criteria to make your decision:
  
  1. Identical product name text (visible on the packaging)
  2. Matching brand logo or specific design elements
  3. Consistent packaging color, layout, and visual motifs
  4. Identical structure, labels, and characters (OCR-based comparison allowed)
  
  Priority should be given to the product name.
  
  Output Format:
  Return only one of the following JSON objects, with nothing else:
  
  If the images show the same product:
  { "sameProduct": true }
  
  If the images show different products:
  { "sameProduct": false }
  
  Absolutely no other commentary or explanations. Return only valid JSON.`;
  
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            baseImage,
            targetImage,
          ],
        },
      ],
    });
  
    let reply = result.response.text().trim();
  
    // Remove code block markdown if included
    if (reply.startsWith("```")) {
      reply = reply.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
    }
  
    try {
      const parsed = JSON.parse(reply);
      return parsed.sameProduct === true;
    } catch (err) {
      console.warn("⚠️ Failed to parse Gemini response. Raw reply:\n", reply);
      return false;
    }
  }

  async function geminiSelectMostLikelyCandidate(baseImagePath, candidates) {
    const baseImage = await prepareImageForGemini(baseImagePath);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
  
    const prompt = `
  아래 제품 후보 중, 첫 번째 이미지(기준 이미지)와 가장 유사해 보이는 하나의 제품 이미지를 골라줘.
  선택 기준은 제품명, 포장 색, 구조, 글자, 브랜드, 전반적인 외관 등을 종합적으로 고려한 이미지 유사성이다.
  반드시 JSON 형식으로 다음처럼 반환해:
  { "selectedUrl": "http://..." }
  
  후보 이미지들:
  ${candidates.map(c => cleanUrl(c.row.imgurl1)).join("\n")}
  `;
  
    let attempt = 1;
  
    while (attempt <= 3) {
      try {
        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                baseImage
              ]
            }
          ]
        });
  
        let reply = result.response.text().trim();
        if (reply.startsWith("```")) {
          reply = reply.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
        }
  
        const parsed = JSON.parse(reply);
        return parsed.selectedUrl;
      } catch (err) {
        console.warn(`⚠️ Gemini Fallback 응답 파싱 실패 - ${attempt}회차 재시도 중...`);
        attempt++;
        await new Promise(res => setTimeout(res, 1000)); // 1초 대기
      }
    }
  
    console.error("❌ Gemini fallback JSON 파싱 3회 실패: 후보 선택 불가");
    return null;
  }
  
  

async function extractProductNamesFromImage(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  const base64Image = buffer.toString("base64");
  return await analyzeImageWithGemini(base64Image);
}

function findRoughlySimilarProducts(targetName, data, topN = 30) {
  const nameToRowMap = new Map();
  const names = [];

  for (const row of data) {
    const name = row["prdlstNm"];
    if (name) {
      names.push(name);
      nameToRowMap.set(name, row);
    }
  }

  const result = stringSimilarity.findBestMatch(targetName, names);
  
  return result.ratings
    .sort((a, b) => b.rating - a.rating)
    .slice(0, topN)
    .map(match => ({
      ...match,
      row: nameToRowMap.get(match.target)
    }))
    .filter(item => item.row?.imgurl1);
}


async function refineWithGemini(productName, candidates, topN = 5) {
  const prompt = `
다음은 "${productName}"이라는 상품명과 유사한 제품 이름 목록이야.
가장 유사한 상품을 ${topN}개의 JSON 배열로만 반환해줘.

예시:
["제품A", "제품B", "제품C"]

제품 리스트:
${candidates.map(c => `- ${c.target}`).join("\n")}
`;
  const result = await model.generateContent(prompt);
  let reply = result.response.text().trim();
  if (reply.startsWith("```")) {
    reply = reply.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
  }
  return JSON.parse(reply);
}

async function compareImagesToFindExactMatch(baseImagePath, candidates) {
  // 실제 비교 함수
  async function tryMatch() {
    for (const candidate of candidates) {
      const fixedUrl = cleanUrl(candidate.row.imgurl1);
      const isSame = await isSameProductImage(baseImagePath, fixedUrl);
      if (isSame) {
        return {
          matched: candidate.row,
          imageUrl: fixedUrl
        };
      }
    }
    return null;
  }

  // 첫 시도
  let result = await tryMatch();

  // 실패 시 한 번 더 재시도 (fallback 반환)
  if (!result) {
    console.log("🔄 Gemini를 사용해 최적 후보 fallback 시도...");
    const selectedUrl = await geminiSelectMostLikelyCandidate(baseImagePath, candidates);
    if (selectedUrl) {
      const match = candidates.find(c => cleanUrl(c.row.imgurl1) === selectedUrl);
      if (match) {
        return {
          matched: match.row,
          imageUrl: selectedUrl
        };
      }
    }
  }

  return result;
}

async function main(imagePath, excelPath) {
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  const productMap = await extractProductNamesFromImage(imagePath);

  for (const [productKey, names] of Object.entries(productMap)) {
    console.log(`📌 분석된 상품명: ${names.한글} (${names.영어})`);

    const candidates = findRoughlySimilarProducts(names.한글, data);
    const refinedNames = await refineWithGemini(names.한글, candidates);
    const refinedCandidates = candidates.filter(c => refinedNames.includes(c.target));

    const uniqueCandidates = deduplicateByImageUrl(refinedCandidates);
    console.log("🔍 이미지 비교 대상 목록:");
    uniqueCandidates.forEach(c => console.log(`- ${c.target}: ${cleanUrl(c.row.imgurl1)}`));

    const finalMatch = await compareImagesToFindExactMatch(imagePath, uniqueCandidates);

    if (finalMatch) {
      console.log(`✅ 최종 매칭된 상품: ${finalMatch.matched.prdlstNm}`);
      console.log(`⚠️ 알레르기 정보: ${finalMatch.matched.allergy || "정보 없음"}`);
      console.log(`🖼️ 이미지: ${cleanUrl(finalMatch.imageUrl)}`);//출력은 되는데 url이 이상함;;
    } else {
      console.log("❌ 최종 매칭 실패: 이미지 상 동일한 제품을 찾을 수 없음.");
    }
  }
}

// 예시 실행
main("./DB/banana.jpg", "./DB/all_data.xlsx");
