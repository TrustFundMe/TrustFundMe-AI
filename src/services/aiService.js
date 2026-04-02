const Groq = require('groq-sdk');
const axios = require('axios');

if (!process.env.GROQ_API_KEY) {
    console.warn("WARNING: GROQ_API_KEY is not defined in .env file!");
}
if (!process.env.GOOGLE_API_KEY) {
    console.warn("WARNING: GOOGLE_API_KEY is not defined in .env file!");
}

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// Using Gemini 2.5 Flash as stable model for 2026 Vision tasks
const GEMINI_MODEL = "gemini-2.5-flash"; 

const generatePost = async (prompt, rules = "") => {
    try {
        let systemPrompt = `Bạn là trợ lý TrustFundMe. Viết bài quyên góp cảm động. Trả về JSON: { "title": string, "content": string, "hashtags": array, "call_to_action": string }`;
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 1024,
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0]?.message?.content);
    } catch (e) { console.error("Post error:", e); throw e; }
};

const generateCampaignDescription = async (prompt, rules = "") => {
    try {
        let systemPrompt = `Bạn là trợ lý TrustFundMe. Viết mô tả chiến dịch. Trả về JSON: { "title": string, "description": string }`;
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.8,
            max_tokens: 2048,
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0]?.message?.content);
    } catch (e) { console.error("Desc error:", e); throw e; }
};

const parseExpenditureFromText = async (rawText) => {
    try {
        const systemPrompt = `Phân tích dữ liệu chi tiêu. Trả về JSON: { "items": [{ "name", "unit", "quantity", "price", "note" }] }`;
        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: rawText }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            max_tokens: 4096,
            response_format: { type: "json_object" }
        });
        const parsed = JSON.parse(completion.choices[0]?.message?.content);
        return parsed.items || [];
    } catch (e) { console.error("Excel error:", e); throw e; }
};

const ocrKYC = async (imageBuffer, mimeType) => {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error("GOOGLE_API_KEY missing");

    try {
        console.log(`[AI-OCR] Processing with ${GEMINI_MODEL}...`);
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
        
        const prompt = `Bạn là hệ thống OCR giấy tờ định danh chuyên nghiệp, hỗ trợ các loại: CCCD/CMND Việt Nam, Hộ chiếu (Passport), và Bằng lái xe.

Phân tích ảnh và thực hiện theo các bước sau:

BƯỚC 1 - Kiểm tra chất lượng ảnh:
- Nếu ảnh quá mờ, bị che khuất, không phải giấy tờ định danh hợp lệ, hoặc không thể đọc được thông tin quan trọng, hãy trả về JSON: { "error": "Lý do cụ thể (VD: Ảnh mờ không rõ nét | Không phải giấy tờ định danh | Ảnh bị che khuất thông tin quan trọng)" }

BƯỚC 2 - Xác định loại giấy tờ và trích xuất thông tin:
- CCCD/CMND: idType = "CCCD"
- Hộ chiếu (Passport): idType = "PASSPORT"  
- Bằng lái xe: idType = "DRIVER_LICENSE"

Trả về JSON với các trường sau (để null nếu không có trên loại giấy tờ đó):
{
  "idType": "CCCD" | "PASSPORT" | "DRIVER_LICENSE",
  "idNumber": "số giấy tờ",
  "fullName": "họ và tên",
  "dateOfBirth": "YYYY-MM-DD",
  "gender": "Nam/Nữ",
  "nationality": "quốc tịch",
  "placeOfOrigin": "quê quán (CCCD)",
  "placeOfResidence": "nơi thường trú (CCCD)",
  "issueDate": "YYYY-MM-DD",
  "expiryDate": "YYYY-MM-DD",
  "issuePlace": "nơi cấp"
}

Lưu ý quan trọng: Chỉ trả về JSON thuần túy, KHÔNG có ký tự Markdown hay code block. Tất cả ngày tháng dùng định dạng YYYY-MM-DD.`;

        const response = await axios.post(url, {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inlineData: {
                            mimeType: mimeType || "image/jpeg",
                            data: imageBuffer.toString("base64")
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0,
                responseMimeType: "application/json"
            }
        });

        const textResult = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log(`[AI-OCR] Extract Result:`, textResult);
        
        if (textResult) {
            return JSON.parse(textResult);
        }

    } catch (error) {
        console.error("Critical AI-OCR Error:", error.response ? error.response.data : error.message);
        throw error;
    }

    return { idNumber: null, fullName: null };
};

module.exports = { generatePost, generateCampaignDescription, parseExpenditureFromText, ocrKYC };
