const axios = require('axios');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { runForensics } = require('./forensicsEngine');

/**
 * Safely parse JSON from AI response, handling markdown blocks and fallbacks
 */
const safeJsonParse = (text, fallback) => {
    try {
        if (!text) return typeof fallback === 'function' ? fallback(text) : fallback;
        // AI often returns JSON inside markdown code blocks ```json ... ```
        const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("[AI-Parse] Failed to parse JSON:", e.message);
        if (typeof fallback === 'function') return fallback(text);
        return fallback;
    }
};

// Cache in-memory for prompts to avoid repetitive BE calls
const promptCache = {};

/**
 * Fetch prompt configuration from Backend's SystemConfig
 * @param {string} key - Config key (e.g., ai_ocr_prompt)
 * @returns {Promise<any>} - Config value (String or JSON)
 */
const getPrompt = async (key) => {
    if (promptCache[key]) return promptCache[key];

    try {
        const BE_URL = process.env.CAMPAIGN_SERVICE_URL || 'http://localhost:8080';
        console.log(`[AI-Config] Fetching prompt ${key} from BE...`);
        const response = await axios.get(`${BE_URL}/api/system-configs/${key}`);

        let value = response.data.configValue;
        // Try to parse if it looks like JSON (for OCR config)
        if (value && (value.startsWith('{') || value.startsWith('['))) {
            try { value = JSON.parse(value); } catch (e) { }
        }

        promptCache[key] = value;
        return value;
    } catch (error) {
        console.error(`[AI-Config] ❌ Failed to fetch prompt ${key}:`, error.message);
        if (error.response?.status === 401) {
            console.error(`[AI-Config] 🔑 LỖI 401 (Unauthorized): Hệ thống AI không có quyền truy cập SystemConfig của Backend. Hãy kiểm tra PermitAll hoặc Token.`);
        }
        return null;
    }
};

const generatePost = async (prompt, rules = "") => {
    try {
        const dbPrompt = await getPrompt('ai_post_generation_prompt');
        const instruction = dbPrompt || "Viết bài đăng truyền cảm hứng.";

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: `${instruction}\nNội dung: ${prompt}\nRules: ${rules}` }],
            model: "llama-3.3-70b-versatile",
        });
        return completion.choices[0]?.message?.content;
    } catch (e) { throw e; }
};

const generateCampaignDescription = async (prompt, rules = "") => {
    try {
        const dbPrompt = await getPrompt('ai_campaign_description_prompt');
        const instruction = dbPrompt || "Bạn là một chuyên gia viết nội dung truyền cảm hứng cho các chiến dịch từ thiện.";

        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: `${instruction}\nDựa trên thông tin: "${prompt}".\nTrả về kết quả dưới dạng JSON.`
            }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const raw = completion.choices[0]?.message?.content;

        const result = safeJsonParse(raw, (txt) => ({
            title: "Chiến dịch quyên góp",
            description: txt || "AI bận hoặc không thể tạo nội dung lúc này."
        }));

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
        const dbPrompt = await getPrompt('ai_expenditure_parse_prompt');
        const instruction = dbPrompt || "Parse JSON items from text.";

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: `${instruction}\nText: ${text}` }],
            model: "llama-3.1-8b-instant",
            response_format: { type: "json_object" }
        });
        const res = JSON.parse(completion.choices[0]?.message?.content);
        return res.items || res;
    } catch (e) { throw e; }
};

