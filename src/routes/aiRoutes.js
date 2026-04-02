const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const aiService = require('../services/aiService');

// Multer: store file in memory
const upload = multer({ storage: multer.memoryStorage() });

router.post('/generate-post', async (req, res) => {
    try {
        const { prompt, rules } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Prompt is required" });
        }

        const result = await aiService.generatePost(prompt, rules);
        res.json(result);

    } catch (error) {
        res.status(500).json({ error: "Failed to generate post", details: error.message });
    }
});

router.post('/generate-description', async (req, res) => {
    try {
        const { prompt, rules } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Prompt is required" });
        }

        const result = await aiService.generateCampaignDescription(prompt, rules);
        res.json(result);

    } catch (error) {
        res.status(500).json({ error: "Failed to generate description", details: error.message });
    }
});

router.post('/parse-expenditure-excel', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "File is required" });
        }

        // Parse Excel/CSV from in-memory buffer
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Convert to plain text (CSV-like) so AI can read it
        const csvText = XLSX.utils.sheet_to_csv(sheet);

        if (!csvText || csvText.trim().length === 0) {
            return res.status(400).json({ error: "File appears to be empty" });
        }

        // Limit raw text size to avoid token overflow (max ~8000 chars)
        const truncatedText = csvText.length > 8000 ? csvText.substring(0, 8000) + '\n...(truncated)' : csvText;

        const items = await aiService.parseExpenditureFromText(truncatedText);
        res.json({ items });

    } catch (error) {
        console.error('Error parsing Excel:', error);
        res.status(500).json({ error: "Failed to parse Excel file", details: error.message });
    }
});

router.post('/ocr-kyc', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Image file is required" });
        }

        const result = await aiService.ocrKYC(req.file.buffer, req.file.mimetype);
        res.json(result);

    } catch (error) {
        console.error('CRITICAL OCR ROUTE ERROR:', error);
        res.status(500).json({
            error: "Failed to process image",
            details: error.message
        });
    }
});

module.exports = router;
