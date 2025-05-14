// commonConfig.js
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const mime = require('mime-types');

// 이미지 경로
const DEFAULT_IMAGE_NAME = 'chilsung_eng2.jpg';
const TEST_IMG_DIR = path.resolve(__dirname, 'test_img');

const getDefaultImagePath = () => path.join(TEST_IMG_DIR, DEFAULT_IMAGE_NAME);

// 이미지 base64 처리 공통 함수
async function prepareImageForGemini(pathOrUrl, isUrl = false) {
  let buffer, mimeType;

  if (isUrl) {
    const response = await axios.get(pathOrUrl, { responseType: 'arraybuffer' });
    buffer = Buffer.from(response.data);
    const extension = path.extname(pathOrUrl).split('?')[0];
    mimeType = mime.lookup(extension) || 'image/png';
  } else {
    buffer = fs.readFileSync(pathOrUrl);
    const extension = path.extname(pathOrUrl);
    mimeType = mime.lookup(extension) || 'image/png';
  }

  return {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };
}

module.exports = {
  getDefaultImagePath,
  prepareImageForGemini,
};