const ocrKYC = async (imageBuffer, mimeType, side = 'front') => {
    const base64Image = imageBuffer.toString("base64");

    // Fetch dynamic JSON config for OCR
    const ocrConfig = await getPrompt('ai_ocr_prompt');
    const promptText = (ocrConfig && ocrConfig[side])
        ? ocrConfig[side]
        : (side === 'front'
            ? "Extract front side ID info to JSON: {idType, idNumber, fullName, dateOfBirth, gender, placeOfOrigin, placeOfResidence, expiryDate, issueDate, issuePlace}."
            : "Extract back side ID info to JSON: {issueDate, issuePlace}.");

    try {
        console.log(`[AI-OCR] Calling Gemini v1 for ${side} side...`);
        const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
        if (!GOOGLE_KEY) throw new Error("Missing GOOGLE_API_KEY in environment");

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GOOGLE_KEY}`,
            {
                contents: [{
                    parts: [
                        { text: `${promptText}\nOutput MUST be a valid JSON.` },
                        { inline_data: { mime_type: mimeType || "image/jpeg", data: base64Image } }
                    ]
                }],
                generationConfig: { temperature: 0.1, topK: 1, topP: 0.1 }
            },
            { timeout: 30000 }
        );

        const text = response.data.candidates[0].content.parts[0].text;
        return safeJsonParse(text, () => ({ error: 'Không thể parse JSON từ Gemini' }));
    } catch (geminiErr) {
        const lastError = geminiErr.response?.data?.error?.message || geminiErr.message;
        console.warn("[AI-OCR] Gemini failed:", lastError);

        try {
            console.log(`[AI-OCR] Fallback to Groq (${side} side)...`);
            const completion = await groq.chat.completions.create({
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: `${promptText}\nOutput MUST be a valid JSON.` },
                        { type: "image_url", image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}` } }
                    ]
                }],
                model: "llama-3.2-90b-vision-preview",
                response_format: { type: "json_object" }
            });
            return safeJsonParse(completion.choices[0]?.message?.content, () => ({ error: 'Groq không thể parse kết quả' }));
        } catch (groqErr) {
            return { error: `Cả 2 AI đều lỗi. Gemini: ${lastError} | Groq: ${groqErr.message}` };
        }
    }
};

