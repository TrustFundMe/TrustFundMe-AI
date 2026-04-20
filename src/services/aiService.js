const Groq = require('groq-sdk');
const axios = require('axios');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// Trích xuất JSON an toàn từ AI
const safeJsonParse = (text, fallback) => {
    if (!text) return fallback("");
    try {
        // Xử lý Markdown block nếu có
        const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        
        // Tìm khối {} đầu tiên
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && typeof parsed === 'object') return parsed;
        }

        // Thử parse toàn bộ nếu không thấy match regex
        const parsedAll = JSON.parse(cleaned);
        if (parsedAll && typeof parsedAll === 'object') return parsedAll;
    } catch (e) {
        console.warn("[AI-Parse-Warning]: Could not parse JSON from AI, using fallback.");
    }
    return fallback(text);
};

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
                content: `Bạn là một chuyên gia viết nội dung truyền cảm hứng cho các chiến dịch từ thiện.
Dựa trên thông tin: "${prompt}".

Hãy viết nội dung mô tả chiến dịch theo phong cách kể chuyện, cảm động và chân thực.
YÊU CẦU QUAN TRỌNG:
1. CHỈ SỬ DỤNG TIẾNG VIỆT. Tuyệt đối không dùng tiếng Anh hay ngôn ngữ khác.
2. TUYỆT ĐỐI KHÔNG có ký tự lạ, không dùng các ký tự đặc biệt trang trí (chỉ dùng chữ cái, dấu câu cơ bản, và **đậm**).
3. KHÔNG chia tiêu đề bằng Markdown cấp độ ## (không dùng ## tiêu đề).
4. KHÔNG bao gồm các phần: "Mục đích", "Cách thức tham gia", "Thông tin liên hệ". 
5. Tập trung hoàn toàn vào kể kể chuyện, hoàn cảnh và cảm xúc. KHÔNG viết kiểu liệt kê.

Hãy phản hồi một khối JSON hợp lệ theo cấu trúc:
{
  "title": "Tiêu đề ngắn gọn, sâu sắc (chỉ tiếng Việt, không ký tự lạ)",
  "description": "Nội dung bài kể chuyện (chỉ tiếng Việt, không ký tự lạ, không dùng ##)"
}

Lưu ý: Chỉ trả về JSON, không giải thích gì thêm.`
            }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const raw = completion.choices[0]?.message?.content;

        const result = safeJsonParse(raw, (txt) => ({
            title: "Chiến dịch quyên góp",
            description: txt || "AI bận hoặc không thể tạo nội dung lúc này."
        }));

        // Đảm bảo luôn có đủ 2 trường title và description để FE không bị lỗi
        return {
            title: result.title || "Chiến dịch quyên góp",
            description: result.description || (typeof result === 'string' ? result : "AI bận hoặc không thể tạo nội dung lúc này.")
        };
    } catch (e) {
        console.error("[AI] generateCampaignDescription error:", e.message);
        return {
            title: "Lỗi hệ thống AI",
            description: `Không thể tạo mô tả: ${e.message}. Hãy thử lại sau ít phút.`
        };
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
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_KEY}`,
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

        // 2. Fallback to Groq (dùng đúng promptText theo side)
        try {
            console.log(`[AI-OCR] Fallback to Groq (${side} side)...`);
            const completion = await groq.chat.completions.create({
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: promptText },
                        { type: "image_url", image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}` } }
                    ]
                }],
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                response_format: { type: "json_object" }
            });
            return safeJsonParse(completion.choices[0]?.message?.content, () => ({ error: 'Groq không thể parse kết quả' }));
        } catch (groqErr) {
            return { error: `Cả 2 AI đều lỗi. Gemini: ${lastError} | Groq: ${groqErr.message}` };
        }
    }
};

const fetchImageAsBase64 = async (url) => {
    try {
        // Fix relative URLs — use Vercel FE domain or fallback to localhost
        const FE_BASE = process.env.FRONTEND_URL || 'https://trust-fund-me-fe.vercel.app';
        const finalUrl = url.startsWith('http') ? url : `${FE_BASE}${url}`;
        const response = await axios.get(finalUrl, { responseType: 'arraybuffer' });
        const contentType = response.headers['content-type'] || 'image/jpeg';
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        return { data: base64, mime_type: contentType };
    } catch (error) {
        console.error(`[AI-Fetch] Failed to fetch image from ${url}:`, error.message);
        return null;
    }
};

