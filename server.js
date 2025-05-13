require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const { extractTextFromImage, filterProductCandidates, matchProductName } = require('./ocrMatcher');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const text = await extractTextFromImage(imagePath);
    const candidates = filterProductCandidates(text);
    const matches = matchProductName(candidates);

    res.json({ matches });
  } catch (err) {
    console.error(err);
    res.status(500).send('OCR 처리 중 오류 발생');
  }
});

app.listen(3000, () => console.log('Server started on port 3000'));
