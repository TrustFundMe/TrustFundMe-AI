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
const ANALYSIS_MODEL = "llama-3.3-70b-versatile"; 

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

const analyzeFlag = async (targetData, flags) => {
    const systemPrompt = `Bạn là chuyên gia phân tích rủi ro cho nền tảng quyên góp TrustFundMe. Bạn sẽ phân tích chi tiết chiến dịch/bài viết dựa trên:
1. Thông tin cơ bản của đối tượng (tiêu đề, mô tả, số liệu tài chính, người tạo...)
2. Danh sách các báo cáo vi phạm từ người dùng

Hãy đưa ra phân tích khách quan, chi tiết và đề xuất hành động phù hợp cho staff quản lý.

Trả về JSON thuần túy (KHÔNG markdown) với cấu trúc:
{
  "summary": "Tóm tắt ngắn 1-2 câu về tình trạng",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "riskScore": số từ 0-100,
  "keyFindings": ["điểm 1", "điểm 2", ...] (3-5 điểm chính),
  "concerns": ["lo ngại 1", "lo ngại 2", ...] (các vấn đề đáng chú ý),
  "recommendation": "đề xuất hành động cụ thể cho staff",
  "actionTypes": ["HIDE_POST" | "DELETE_POST" | "LOCK_ACCOUNT" | "REQUIRE_DOCUMENT" | "APPROVE" | "WARN_USER"] (các hành động nên thực hiện),
  "confidence": "LOW" | "MEDIUM" | "HIGH" (mức độ chắc chắn của phân tích)
}`;

    const prompt = `
ĐỐI TƯỢNG CẦN PHÂN TÍCH:
${JSON.stringify(targetData, null, 2)}

DANH SÁCH BÁO CÁO VI PHẠM:
${flags.map((f, i) => `
Báo cáo #${i + 1}:
- Người báo cáo: ${f.reporterName || 'Vô danh'} (ID: ${f.userId})
- Lý do: "${f.reason}"
- Ngày: ${f.createdAt}
- Trạng thái: ${f.status}
`).join('\n')}
`.trim();

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            model: ANALYSIS_MODEL,
            temperature: 0.3,
            max_tokens: 2048,
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(completion.choices[0]?.message?.content);
        return result;
    } catch (e) {
        console.error("Flag analysis error:", e);
        throw e;
    }
};

const generateSuggestionLabels = async (params) => {
    const { amount, options } = params;
    const systemPrompt = `Bạn là trợ lý gợi ý quyên góp cho nền tảng TrustFundMe.
Với mỗi tổ hợp vật phẩm, hãy gắn 1 nhãn ngắn gọn (tối đa 5 từ tiếng Việt) phản ánh ĐÚNG NHU CẦU THỰC TẾ trong tổ hợp đó.

QUY TẮC ĐẶT NHÃN:
- Dựa vào TÊN VẬT PHẨM trong tổ hợp để đặt nhãn
- Ưu tiên gom nhóm theo loại: lương thực, quần áo, thuốc men, đồ dùng, vv.
- Nếu tổ hợp có gạo + mì + nước mắm → "Gói lương thực"
- Nếu có áo quần nhiều → "Gói quần áo"
- Nếu có đủ các loại → "Gói tổng hợp"
- Nếu chỉ có 1-2 loại → dùng đúng tên loại đó
- Nếu diff = 0 hoặc gần 0 → thêm "vừa đủ" hoặc "đủ dùng"
- KHÔNG dùng nhãn chung chung như "Gói cơ bản", "Tiết kiệm", "Cao cấp"

Ví dụ:
- {gạo×2, mì×3} → "Gói lương thực"
- {áo dài×2, quần×1} → "Gói quần áo"
- {gạo×1, áo×2, thuốc×1} → "Gói tổng hợp"

Trả về JSON thuần túy (KHÔNG markdown):
{ "labels": ["nhãn 1", "nhãn 2", ...] }`;

    const prompt = `Số tiền quyên góp: ${Number(amount).toLocaleString('vi-VN')} ₫

Danh sách tổ hợp vật phẩm:
${options.map((opt, i) => `
Tổ hợp #${i + 1}:
- Tổng tiền: ${Number(opt.total).toLocaleString('vi-VN')} ₫ (chênh: ${opt.diff >= 0 ? '+' : ''}${Number(opt.diff).toLocaleString('vi-VN')} ₫)
- Vật phẩm: ${opt.items.map(it => `${it.name} × ${it.quantity} (${Number(it.price).toLocaleString('vi-VN')} ₫/cái)`).join(', ')}
`).join('')}

Trả về JSON { "labels": [...] }`;

    try {
        console.log("[labels] calling Groq with amount:", amount, "options:", options.length);
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.4,
            max_tokens: 512
        });
        const raw = completion.choices[0]?.message?.content || '{}';
        console.log("[labels] Groq raw response:", raw.substring(0, 200));
        const result = JSON.parse(raw);
        return Array.isArray(result.labels) ? result.labels : [];
    } catch (e) {
        console.error("[labels] Groq error:", e.message);
        return []; // Graceful — fall back to local labels
    }
};

module.exports = { generatePost, generateCampaignDescription, parseExpenditureFromText, ocrKYC, analyzeFlag, generateSuggestionLabels };