const normalizeUrl = (url) => {
    if (!url) return url;
    if (url.startsWith('http')) return url;
    const FE_BASE = process.env.FRONTEND_URL || 'https://trust-fund-me-fe.vercel.app';
    return `${FE_BASE.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
};

const fetchImageAsBase64 = async (url) => {
    try {
        const finalUrl = normalizeUrl(url);
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
        const dbPrompt = await getPrompt('ai_flag_analysis_prompt');
        const instruction = dbPrompt || "Bạn là một CHUYÊN GIA THẨM ĐỊNH RỦI RO HỆ THỐNG.";

        const promptText = `${instruction}\nTHỜI GIAN HIỆN TẠI (Reference): ${new Date().toISOString()}\n\nĐỐI TƯỢNG BỊ BÁO CÁO: ${JSON.stringify(targetData)}\nDANH SÁCH BẢO CÁO: ${JSON.stringify(flags)}\n\nTRẢ VỀ DUY NHẤT JSON.`;

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
        const dbPrompt = await getPrompt('ai_market_analysis_prompt');
        const instruction = dbPrompt || "Bạn là một CHUYÊN GIA KIỂM TOÁN TÀI CHÍNH CẤP CAO.";

        const promptText = `${instruction}\n\nDỮ LIỆU KIỂM TOÁN:\n- Chiến dịch: ${campaign.title}\n- Nội dung kế hoạch (Căn cứ địa chỉ/SĐT/Tên người bán): ${expenditure.plan}\n- Chi tiết hạng mục: ${JSON.stringify(items)}\n\nTRẢ VỀ DUY NHẤT JSON.`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: promptText }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        return JSON.parse(completion.choices[0]?.message?.content);
    } catch (e) { throw e; }
};

const searchInvoiceLinkWithPerplexity = async (vendorName, taxCode) => {
    try {
        const apiKey = process.env.PERPLEXITY_API_KEY;
        if (!apiKey) {
            console.warn('[AI-Perplexity] Missing PERPLEXITY_API_KEY');
            return null;
        }

        // Bước 1: Gọi Sonar-Pro (Agent Mode) để lấy link trực tiếp
        const query = `Tìm link trang web chính thức ĐỂ TRA CỨU HÓA ĐƠN ĐIỆN TỬ của doanh nghiệp này (bỏ qua các trang tin tức, chỉ lấy trang tra cứu cấp hóa đơn hoặc trang tra cứu của nhà cung cấp HDDT mà họ dùng). 
        Công ty: ${vendorName || 'Không rõ'}, Mã số thuế: ${taxCode || 'Không rõ'}.
        Trả về DUY NHẤT 1 đường link URL xác thực nhất.`;

        console.log(`[AI-Perplexity] Calling Sonar-Pro for ${vendorName}...`);
        const sonarResponse = await axios.post(
            'https://api.perplexity.ai/chat/completions',
            {
                model: 'sonar-pro',
                messages: [
                    { role: 'system', content: 'Bạn là chuyên gia tìm kiếm pháp lý. Chỉ trả về 1 URL chính xác nhất để tra cứu hóa đơn, không giải thích.' },
                    { role: 'user', content: query }
                ],
                temperature: 0
            },
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
        );

        let content = sonarResponse.data.choices[0]?.message?.content?.trim();
        let urlMatch = content ? content.match(/https?:\/\/[^\s]+/) : null;

        // Bước 2: Back-up nếu Sonar không ra link hoặc link rác -> Dùng Search API (Search Mode)
        if (!urlMatch || content.includes('không tìm thấy') || content.length > 300) {
            console.log(`[AI-Perplexity] Sonar failed. Falling back to Search API...`);
            const searchResponse = await axios.post(
                'https://api.perplexity.ai/search',
                {
                    query: `trang tra cứu hóa đơn điện tử ${vendorName} ${taxCode}`,
                    max_results: 5
                },
                { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
            );

            const results = searchResponse.data.results || [];
            if (results.length > 0) {
                // Lấy kết quả đầu tiên có vẻ là trang tra cứu
                const bestMatch = results.find(r => r.url.includes('hoadon') || r.url.includes('invoice') || r.title.toLowerCase().includes('tra cứu'));
                return bestMatch ? bestMatch.url : results[0].url;
            }
        }

        return urlMatch ? urlMatch[0] : null;
    } catch (error) {
        console.error('[AI-Perplexity] Error searching invoice link:', error.response?.data || error.message);
        return null;
    }
};

const extractBillDataWithGroq = async (base64Image, mimeType) => {
    const dbPrompt = await getPrompt('ai_ocr_bill_prompt');
    const promptText = dbPrompt || `Bạn là chuyên gia bóc tách hóa đơn (OCR Invoice Expert). 
    NHIỆM VỤ: Hãy đọc ảnh và trích xuất TOÀN BỘ danh sách các mặt hàng/dịch vụ có trong hóa đơn. 
    YÊU CẦU TRẢ VỀ JSON: { 
      "isBill": true, 
      "vendorName": "Tên công ty/cửa hàng", 
      "vendorTaxCode": "Mã số thuế", 
      "items": [
        { "name": "Tên mặt hàng", "price": 50000, "quantity": 1, "unit": "Cái", "total": 50000 }
      ] 
    }. 
    LƯU Ý: Phải liệt kê đầy đủ, không bỏ sót dòng nào.`;

    try {
        console.log(`[AI-OCR-Bill] 🚀 Gửi request bóc tách ảnh tới Groq Llama-3.2 Vision (90b)...`);
        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: promptText },
                    { type: "image_url", image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}` } }
                ]
            }],
            model: "llama-3.2-90b-vision-preview",
            response_format: { type: "json_object" }
        });

        const text = completion.choices[0]?.message?.content;
        console.log("[AI-OCR-Bill] Raw Groq Response:", text);
        const parsed = safeJsonParse(text, () => ({ error: 'Không thể parse JSON từ Groq' }));
        console.log("[AI-OCR-Bill] Parsed Result:", JSON.stringify(parsed, null, 2));
        return parsed;
    } catch (err) {
        console.error("[AI-OCR-Bill] Groq Vision failed:", err.message);
        return { error: `Lỗi quét hóa đơn (Groq): ${err.message}` };
    }
};

const reconcile3Way = async (planItems, actualItems, billData) => {
    const dbPrompt = await getPrompt('ai_reconciliation_3way_prompt');
    const instruction = dbPrompt || "Bạn là CHUYÊN GIA KIỂM TOÁN TÀI CHÍNH CẤP CAO. Hãy đối soát 3 bộ dữ liệu: Plan, Actual, Bill.";

    const promptText = `${instruction}
1. DỰ KIẾN (Plan): ${JSON.stringify(planItems)}
2. THỰC NHẬP (Actual): ${JSON.stringify(actualItems)}
3. TRÊN HÓA ĐƠN (Bill): ${JSON.stringify(billData)}

Trả về JSON: { riskScore, riskLevel, summary, redFlags, reconciliation: [{ itemName, analysis, status }], unplannedBillItems: [] }`;

    try {
        console.log(`[AI-Reconciliation] ⚖️ Bắt đầu đối soát 3 chân bằng Llama-3.3-70b...`);
        console.log(`[AI-Reconciliation] 📝 Prompt Length: ${promptText.length} characters`);
        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: promptText }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });
        const result = safeJsonParse(completion.choices[0]?.message?.content, () => ({}));
        console.log(`[AI-Reconciliation] ✅ Kết quả đối soát:`, JSON.stringify(result, null, 2));
        return result;
    } catch (err) {
        console.error("[AI-Reconciliation] Groq failed:", err.message);
        return { error: "Lỗi đối soát dữ liệu" };
    }
};


