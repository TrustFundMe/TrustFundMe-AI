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
const GEMINI_MODEL = "gemini-1.5-flash";
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

const analyzeExpenditure = async (campaign, expenditure, items) => {
    const systemPrompt = `Bạn là Chuyên gia Kiểm toán Tài chính Cao cấp của TrustFundMe. Bạn có trình độ chuyên môn cao về đối soát giá cả thị trường Việt Nam hiện nay.

NHIỆM VỤ: Phân tích kế hoạch chi tiêu này và đánh giá rủi ro về giá cả, định mức và tính minh bạch.

CÁC TIÊU CHÍ KIỂM TRA:
1. MINH BẠCH: Các hạng mục có ghi rõ thương hiệu, quy cách không?
2. GIÁ CẢ: Đơn giá có phù hợp với thị trường không?
3. ĐỊNH MỨC: Số lượng mua có phù hợp với quy mô chiến dịch không?

CẤU TRÚC TRẢ VỀ (JSON thuần túy, KHÔNG markdown):
{
  "summary": "Tóm tắt về độ minh bạch và hợp lý của kế hoạch (1-2 câu)",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "riskScore": số từ 0-100,
  "redFlags": ["Mô tả lỗi: 'Mì tôm 50k/gói là cao bất thường'", "Thiếu thông tin: 'Không ghi rõ loại sữa'", ...],
  "spendingAnalysis": ["Đánh giá chi tiết về sự phân bổ ngân sách"],
  "recommendation": "Đề xuất: 'Duyệt' | 'Yêu cầu sửa đổi' | 'Từ chối'",
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}`;

    const prompt = `
THÔNG TIN CHIẾN DỊCH:
- ID: ${campaign.id}
- Tiêu đề: ${campaign.title || ''}
- Loại: ${campaign.type || ''} (AUTHORIZED = Quỹ Ủy Quyền, ITEMIZED = Quỹ Mục Tiêu)
- Trạng thái: ${campaign.status || ''}
- Số dư quỹ: ${(campaign.balance || 0).toLocaleString()} VND
- Đã gây quỹ: ${(campaign.campaignRaised || 0).toLocaleString()} VND
- Mục tiêu: ${(campaign.campaignGoal || 0).toLocaleString()} VND
- Tiến độ: ${Math.round((campaign.campaignProgress || 0))}%
- Chủ chiến dịch: ${campaign.campaignAuthor || ''}
- Mô tả: ${campaign.campaignDescription || ''}
- Thời gian: ${campaign.campaignStart || ''} → ${campaign.campaignEnd || ''}

THÔNG TIN ĐỢT CHI TIÊU:
- ID: ${expenditure.id}
- Kế hoạch: ${expenditure.plan || ''}
- Trạng thái: ${expenditure.status || ''}
- Tổng kế hoạch: ${(expenditure.totalExpectedAmount || 0).toLocaleString()} VND
- Tổng thực chi: ${(expenditure.totalAmount || 0).toLocaleString()} VND
- Chênh lệch: ${(expenditure.variance || 0).toLocaleString()} VND
- Trạng thái bằng bằng chứng: ${expenditure.evidenceStatus || 'N/A'}
- Hạn bằng chứng: ${expenditure.evidenceDueAt || 'Chưa đặt'}
- Yêu cầu rút tiền: ${expenditure.isWithdrawalRequested ? 'Có' : 'Không'}
- Số tài khoản nhận: ${expenditure.accountNumber || 'N/A'}
- Ngân hàng: ${expenditure.bankCode || 'N/A'}
- Người nhận: ${expenditure.accountHolderName || 'N/A'}
- Ngày tạo: ${expenditure.createdAt || ''}

DANH SÁCH HẠNG MỤC CHI TIÊU:
${items && items.length > 0 ? items.map((item, i) => `
Hạng mục #${i + 1}:
- Tên: ${item.category || ''}
- SL kế hoạch: ${item.quantity || 0} x ${(item.expectedPrice || 0).toLocaleString()} = ${((item.quantity || 0) * (item.expectedPrice || 0)).toLocaleString()} VND
- SL thực tế: ${item.actualQuantity || 0} x ${(item.price || 0).toLocaleString()} = ${((item.actualQuantity || item.quantity || 0) * (item.price || item.expectedPrice || 0)).toLocaleString()} VND
- Chênh lệch: ${(((item.actualQuantity || item.quantity || 0) * (item.price || item.expectedPrice || 0)) - ((item.quantity || 0) * (item.expectedPrice || 0))).toLocaleString()} VND
- Ghi chú: ${item.note || ''}
`).join('\n') : '(Không có danh sách hạng mục)'}
`.trim();

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            model: ANALYSIS_MODEL,
            temperature: 0.0,
            max_tokens: 2048,
            response_format: { type: "json_object" }
        });
        const result = JSON.parse(completion.choices[0]?.message?.content);
        return result;
    } catch (e) {
        console.error("Expenditure analysis error:", e);
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
            max_tokens: 512,
            response_format: { type: "json_object" }
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

const analyzeEvidence = async (expenditureId, plan, purpose, totalAmount, items, photoUrls) => {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');

    const itemsSummary = (items && items.length > 0)
        ? items.map((it, i) => `  Hạng mục KẾ HOẠCH #${i+1}: ${it.category || it.name || ''} | SL: ${it.quantity||0} | Đơn giá: ${(it.expectedPrice||0).toLocaleString()} VND | Tổng: ${((it.quantity||0)*(it.expectedPrice||0)).toLocaleString()} VND`).join('\n')
        : '(Không có danh sách hạng mục kế hoạch)';

    const systemPrompt = `Bạn là Chuyên gia Kiểm toán Tài chính Cao cấp của TrustFundMe. Nhiệm vụ của bạn là phân tích các ảnh minh chứng (hóa đơn, biên lai) và đối chiếu với kế hoạch chi tiêu.

NGUYÊN TẮC QUAN TRỌNG NHẤT (TUÂN THỦ TUYỆT ĐỐI):
1. KHÔNG TỰ BỊA ĐẶT THÔNG TIN: Chỉ trích xuất những gì THỰC SỰ CÓ trong ảnh. Nếu không có thông tin cửa hàng, địa chỉ, hoặc số điện thoại, hãy ghi là null hoặc "Không xác định". Tuyệt đối không tự bịa tên cửa hàng hay địa chỉ.
2. GẮN NHÃN PHÁT HIỆN: Phân biệt rõ giữa "Thông tin trên hóa đơn" và "Kế hoạch đã đề ra".
3. ĐỐI CHIẾU MỤC TIÊU: Xem các món hàng trong hóa đơn có phục vụ cho mục đích "${purpose}" và kế hoạch "${plan}" không.
4. THÔNG TIN LIÊN HỆ VENDOR: Số điện thoại, địa chỉ, email trong vendorInfo là của CỬA HÀNG / ĐƠN VỊ BÁN HÀNG (bên phát hành hóa đơn) — KHÔNG phải của người mua / chủ quỹ.

CẤU TRÚC TRẢ VỀ (JSON thuần túy, KHÔNG markdown):
{
  "summary": "Tóm tắt ngắn gọn tính hợp lệ của hóa đơn (1-2 câu)",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "riskScore": số 0-100,
  "redFlags": ["Mô tả sai sót: 'Hóa đơn không có ngày tháng'", "Nghi vấn: 'Giá cao bất thường'", ...],
  "spendingAnalysis": ["Cơ sở lập luận của AI về tính hợp pháp của chứng từ này"],
  "vendorInfo": {
    "name": "Tên cửa hàng/đơn vị PHÁT HÀNH hóa đơn (bên bán)",
    "address": "Địa chỉ của cửa hàng/đơn vị bán hàng",
    "phone": "Số điện thoại LIÊN HỆ của cửa hàng bán hàng (không phải SĐT người mua)",
    "email": "Email của cửa hàng nếu có",
    "taxId": "Mã số thuế của cửa hàng nếu có"
  },
  "detectedItems": [
    {
      "name": "Tên sản phẩm trích xuất từ ảnh",
      "quantity": số lượng,
      "unitPrice": đơn giá,
      "total": thành tiền,
      "matchStatus": "MATCHED" (khớp mục tiêu) | "PARTIAL" (gần khớp) | "MISMATCHED" (không có trong kế hoạch),
      "plannedCategory": "Tên hạng mục trong kế hoạch mà món này khớp vào (nếu có)"
    }
  ],
  "recommendation": "Đề xuất hành động: 'Duyệt' | 'Yêu cầu giải trình' | 'Từ chối'",
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}`;

    const userText = `
THÔNG TIN KẾ HOẠCH CHI TIÊU:
- Đợt chi: ${plan}
- Mục đích: ${purpose || ''}
- Tổng tiền dự kiến: ${(totalAmount||0).toLocaleString()} VND
- Danh mục kế hoạch:
${itemsSummary}

YÊU CẦU:
1. Phân tích (OCR) các ảnh minh chứng kèm theo.
2. Trích xuất thông tin Vendor (Bên bán).
3. Liệt kê danh sách sản phẩm THỰC TẾ trên hóa đơn và đối chiếu với Danh mục kế hoạch trên.
4. KHÔNG BỊA ĐẶT DỮ LIỆU. Nếu ảnh mờ hoặc không có thông tin, hãy báo cáo trung thực.
`;

    const content = [{ type: 'text', text: userText }];

    for (const url of (photoUrls || []).slice(0, 5)) {
        try {
            const imgRes = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
            const mime = imgRes.headers['content-type'] || 'image/jpeg';
            const base64 = Buffer.from(imgRes.data).toString('base64');
            content.push({
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${base64}` }
            });
        } catch (e) {
            console.warn('[analyze-evidence] Cannot fetch image:', url, e.message);
        }
    }

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: content }
            ],
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            temperature: 0.0, // Set to 0 to minimize creativity/hallucination
            max_tokens: 4096,
            response_format: { type: "json_object" }
        });

        const rawResult = completion.choices[0]?.message?.content;
        return JSON.parse(rawResult);
    } catch (e) {
        console.error("Groq-Vision Evidence analysis error:", e.message);
        throw e;
    }
};

module.exports = { generatePost, generateCampaignDescription, parseExpenditureFromText, ocrKYC, analyzeFlag, analyzeExpenditure, analyzeEvidence, generateSuggestionLabels };

