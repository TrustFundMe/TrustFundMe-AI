require('dotenv').config();
const aiService = require('./src/services/aiService');


const testPrompt = "Bé Hải, 6 tuổi, mổ tim, cần 50 triệu, BV Nhi Đồng";

console.log("Testing generation with prompt:", testPrompt);

async function runTest() {
    try {
        const result = await aiService.generatePost(testPrompt);
        console.log("\n--- Generated Result ---\n");
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Test Failed:", error);
    }
}

runTest();