const analyzeFlag = async (targetData, flags) => {
    try {
        const promptText = `Bạn là một chuyên gia quản trị nội dung AI. 
Hãy phân tích các báo cáo vi phạm và đưa ra đánh giá rủi ro có cấu trúc JSON.

ĐỐI TƯỢNG BỊ BÁO CÁO: ${JSON.stringify(targetData)}
DANH SÁCH BẢO CÁO: ${JSON.stringify(flags)}

TRẢ VỀ DUY NHẤT JSON:
{
  "riskScore": number (0-100),
  "riskLevel": "HIGH" | "MEDIUM" | "LOW",
  "summary": "Tóm tắt ngắn gọn tình hình",
  "keyFindings": ["Phát hiện 1", "Phát hiện 2"],
  "recommendation": "Đề xuất hành động cho quản trị viên",
  "actionTypes": ["LOCK_CAMPAIGN", "SUSPEND_ACCOUNT", "SEND_WARNING", "DELETE_CONTENT"]
}`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: promptText }],
            model: "llama-3.1-8b-instant",
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0]?.message?.content);
    } catch (e) { throw e; }
};

const analyzeExpenditure = async (campaign, expenditure, items) => {
    try {
        console.log(`[AI-Expenditure] Analyzing plan: "${expenditure.plan}"`);
        const promptText = `Bạn là một CHUYÊN GIA KIỂM TOÁN TÀI CHÍNH CẤP CAO.
Nhiệm vụ: Thẩm định giá dựa trên giá thị trường thực tế tại Việt Nam.

DỮ LIỆU KIỂM TOÁN:
- Chiến dịch: ${campaign.title}
- Nội dung kế hoạch (Căn cứ địa chỉ/SĐT/Tên người bán): ${expenditure.plan}
- Chi tiết hạng mục: ${JSON.stringify(items)}

BẢNG GIÁ THỊ TRƯỜNG THAM KHẢO (MARKET BASELINE):
- Mì tôm (thùng 30 gói): ~120,000đ.
- Nước đóng chai (lốc 6 chai 1.5L): ~100,000đ.
- Gạo (kg): ~20,000đ.
- Dầu ăn (lít): ~50,000đ.

QUY TẮC TÍNH TOÁN & TRÍCH XUẤT (BẮT BUỘC):
1. ĐỒNG BỘ ĐƠN VỊ TÍNH (QUAN TRỌNG NHẤT): 
   - Phải xác định đơn vị người dùng đang dùng (Thùng, Gói, Chai, Lốc...).
   - "marketUnitPrice" và "unit" TRẢ VỀ PHẢI KHỚP VỚI ĐƠN VỊ CỦA NGƯỜI DÙNG. 
   - Ví dụ: Nếu người dùng ghi "Thùng mì tôm" giá 7,000đ -> AI phải đưa ra giá thị trường "Theo Thùng" (~120,000đ/thùng). AI sẽ thấy 7,000đ << 120,000đ và đánh dấu "MISMATCHED" kèm cảnh báo "Nghi ngờ sai đơn vị: 7k giống giá gói hơn giá thùng".
2. THẨM ĐỊNH CHI TIẾT SẢN PHẨM & GIÁ BẤT THƯỜNG (SPECIFIC MAPPING):
   - Phải truy vấn từng món hàng xem có: (1) Thiếu thông tin (Nhãn hàng, thể tích...) hoặc (2) Giá quá cao/thấp phi thực tế không.
   - Nếu vi phạm: Phải nêu đích danh món hàng trong "redFlags".
   - Ví dụ: 
     - "Vật phẩm 'Nước đóng chai' có giá 180k/chai là phi thực tế (Giá thị trường ~5k)".
     - "Vật phẩm 'Thùng mì tôm' thiếu nhãn hàng (Hảo Hảo/Omachi)".
   - TUYỆT ĐỐI không được bỏ sót các món giá vô lý trong phần Cảnh báo này.
3. TRUY VẾT VENDOR TRONG KẾ HOẠCH: Hãy đọc kỹ mục "Nội dung kế hoạch" bên trên. 
   - Nếu thấy tên cửa hàng, SĐT, địa chỉ -> Phải trích xuất vào "vendorInfo".
4. TÍNH GIÁ THỊ TRƯỜNG TỔNG: MARKET TOTAL = (Giá Thị TRường Benchmark) x (Số Lượng).
5. TÍNH CHÊNH LỆCH: differenceAmount = (Tổng người dùng nhập) - (MARKET TOTAL).
6. ĐÁNH GIÁ TRẠNG THÁI (matchStatus):
   - Món nào giá xấp xỉ thị trường (+/- 10%) -> "MATCHED" (Hợp lý).
   - Món nào giá cao hơn thị trường > 20% -> "PARTIAL" (Xem xét).
   - Món nào giá cao bất thường, Vô lý đơn vị, hoặc THIẾU CHI TIẾT TRẦM TRỌNG -> "MISMATCHED" (Không hợp lý).

TRẢ VỀ DUY NHẤT JSON:
{
  "riskScore": number,
  "riskLevel": "HIGH" | "MEDIUM" | "LOW",
  "summary": "Tóm tắt sự chênh lệch (nêu rõ các cửa hàng phát hiện)",
  "recommendation": "Đề xuất hành động",
  "redFlags": ["Cảnh báo ĐÍCH DANH vật phẩm về GIÁ và THÔNG TIN (VD: Vật phẩm X giá 180k là vô lý)"],
  "spendingAnalysis": ["Lập luận chi tiết (VD: Giá lốc nước 3.6tr là phi thực tế)"],
  "confidence": "HIGH",
  "vendorInfo": { 
    "name": "string (Danh sách các cửa hàng)", 
    "address": "string", 
    "phone": "string" 
  },
  "detectedItems": [
    {
      "name": "Tên hạng mục",
      "quantity": number,
      "unitPrice": number,
      "total": number,
      "matchStatus": "MATCHED" | "PARTIAL" | "MISMATCHED",
      "plannedCategory": "Tên loại hàng",
      "plannedAmount": number,
      "differenceAmount": number,
      "marketUnitPrice": number (Giá thị trường cho 1 đơn vị),
      "unit": "string (Đơn vị tính: gói, chai, thùng, kg...)",
      "vendor": "Tên cửa hàng"
    }
  ]
}`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: promptText }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        return JSON.parse(completion.choices[0]?.message?.content);
    } catch (e) { throw e; }
};

