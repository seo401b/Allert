const path = require('path');
const { extractTextFromImage, filterProductCandidates, matchProductName } = require('./ocrMatcher');

async function getTopMatches() {
  const imagePath = path.resolve(__dirname, 'test_img', 'milkpopcorn.png');
  const text = await extractTextFromImage(imagePath);
  const candidates = filterProductCandidates(text);
  return matchProductName(candidates);
}

module.exports = {
  extractTextFromImage,
  filterProductCandidates,
  matchProductName,
  getTopMatches
};