const analyzeEvidence = async (expenditureId, plan, purpose, totalAmount, plannedItems, photoUrls, createdAt) => {
    console.log(`[AI-Evidence] Starting analysis for ${photoUrls.length} images...`);

    // Phase 0: Fetch images in parallel
    const imagePromises = photoUrls.map(url => fetchImageAsBase64(url));
    const images = (await Promise.all(imagePromises)).filter(img => img !== null);

    if (images.length === 0) return { error: "Không tải được ảnh minh chứng." };

    try {
        // Phase 1 & 2: Forensics and OCR in parallel to save time
        console.log(`[AI-Evidence] Phase 1 & 2: Running Forensics and OCR in parallel...`);

        const [forensicsResult, billData] = await Promise.all([
            runForensics(normalizeUrl(photoUrls[0])),
            extractBillDataWithGroq(images[0].data, images[0].mime_type)
        ]);

        // Phase 3: 3-Way Reconciliation
        // Proceed even if isBill is false (AI might be wrong, or user wants to see data anyway)
        const isActuallyBill = billData.error ? false : (billData.isBill !== false);

        // Phase 3: 3-Way Reconciliation
        // Map all requested fields for plan and actual
        const planItems = plannedItems.map(item => ({
            name: item.name,
            expected_price: item.expectedPrice ?? item.expected_price,
            expected_quantity: item.expectedQuantity ?? item.expected_quantity,
            expected_unit: item.expectedUnit ?? item.expected_unit,
            expected_brand: item.expectedBrand ?? item.expected_brand,
            expected_note: item.expectedNote ?? item.expected_note,
            expected_purchase_location: item.expectedPurchaseLocation ?? item.expected_purchase_location
        }));

        const actualItems = plannedItems.map(item => ({
            name: item.name,
            actual_price: item.actualPrice ?? item.actual_price ?? item.price ?? item.expectedPrice ?? item.expected_price,
            actual_quantity: item.actualQuantity ?? item.actual_quantity ?? item.expectedQuantity ?? item.expected_quantity,
            actual_brand: item.actualBrand ?? item.actual_brand ?? item.expectedBrand ?? item.expected_brand,
            actual_unit: item.actualUnit ?? item.actual_unit ?? item.expectedUnit ?? item.expected_unit,
            purchase_location: item.actualPurchaseLocation ?? item.actual_purchase_location ?? item.expectedPurchaseLocation ?? item.expected_purchase_location
        }));

        console.log(`[AI-Evidence] Phase 3: 3-Way Reconciliation via Llama-70b...`);
        const reconciliationData = await reconcile3Way(planItems, actualItems, billData.items || []);

        // Merge results
        const finalResult = {
            isBill: isActuallyBill,
            isElectronicInvoice: billData.isElectronicInvoice,
            vendorTaxCode: billData.vendorTaxCode,
            vendorName: billData.vendorName,
            billItems: billData.items || [], // Lưu lại dữ liệu thô để hiển thị bảng Bill riêng
            forensics: forensicsResult,
            ...reconciliationData
        };

        // Nếu Forensics phát hiện chỉnh sửa, tăng risk score lên mức cao nhất
        if (forensicsResult.isManipulated) {
            finalResult.riskScore = 100;
            finalResult.riskLevel = 'HIGH';
            finalResult.redFlags = finalResult.redFlags || [];
            finalResult.redFlags.push("PHÁT HIỆN DẤU VẾT CHỈNH SỬA ẢNH (PHOTOSHOP/PICSART)!");
        }

        return finalResult;
    } catch (error) {
        console.error('[AI-Evidence] Pipeline Error:', error.message);
        throw error;
    }
};



const generateSuggestionLabels = async ({ amount, options }) => {
    try {
        const dbPrompt = await getPrompt('ai_suggestion_labels_prompt');
        const instruction = dbPrompt || "Gợi ý 3-5 nhãn phân loại phù hợp rả về mảng chuỗi JSON.";

        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: `${instruction}\nDựa trên số tiền ${amount} và các lựa chọn ${JSON.stringify(options)}.\nTrả về JSON chứa mảng labels.`
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