const analyzeEvidence = async (expenditureId, plan, purpose, totalAmount, plannedItems, photoUrls, createdAt) => {
    const GOOGLE_KEY = process.env.GOOGLE_API_KEY;

    console.log(`[AI-Evidence] Fetching ${photoUrls.length} images...`);
    const images = (await Promise.all(photoUrls.map(url => fetchImageAsBase64(url)))).filter(img => img !== null);

    if (images.length === 0) return { error: "Không tải được ảnh minh chứng." };

    const promptText = `Bạn là một CHUYÊN GIA KIỂM TOÁN TÀI CHÍNH TỐI CAO. 
Nhiệm vụ: Đối soát ảnh hóa đơn với kế hoạch chi tiêu.

DỮ LIỆU KẾ HOẠCH:
- Mục đích: ${purpose}
- Đợt: ${plan}
- Tổng dự kiến: ${totalAmount} VND
- Danh sách dự kiến: ${JSON.stringify(plannedItems)}

NGUYÊN TẮC KIỂM TOÁN NGHIÊM NGẶT:
1. TRUY VẾT CHI TIẾT: Đọc từng dòng trên hóa đơn, đối chiếu tên, số lượng, đơn giá với kế hoạch.

2. QUY TẮC MATCH STATUS (RẤT QUAN TRỌNG):
   - MATCHED: Tìm thấy trong hóa đơn VÀ giá/số lượng khớp hoặc tương đương hợp lý.
   - PARTIAL: Tìm thấy trong hóa đơn NHƯNG đơn giá hoặc số lượng có sai lệch đáng kể (>20%).
   - MISMATCHED: Có trong KẾ HOẠCH nhưng KHÔNG TÌM THẤY trong hóa đơn, hoặc mặt hàng hoàn toàn khác.

3. QUY TẮC TÍNH RISKSCORE (BẮT BUỘC TUÂN THỦ):
   - Mỗi hạng mục trong kế hoạch KHÔNG có trong hóa đơn: +25 điểm rủi ro.
   - Tổng tiền hóa đơn thấp hơn kế hoạch >30%: +20 điểm.
   - Giá đơn vị bất thường so với thị trường: +15-30 điểm.
   - Tất cả khớp hoàn toàn: riskScore <= 20 (LOW).
   - VÍ DỤ: Nếu có 1 hạng mục thiếu trong hóa đơn → riskScore >= 50 (MEDIUM). 2 hạng mục thiếu → riskScore >= 70 (HIGH).

4. KIỂM ĐỊNH GIÁ THỊ TRƯỜNG:
   - Thùng mì tôm (30 gói) không thể < 60.000đ. Gạo ngon > 18.000đ/kg.

TRẢ VỀ DUY NHẤT JSON:
{
  "riskScore": number (0-100, tính theo quy tắc trên),
  "riskLevel": "HIGH" | "MEDIUM" | "LOW",
  "summary": "Tóm tắt: liệt kê rõ hạng mục nào THIẾU trong hóa đơn",
  "recommendation": "Đề xuất hành động cụ thể",
  "redFlags": ["Liệt kê cảnh báo, đặc biệt hạng mục thiếu"],
  "spendingAnalysis": ["Lập luận chi tiết từng hạng mục"],
  "confidence": "HIGH",
  "vendorInfo": { 
    "name": "Tên cửa hàng từ hóa đơn", 
    "address": "Địa chỉ từ hóa đơn", 
    "phone": "Số điện thoại từ hóa đơn" 
  },
  "detectedItems": [
    {
      "name": "Tên hạng mục (từ hóa đơn hoặc kế hoạch nếu thiếu)",
      "quantity": number (0 nếu không tìm thấy trong hóa đơn),
      "unitPrice": number (0 nếu không tìm thấy),
      "total": number,
      "matchStatus": "MATCHED" | "PARTIAL" | "MISMATCHED",
      "plannedCategory": "Tên loại hàng trong kế hoạch",
      "plannedAmount": number,
      "differenceAmount": number,
      "vendor": "Tên cửa hàng"
    }
  ]
}`;

    try {
        console.log(`[AI-Evidence] Calling Groq Vision (Llama 4 Scout)...`);
        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: promptText },
                    ...images.map(img => ({
                        type: "image_url",
                        image_url: { url: `data:${img.mime_type};base64,${img.data}` }
                    }))
                ]
            }],
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            response_format: { type: "json_object" }
        });

        const rawText = completion.choices[0]?.message?.content;
        return safeJsonParse(rawText, (t) => {
            console.warn("[AI-Evidence] Groq returned invalid JSON, providing fallback.");
            return { error: "AI không thể trích xuất dữ liệu. Vui lòng kiểm tra lại ảnh minh chứng." };
        });
    } catch (error) {
        console.error('[AI-Evidence] Groq Error:', error.message);
        throw error;
    }
};

const generateSuggestionLabels = async ({ amount, options }) => {
    try {
        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: `Dựa trên số tiền ${amount} và các lựa chọn ${JSON.stringify(options)}, hãy gợi ý 3-5 nhãn phân loại phù hợp (VD: Giáo dục, Y tế, Miền Trung...). Chỉ trả về mảng chuỗi JSON ["Tag1", "Tag2"].`
            }],
            model: "llama-3.1-8b-instant",
            response_format: { type: "json_object" }
        });
        const res = JSON.parse(completion.choices[0]?.message?.content);
        return Array.isArray(res) ? res : (res.labels || []);
    } catch (e) { return ["Khác"]; }
};

module.exports = {
    generatePost,
    generateCampaignDescription,
    parseExpenditureFromText,
    ocrKYC,
    analyzeFlag,
    analyzeExpenditure,
    analyzeEvidence,
    generateSuggestionLabels
};

