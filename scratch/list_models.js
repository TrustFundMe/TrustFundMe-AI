const axios = require('axios');
require('dotenv').config();

async function listModels() {
    try {
        console.log("Checking Gemini models...");
        const geminiRes = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_API_KEY}`);
        console.log("Gemini Models:", JSON.stringify(geminiRes.data.models.map(m => m.name), null, 2));

        console.log("\nChecking Groq models...");
        const groqRes = await axios.get("https://api.groq.com/openai/v1/models", {
            headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` }
        });
        console.log("Groq Models:", JSON.stringify(groqRes.data.data.map(m => m.id), null, 2));
    } catch (e) {
        console.error("Error:", e.response?.data || e.message);
    }
}

listModels();
