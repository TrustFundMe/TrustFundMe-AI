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
        const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
        return Array.isArray(result.labels) ? result.labels : [];
    } catch (e) {
        return [];
    }
};

const analyzeEvidence = async (expenditureId, plan, purpose, totalAmount, items, photoUrls, createdAt) => {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');

    const itemsSummary = (items && items.length > 0)
        ? items.map((it, i) => `  Hạng mục KẾ HOẠCH #${i+1}: ${it.category || it.name || ''} | SL: ${it.quantity||0} | Đơn giá: ${(it.expectedPrice||0).toLocaleString()} VND | Tổng: ${((it.quantity||0)*(it.expectedPrice||0)).toLocaleString()} VND`).join('\n')
        : '(Không có danh sách hạng mục kế hoạch)';

    const systemPrompt = `Bạn là một chuyên gia kiểm toán tài chính (AI Auditor) cho nền tảng TrustFundMe. Nhiệm vụ của bạn là đối soát BẰNG CHỨNG CHI TIÊU (hóa đơn, biên lai) với KẾ HOẠCH CHI TIÊU đã đăng ký.

QUY TẮC NGÀY THÁNG (SIÊU CẤP ĐỘ KHÁCH QUAN):
1. LUÔN SỬ DỤNG định dạng DD/MM/YYYY trong tất cả văn bản trả về. KHÔNG dùng YYYY-MM-DD.
2. OCR NGÀY THÁNG THEO NGUYÊN TẮC "LITERAL & HISTORICAL" (CHỮ SAO NGHĨA VẬY): 
   - TUYỆT ĐỐI CẤM suy luận năm: Thấy ghi ".04" hoặc "/04" thì ĐÓ LÀ NĂM 2004. 
   - Phải coi đây là hóa đơn từ 22 NĂM TRƯỚC (so với 2026). Đánh dấu rõ "Hóa đơn cũ (2004)" trong redFlags.
   - KHÔNG ĐƯỢC phép sửa "04" thành "2024" hay "2026". Bất kỳ hành động sửa năm nào đều là vi phạm tính chính trực của Auditor.
   - Nếu ngày hóa đơn xa hơn 30 ngày so với ngày tạo đợt chi (${createdAt}), bạn PHẢI báo cáo HIGH RISK và khẳng định là GIAN LẬN.
   - Định dạng văn bản: LUÔN sử dụng DD/MM/YYYY. KHÔNG dùng YYYY-MM-DD.

QUY TẮC PHÁT HIỆN GIAN LẬN:
- Đánh giá HIGH RISK nếu phát hiện ngày tháng trên hóa đơn quá cũ so với ngày tạo đợt chi (${createdAt}).
- Gắn cờ nếu hóa đơn được xuất từ một đơn vị không liên quan đến mục đích chi tiêu "${purpose}".

CẤU TRÚC TRẢ VỀ (JSON thuần túy):
{
  "summary": "Tóm tắt (Sử dụng DD/MM/YYYY)",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "riskScore": 0-100,
  "redFlags": ["Liệt kê nghi vấn cụ thể"],
  "spendingAnalysis": ["Lập luận chi tiết (SỬ DỤNG DD/MM/YYYY)"],
  "vendorInfo": { "name": "Bên bán", "address": "Địa chỉ", "phone": "SĐT", "email": "Email", "taxId": "MST" },
  "detectedItems": [
    {
      "name": "Sản phẩm",
      "quantity": số lượng,
      "unitPrice": đơn giá,
      "total": thành tiền,
      "matchStatus": "MATCHED" | "PARTIAL" | "MISMATCHED",
      "plannedCategory": "Hạng mục khớp",
      "plannedAmount": "Tiền dự kiến",
      "differenceAmount": "Chênh lệch"
    }
  ],
  "recommendation": "Duyệt / Từ chối / Yêu cầu giải trình",
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}`;

    const userText = `
THÔNG TIN KẾ HOẠCH CHI TIÊU:
- Ngày tạo đợt chi: ${createdAt}
- Đợt chi: ${plan}
- Mục đích: ${purpose || ''}
- Tổng tiền dự kiến: ${(totalAmount||0).toLocaleString()} VND
- Danh mục kế hoạch:
${itemsSummary}

YÊU CẦU:
1. Phân tích OCR và trích xuất ngày tháng hóa đơn.
2. Kiểm tra xem ngày hóa đơn có hợp lệ với ngày tạo đợt chi không (${createdAt}).
3. Phát hiện dấu hiệu tái sử dụng ảnh hoặc hóa đơn giả mạo.
4. KHÔNG BỊA ĐẶT DỮ LIỆU.
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

