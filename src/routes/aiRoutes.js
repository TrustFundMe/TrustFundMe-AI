const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');

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

module.exports = router;
