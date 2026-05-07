const axios = require('axios');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { runForensics } = require('./forensicsEngine');
const DEFAULT_PROMPTS = require('../config/prompts');

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
        const instruction = dbPrompt || DEFAULT_PROMPTS.ai_post_generation_prompt;

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
        const instruction = dbPrompt || DEFAULT_PROMPTS.ai_campaign_description_prompt;

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
        const instruction = dbPrompt || DEFAULT_PROMPTS.ai_expenditure_parse_prompt;

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
        : DEFAULT_PROMPTS.ai_ocr_prompt[side];

    try {
        console.log(`[AI-OCR] Calling Gemini 2.0 Flash for ${side} side...`);
        const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
        if (!GOOGLE_KEY) throw new Error("Missing GOOGLE_API_KEY in environment");

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_KEY}`,
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
            console.log(`[AI-OCR] Fallback to Groq Llama-4 (${side} side)...`);
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

const normalizeUrl = (url) => {
    if (!url) return url;
    if (url.startsWith('http')) return url;
    const FE_BASE = process.env.FRONTEND_URL || 'https://trust-fund-me-fe.vercel.app';
    return `${FE_BASE.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
};

const fetchImageAsBase64 = async (url) => {
    try {
        const finalUrl = normalizeUrl(url);
        console.log(`[AI-Fetch] Fetching: ${finalUrl}`);
        const response = await axios.get(finalUrl, { responseType: 'arraybuffer' });
        let contentType = response.headers['content-type'] || 'image/jpeg';
        let data = response.data;

        // Nếu là HTML, thử tìm ảnh trong đó (Scrape logic)
        if (contentType.includes('text/html')) {
            console.warn(`[AI-Fetch] ⚠ URL is HTML, attempting to find image tags...`);
            const html = Buffer.from(data).toString('utf-8');
            // Regex linh hoạt hơn, bắt được cả các link có query params (như Supabase/Firebase)
            const imgRegex = /https?:\/\/[^"'>\s]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'>\s]*)?/gi;
            const matches = html.match(imgRegex);
            
            if (matches && matches.length > 0) {
                // Ưu tiên các link chứa 'media' hoặc 'storage' vì đó thường là ảnh minh chứng
                const imgUrl = matches.find(m => (m.includes('media') || m.includes('storage')) && !m.includes('logo') && !m.includes('avatar')) || matches[0];
                if (imgUrl) {
                    console.log(`[AI-Fetch] 🎯 Found image in HTML: ${imgUrl}`);
                    return fetchImageAsBase64(imgUrl); // Đệ quy để lấy ảnh thật
                }
            }
            console.error(`[AI-Fetch] ❌ No image found in HTML page.`);
            return null;
        }

        const base64 = Buffer.from(data, 'binary').toString('base64');
        return { data: base64, mime_type: contentType };
    } catch (error) {
        console.error(`[AI-Fetch] Failed to fetch image from ${url}:`, error.message);
        return null;
    }
};

const analyzeFlag = async (targetData, flags) => {
    try {
        const dbPrompt = await getPrompt('ai_flag_analysis_prompt');
        const instruction = dbPrompt || DEFAULT_PROMPTS.ai_flag_analysis_prompt;

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
        const instruction = dbPrompt || DEFAULT_PROMPTS.ai_market_analysis_prompt;

        const promptText = `${instruction}\n\nDỮ LIỆU KIỂM TOÁN:\n- Chiến dịch: ${campaign.title}\n- Nội dung kế hoạch (Căn cứ địa chỉ/SĐT/Tên người bán): ${expenditure.plan}\n- Chi tiết hạng mục: ${JSON.stringify(items)}\n\nLƯU Ý QUAN TRỌNG: Nếu không tìm thấy sản phẩm hoặc không xác định được giá, hãy để marketPriceMin và marketPriceMax là 0. TUYỆT ĐỐI KHÔNG để giá trị âm (-1).\n\nTRẢ VỀ DUY NHẤT JSON.`;

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



/**
 * OCR for Bills/Invoices - Supports multiple images
 * @param {Array} images - Array of {data: base64, mime_type: string}
 * @returns {Promise<Object>} - Parsed bill data
 */
const ocrBill = async (images) => {
    if (!images || !Array.isArray(images) || images.length === 0) {
        console.warn("[AI-OCR-Bill] No images provided for scanning.");
        return { isBill: false, items: [], error: "Không có ảnh để quét" };
    }

    const ocrConfig = await getPrompt('ai_ocr_bill_prompt');
    const promptText = ocrConfig || DEFAULT_PROMPTS.ai_ocr_bill_prompt;

    try {
        console.log(`[AI-OCR-Bill] 🚀 Calling Gemini 2.0 Flash for ${images.length} images...`);
        const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
        if (!GOOGLE_KEY) throw new Error("Missing GOOGLE_API_KEY");

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_KEY}`,
            {
                contents: [{
                    parts: [
                        { text: `${promptText}\nLƯU Ý: Nếu KHÔNG THẤY hóa đơn nào trong tất cả các ảnh, hãy trả về {"isBill": false, "items": []}. Đừng cố đoán.` },
                        ...images.map(img => ({
                            inline_data: { mime_type: img.mime_type || "image/jpeg", data: img.data }
                        }))
                    ]
                }],
                generationConfig: { temperature: 0.1, topK: 1, topP: 0.1 }
            },
            { timeout: 30000 }
        );

        if (!response.data || !response.data.candidates || !response.data.candidates[0]) {
            throw new Error("Gemini returned invalid response structure (no candidates)");
        }

        const text = response.data.candidates[0].content.parts[0].text;
        const result = safeJsonParse(text, () => ({ error: 'Không thể parse JSON từ Gemini', isBill: false, items: [] }));
        
        // Remove brand from items as requested
        if (result && Array.isArray(result.items)) {
            result.items = result.items.map(item => {
                if (!item) return null;
                const { brand, ...rest } = item;
                return rest;
            }).filter(i => i !== null);
        } else if (result && result.items) {
            console.warn("[AI-OCR-Bill] Gemini returned items as non-array:", typeof result.items);
            result.items = [];
        }
        
        console.log("[AI-OCR-Bill] Gemini Result success.");
        return result;

    } catch (geminiErr) {
        const lastError = geminiErr.response?.data?.error?.message || geminiErr.message;
        console.warn("[AI-OCR-Bill] Gemini failed:", lastError);

        try {
            console.log(`[AI-OCR-Bill] 🔄 Fallback to Groq Llama-4 Vision...`);
            const completion = await groq.chat.completions.create({
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: `${promptText}\nOutput MUST be a valid JSON.` },
                        ...images.map(img => ({
                            type: "image_url",
                            image_url: { url: `data:${img.mime_type || 'image/jpeg'};base64,${img.data}` }
                        }))
                    ]
                }],
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                response_format: { type: "json_object" }
            });
            const result = safeJsonParse(completion.choices[0]?.message?.content, () => ({ error: 'Groq không thể parse kết quả', items: [] }));
            
            if (result && Array.isArray(result.items)) {
                result.items = result.items.map(item => {
                    if (!item) return null;
                    return item;
                }).filter(i => i !== null);
            } else if (result && result.items) {
                result.items = [];
            }

            console.log("[AI-OCR-Bill] Groq Result success.");
            return result;
        } catch (groqErr) {
            console.error("[AI-OCR-Bill] Groq failed:", groqErr.message);
            return { error: `Cả 2 AI đều lỗi. Gemini: ${lastError} | Groq: ${groqErr.message}`, isBill: false, items: [] };
        }
    }
};


const reconcile3Way = async (planItems, actualItems, billItems) => {
    const dbPrompt = await getPrompt('ai_reconciliation_3way_prompt');
    const instruction = dbPrompt || DEFAULT_PROMPTS.ai_reconciliation_3way_prompt;

    const promptText = `${instruction}
    NHIỆM VỤ TRỌNG TÂM: Đối soát thông tin THỰC TẾ (Actual) với HÓA ĐƠN (Bill).
    1. DANH SÁCH THỰC CHI ĐÃ NHẬN (Actual): ${JSON.stringify(actualItems)}
    2. TRÊN HÓA ĐƠN (Bill): ${JSON.stringify(billItems)}
    3. THAM CHIẾU KẾ HOẠCH (Plan): ${JSON.stringify(planItems)}

    YÊU CẦU ĐỐI SOÁT TỪNG MỤC (BẮT BUỘC):
    1. Mảng 'billItems' trả về phải có số lượng phần tử CHÍNH XÁC bằng số lượng phần tử trong mảng Bill đầu vào (${billItems.length} mục).
    2. Tuyệt đối KHÔNG ĐƯỢC gộp các mặt hàng, KHÔNG ĐƯỢC bỏ sót bất kỳ dòng nào từ hóa đơn.
    3. Với MỖI mặt hàng, bạn phải 'soi' kỹ các trường sau trong Actual:
       - Kiểm tra Brand của Actual có nằm trong Name của Bill không?
       - Kiểm tra Đơn vị (Unit) có khớp không?
       - Kiểm tra Giá (Price) có khớp không (ghi rõ chênh lệch)?
    
    Cấu trúc trường 'analysis' cho mỗi mục:
    - Nếu khớp: "Có trong thực chi. Khớp Tên & Brand; Khớp Đơn vị ([Tên đơn vị]); Khớp Giá ([Số tiền]đ)."
    - Nếu lệch: "Có trong thực chi nhưng: [Ghi rõ từng điểm lệch: Lệch tên/brand, Lệch đơn vị (Bill:..., Actual:...), Lệch giá (Bill... vs Actual...)]"
    - Nếu không có: "Sản phẩm không có trong danh sách thực chi."

    Trả về JSON: { 
        riskScore, 
        riskLevel, 
        summary, 
        redFlags: [], 
        billItems: [{ name, unit, quantity, price, total, analysis, status }],
        reconciliation: [{ itemName, status }] 
    }`;

    console.log(`[AI-Reconciliation] ⚖️ Đang đối soát ${billItems.length} mục hóa đơn với ${actualItems.length} mục thực chi...`);
    console.log(`[AI-Reconciliation] 📦 Dữ liệu Actual gửi lên AI:`, JSON.stringify(actualItems, null, 2));
    console.log(`[AI-Reconciliation] 📦 Dữ liệu Bill gửi lên AI:`, JSON.stringify(billItems, null, 2));

    try {
        let apiKey = process.env.PERPLEXITY_API_KEY;
        
        // Fetch from BE if not in local .env
        if (!apiKey) {
            console.log(`[AI-Reconciliation] 🔍 Fetching PERPLEXITY_API_KEY from Backend...`);
            const config = await getPrompt('PERPLEXITY_API_KEY');
            apiKey = config?.configValue;
        }

        if (!apiKey) {
            throw new Error('PERPLEXITY_API_KEY not found in local .env or Backend system-configs');
        }

        console.log(`[AI-Reconciliation] 🚀 Calling Perplexity Sonar-Pro...`);
        const response = await axios.post(
            'https://api.perplexity.ai/chat/completions',
            {
                model: 'sonar-pro',
                messages: [
                    { role: "system", content: "You are an expert auditor. Always output valid JSON." },
                    { role: "user", content: promptText }
                ],
                temperature: 0
            },
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
        );

        const result = safeJsonParse(response.data.choices[0]?.message?.content, () => ({}));
        console.log(`[AI-Reconciliation] ✅ Kết quả đối soát (Perplexity):`, JSON.stringify(result, null, 2));
        return result;
    } catch (err) {
        const errorDetail = err.response?.data || err.message;
        console.error("[AI-Reconciliation] ❌ Perplexity failed:", JSON.stringify(errorDetail, null, 2));
        return { error: `Lỗi đối soát dữ liệu qua Perplexity: ${err.message}` };
    }
};


const analyzeEvidence = async (expenditureId, plan, purpose, totalAmount, plannedItems, photoUrls, createdAt) => {
    console.log(`[AI-Evidence] Starting analysis for ${photoUrls ? photoUrls.length : 0} images...`);

    if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
        return { error: "Danh sách ảnh minh chứng trống." };
    }

    // Phase 0: Fetch images in parallel
    const imagePromises = photoUrls.map(url => fetchImageAsBase64(url));
    const images = (await Promise.all(imagePromises)).filter(img => img !== null);

    if (images.length === 0) {
        console.error("[AI-Evidence] ❌ Failed to load any images from URLs:", photoUrls);
        return { error: "Không tải được ảnh minh chứng từ link đã cung cấp." };
    }

    try {
        // Phase 1 & 2: Forensics and OCR in parallel to save time
        console.log(`[AI-Evidence] Phase 1 & 2: Running Forensics and OCR in parallel...`);

        const [forensicsResult, billData] = await Promise.all([
            runForensics(normalizeUrl(photoUrls[0])),
            ocrBill(images)
        ]);

        console.log(`[AI-Evidence] OCR Bill data received. isBill: ${billData?.isBill}`);

        // Phase 3: 3-Way Reconciliation
        const isActuallyBill = billData.error ? false : (billData.isBill !== false);

        // Ensure plannedItems is an array
        const safePlannedItems = Array.isArray(plannedItems) ? plannedItems : [];

        const planItems = safePlannedItems.map(item => {
            if (!item) return null;
            return {
                name: item.name || "Không rõ",
                expected_price: item.expectedPrice ?? item.expected_price ?? 0,
                expected_quantity: item.expectedQuantity ?? item.expected_quantity ?? 0,
                expected_unit: item.expectedUnit ?? item.expected_unit ?? "",
                expected_brand: item.expectedBrand ?? item.expected_brand ?? "",
                expected_note: item.expectedNote ?? item.expected_note ?? "",
                expected_purchase_location: item.expectedPurchaseLocation ?? item.expected_purchase_location ?? ""
            };
        }).filter(i => i !== null);

        const actualItems = safePlannedItems.map(item => {
            if (!item) return null;
            return {
                name: item.name || "Không rõ",
                actual_price: item.actualPrice ?? item.actual_price ?? item.price ?? item.expectedPrice ?? item.expected_price ?? 0,
                actual_quantity: item.actualQuantity ?? item.actual_quantity ?? item.expectedQuantity ?? item.expected_quantity ?? 0,
                actual_brand: item.actualBrand ?? item.actual_brand ?? item.expectedBrand ?? item.expected_brand ?? "",
                actual_unit: item.actualUnit ?? item.actual_unit ?? item.expectedUnit ?? item.expected_unit ?? "",
                purchase_location: item.actualPurchaseLocation ?? item.actual_purchase_location ?? item.expectedPurchaseLocation ?? item.expected_purchase_location ?? ""
            };
        }).filter(i => i !== null);

        console.log(`[AI-Evidence] Phase 3: 3-Way Reconciliation via Llama-70b...`);
        const billItemsForReconciliation = Array.isArray(billData.items) ? billData.items : [];
        const reconciliationData = await reconcile3Way(planItems, actualItems, billItemsForReconciliation);

        // Merge results
        const finalResult = {
            isBill: isActuallyBill,
            isElectronicInvoice: billData.isElectronicInvoice || false,
            vendorTaxCode: billData.vendorTaxCode || "",
            vendorName: billData.vendorName || "",
            billItems: reconciliationData.billItems || billItemsForReconciliation, 
            forensics: forensicsResult || { isManipulated: false, warnings: [] },
            ...reconciliationData
        };

        // Nếu Forensics phát hiện chỉnh sửa, tăng risk score lên mức cao nhất
        if (forensicsResult && forensicsResult.isManipulated) {
            finalResult.riskScore = 100;
            finalResult.riskLevel = 'HIGH';
            finalResult.redFlags = finalResult.redFlags || [];
            if (!finalResult.redFlags.includes("PHÁT HIỆN DẤU VẾT CHỈNH SỬA ẢNH (PHOTOSHOP/PICSART)!")) {
                finalResult.redFlags.push("PHÁT HIỆN DẤU VẾT CHỈNH SỬA ẢNH (PHOTOSHOP/PICSART)!");
            }
        }

        console.log(`[AI-Evidence] Analysis pipeline completed successfully.`);
        return finalResult;
    } catch (error) {
        console.error('[AI-Evidence] Pipeline Error:', error.message, error.stack);
        throw error;
    }
};




const generateSuggestionLabels = async ({ amount, options }) => {
    try {
        const dbPrompt = await getPrompt('ai_suggestion_labels_prompt');
        const instruction = dbPrompt || DEFAULT_PROMPTS.ai_suggestion_labels_prompt;

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
    ocrBill,
    analyzeFlag,
    analyzeExpenditure,
    analyzeEvidence,
    generateSuggestionLabels
};
