const Groq = require('groq-sdk');
const axios = require('axios');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const generatePost = async (prompt, rules = "") => {
    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: `Viết bài đăng: ${prompt}\nRules: ${rules}` }],
            model: "llama-3.3-70b-versatile",
        });
        return completion.choices[0]?.message?.content;
    } catch (e) { throw e; }
};

const generateCampaignDescription = async (prompt, rules = "") => {
    try {
        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: `Bạn là chuyên gia viết mô tả chiến dịch quyên góp từ thiện. Dựa trên thông tin sau, hãy tạo tiêu đề và mô tả chiến dịch bằng tiếng Việt.

Thông tin chiến dịch: ${prompt}
${rules ? `Quy tắc: ${rules}` : ''}

Hãy trả lời CHÍNH XÁC theo format JSON sau (không có gì khác ngoài JSON):
{
  "title": "Tiêu đề chiến dịch (dưới 100 ký tự, xúc tích, gây ấn tượng)",
  "description": "Mô tả chi tiết chiến dịch (300-800 từ, cảm động, minh bạch, chuyên nghiệp)"
}`
            }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const raw = completion.choices[0]?.message?.content;
        // Parse JSON response — strip markdown code blocks if any
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        return {
            title: parsed.title || "",
            description: parsed.description || parsed.mo_ta || parsed.moTa || raw
        };
    } catch (e) {
        console.error("[AI] generateCampaignDescription error:", e.message);
        throw e;
    }
};

const parseExpenditureFromText = async (text) => {
    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: `Parse JSON items: ${text}` }],
            model: "llama-3.1-8b-instant",
            response_format: { type: "json_object" }
        });
        const res = JSON.parse(completion.choices[0]?.message?.content);
        return res.items || res;
    } catch (e) { throw e; }
};

const ocrKYC = async (imageBuffer, mimeType, side = 'front') => {
    const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
    const base64Image = imageBuffer.toString("base64");
    let lastError = "";

    const promptText = side === 'front' 
        ? "Bạn là một AI trích xuất dữ liệu (OCR) cực kỳ nghiêm ngặt. Hãy trích xuất thông tin MẶT TRƯỚC từ thẻ này (CCCD/CMND/Hộ chiếu/Bằng lái) sang JSON: {idType, idNumber, fullName, dateOfBirth, gender, placeOfOrigin, placeOfResidence, expiryDate, issueDate, issuePlace}.\n\nNGUYÊN TẮC BẮT BUỘC:\n1. TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT, KHÔNG SUY ĐOÁN thông tin.\n2. Chỉ trích xuất đúng những chữ NHÌN THẤY RÕ RÀNG trên ảnh.\n3. Nếu bị mờ, khuất, hoặc thẻ không có thông tin đó, BẮT BUỘC phải đặt giá trị là chuỗi rỗng \"\".\n4. Trả về duy nhất JSON hợp lệ."
        : "Bạn là một AI trích xuất dữ liệu (OCR) cực kỳ nghiêm ngặt. Hãy trích xuất thông tin MẶT SAU từ thẻ này sang JSON: {issueDate, issuePlace}.\n\nNGUYÊN TẮC BẮT BUỘC:\n1. TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT, KHÔNG SUY ĐOÁN thông tin.\n2. Mặt sau thường KHÔNG CÓ TÊN, KHÔNG CÓ ID. Hãy chỉ lấy đúng chữ nhìn thấy.\n3. Nếu thông tin không có trên ảnh, BẮT BUỘC đặt chuỗi rỗng \"\".\n4. Trả về duy nhất JSON hợp lệ.";

    try {
        console.log(`[AI-OCR] Calling Gemini v1beta for ${side} side...`);
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GOOGLE_KEY}`,
            {
                contents: [{
                    parts: [
                        { text: promptText },
                        { inline_data: { mime_type: mimeType || "image/jpeg", data: base64Image } }
                    ]
                }],
                generationConfig: {
                    temperature: 0.0, // Strictly deterministic, zero creativity
                    topK: 1,
                    topP: 0.1
                }
            }
        );

        const text = response.data.candidates[0].content.parts[0].text;
        const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(cleanJson);
    } catch (geminiErr) {
        lastError = geminiErr.response?.data?.error?.message || geminiErr.message;
        console.warn("[AI-OCR] Gemini failed:", lastError);

        // 2. Fallback to Groq
        try {
            console.log("[AI-OCR] Fallback to Groq...");
            const completion = await groq.chat.completions.create({
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: "OCR CCCD sang JSON: {idType, idNumber, fullName, dateOfBirth, gender, placeOfResidence}." },
                        { type: "image_url", image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}` } }
                    ]
                }],
                model: "llama-3.2-11b-vision-preview",
                response_format: { type: "json_object" }
            });
            return JSON.parse(completion.choices[0]?.message?.content);
        } catch (groqErr) {
            return { error: `Cả 2 AI đều lỗi. Gemini: ${lastError} | Groq: ${groqErr.message}` };
        }
    }
};

const analyzeFlag = async (t, f) => ({ summary: "Analysis..." });
const analyzeExpenditure = async (c, e, i) => ({ summary: "Analysis..." });
const analyzeEvidence = async (id, pl, pu, am, it, ph, dt) => ({ summary: "Analysis..." });
const generateSuggestionLabels = async (p) => ({ labels: ["Charity"] });

module.exports = { generatePost, generateCampaignDescription, parseExpenditureFromText, ocrKYC, analyzeFlag, analyzeExpenditure, analyzeEvidence, generateSuggestionLabels };
