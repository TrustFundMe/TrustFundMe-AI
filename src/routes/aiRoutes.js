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

router.post('/analyze-flag', async (req, res) => {
    try {
        const { targetData, flags } = req.body;

        if (!targetData) {
            return res.status(400).json({ error: "targetData is required" });
        }
        if (!flags || !Array.isArray(flags) || flags.length === 0) {
            return res.status(400).json({ error: "flags array is required" });
        }

        const result = await aiService.analyzeFlag(targetData, flags);
        res.json(result);

    } catch (error) {
        res.status(500).json({ error: "Failed to analyze flag", details: error.message });
    }
});

router.post('/analyze-expenditure', async (req, res) => {
    try {
        const { campaign, expenditure, items } = req.body;

        if (!campaign) {
            return res.status(400).json({ error: "campaign is required" });
        }
        if (!expenditure) {
            return res.status(400).json({ error: "expenditure is required" });
        }

        const result = await aiService.analyzeExpenditure(campaign, expenditure, items || []);
        res.json(result);

    } catch (error) {
        res.status(500).json({ error: "Failed to analyze expenditure", details: error.message });
    }
});

router.post('/generate-suggestion-labels', async (req, res) => {
    try {
        const { amount, options } = req.body;
        console.log("[route] /generate-suggestion-labels called, amount:", amount, "options:", options?.length);

        if (!amount || !options || !Array.isArray(options)) {
            return res.status(400).json({ error: "amount and options[] are required" });
        }

        console.log("[route] calling aiService...");
        const labels = await aiService.generateSuggestionLabels({ amount, options });
        console.log("[route] labels result:", labels, "type:", typeof labels, "isArray:", Array.isArray(labels));
        res.json({ labels });

    } catch (error) {
        console.error("[route] ERROR:", error.message, error.stack);
        res.status(500).json({ error: "Failed to generate suggestion labels", details: error.message });
    }
});

router.post('/analyze-evidence', async (req, res) => {
    try {
        const { expenditureId, plan, purpose, totalAmount, items, photoUrls, createdAt } = req.body;

        if (!photoUrls || !Array.isArray(photoUrls) || photoUrls.length === 0) {
            return res.status(400).json({ error: "photoUrls array is required and must not be empty" });
        }

        const result = await aiService.analyzeEvidence(expenditureId, plan, purpose, totalAmount, items || [], photoUrls, createdAt);
        res.json(result);

    } catch (error) {
        console.error('[analyze-evidence] Error:', error.message);
        res.status(500).json({ error: "Failed to analyze evidence", details: error.message });
    }
});

module.exports = router;

