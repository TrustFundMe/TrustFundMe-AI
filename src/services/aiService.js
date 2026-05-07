const axios = require('axios');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
        console.error(`[AI-Config] Failed to fetch prompt ${key}:`, error.message);
        return null;
    }
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
        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: `Parse JSON items from the following text. Return a JSON object with an "items" array: ${text}` }],
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

    // Fetch dynamic JSON config for OCR
    const ocrConfig = await getPrompt('ai_ocr_prompt');
    const promptText = (ocrConfig && ocrConfig[side])
        ? ocrConfig[side]
        : (side === 'front'
            ? "Extract front side ID info to JSON: {idType, idNumber, fullName, dateOfBirth, gender, placeOfOrigin, placeOfResidence, expiryDate, issueDate, issuePlace}."
            : "Extract back side ID info to JSON: {issueDate, issuePlace}.");

    try {
        console.log(`[AI-OCR] Calling Gemini v1 for ${side} side...`);
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GOOGLE_KEY}`,
            {
                contents: [{
                    parts: [
                        { text: promptText },
                        { inline_data: { mime_type: mimeType || "image/jpeg", data: base64Image } }
                    ]
                }],
                generationConfig: { temperature: 0.1, topK: 1, topP: 0.1 }
            },
            { timeout: 30000 } // 30s timeout
        );

        const text = response.data.candidates[0].content.parts[0].text;
        return safeJsonParse(text, () => ({ error: 'Không thể parse JSON từ Gemini' }));
    } catch (geminiErr) {
        lastError = geminiErr.response?.data?.error?.message || geminiErr.message;
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

const analyzeEvidence = async (expenditureId, plan, purpose, totalAmount, plannedItems, photoUrls, createdAt) => {
    console.log(`[AI-Evidence] Fetching ${photoUrls.length} images...`);
    const images = (await Promise.all(photoUrls.map(url => fetchImageAsBase64(url)))).filter(img => img !== null);

    if (images.length === 0) return { error: "Không tải được ảnh minh chứng." };

    try {
        const dbPrompt = await getPrompt('ai_bill_analysis_prompt');
        const instruction = dbPrompt || "Bạn là một CHUYÊN GIA KIỂM TOÁN TÀI CHÍNH CẤP CAO của TrustFundMe.";

        const promptText = `${instruction}\n\nDỮ LIỆU ĐÃ CHI (Hệ thống):\n- Mục đích: ${purpose}\n- Đợt chi: ${plan}\n- Tổng số tiền kê khai: ${totalAmount} VND\n- Danh sách hạng mục ĐÃ CHI: ${JSON.stringify(plannedItems)}\n\nLƯU Ý QUAN TRỌNG: Phải xác định rõ 'isBill' (có phải ảnh hóa đơn không) và 'isElectronicInvoice' (có phải hóa đơn điện tử không), cùng với 'vendorTaxCode' nếu có. TRẢ VỀ DUY NHẤT JSON.`;

        console.log(`[AI-Evidence] Calling Groq Vision...`);
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
            model: "meta-llama/llama-4-scout-17b-16e-instruct", // Vision model
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(completion.choices[0]?.message?.content, (t) => ({ error: "AI không thể trích xuất dữ liệu." }));

        // Phase 2: Perplexity lookup if it's an electronic invoice
        if (!result.error && result.isElectronicInvoice) {
            const vendorName = result.vendorInfo?.name;
            const taxCode = result.vendorTaxCode;

            if (vendorName || taxCode) {
                const lookupLink = await searchInvoiceLinkWithPerplexity(vendorName, taxCode);
                if (lookupLink) {
                    result.invoiceLookupLink = lookupLink;
                }
            }
        }

        return result;
    } catch (error) {
        console.error('[AI-Evidence] Groq Error:', error.message);
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
