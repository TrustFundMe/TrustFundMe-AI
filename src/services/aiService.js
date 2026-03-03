const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const generatePost = async (prompt, rules = "") => {
    try {
        let systemPrompt = `
        Bạn là một trợ lý AI chuyên nghiệp của một tổ chức từ thiện "TrustFundMe". 
        Nhiệm vụ của bạn là viết một bài đăng kêu gọi quyên góp cảm động, minh bạch và chân thực dựa trên thông tin được cung cấp.
        
        Phong cách viết: Chân thành, khẩn thiết nhưng đầy hy vọng, không quá bi lụy nhưng phải chạm đến trái tim người đọc.
        `;

        if (rules) {
            systemPrompt += `\n\n!!! QUAN TRỌNG: BẠN BẮT BUỘC PHẢI TUÂN THỦ CÁC QUY TẮC SAU ĐÂY CỦA NGƯỜI DÙNG: ${rules} !!!\n`;
        }

        let customRulesInstruction = "";
        if (rules) {
            customRulesInstruction = ` (LƯU Ý QUAN TRỌNG: NỘI DUNG PHẢI TUÂN THỦ: ${rules})`;
        }

        systemPrompt += `
        Đầu vào của người dùng sẽ là các thông tin vắn tắt (VD: "Bé Hải, 6 tuổi, mổ tim, cần 50 triệu, BV Nhi Đồng").
        
        Đầu ra trả về phải là định dạng JSON CHUẨN (không có markdown code block) với cấu trúc sau:
        {
            "title": "Tiêu đề bài viết ngắn gọn, thu hút (chứa icon cảm xúc phù hợp)",
            "content": "Nội dung bài viết chi tiết, chia thành 3 phần: Hoàn cảnh (ngắn gọn), Nhu cầu cấp thiết (số tiền, dùng để làm gì), Lời kêu gọi hành động (Rõ ràng). Viết dưới dạng văn bản có xuống dòng (\\n). ${customRulesInstruction}",
            "hashtags": ["#TrustFundMe", "#ThienNguyenMinhBach", "#hashtag_lien_quan_1", "#hashtag_lien_quan_2"],
            "call_to_action": "Câu kêu gọi hành động ngắn gọn, mạnh mẽ cuối bài."
        }
        
        Lưu ý: Chỉ trả về JSON thuần, không kèm lời dẫn hay giải thích.
        `;

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 1024,
            top_p: 1,
            stream: false,
            response_format: { type: "json_object" }
        });

        const responseContent = completion.choices[0]?.message?.content;
        return JSON.parse(responseContent);

    } catch (error) {
        console.error("Error generating post:", error);
        throw error;
    }
};

const generateCampaignDescription = async (prompt, rules = "") => {
    try {
        let systemPrompt = `
        Bạn là trợ lý viết bài chuyên nghiệp cho nền tảng từ thiện "TrustFundMe".
        NHIỆM VỤ: Viết mô tả chiến dịch từ thiện NGẮN GỌN, CHUẨN XÁC, GIÀU CẢM XÚC.

        QUY TẮC TỐI THƯỢNG:
        1. KHÔNG BIA ĐẶT: Chỉ dùng thông tin có trong đầu vào. Không tự thêm số tiền, địa danh hay chi tiết khác.
        2. TIẾNG VIỆT CHUẨN: Tuyệt đối không dùng từ vô nghĩa (như úng ẩn, úm ẩn). Không lặp từ vô lý.
        3. CẤU TRÚC: Trả về JSON chứa "title" và "description". Description chia làm các đoạn rõ ràng bằng \\n.

        VÍ DỤ MẪU:
        Input: "Bác Nam, 60 tuổi, ung thư phổi, ở Quảng Nam. Cần tiền xạ trị."
        Output: {
            "title": "Chung Tay Giúp Bác Nam Chiến Đấu Với Bệnh Ung Thư",
            "description": "Bác Nam năm nay 60 tuổi, hiện đang sinh sống tại Quảng Nam. Thật không may, bác vừa nhận kết quả chẩn đoán mắc bệnh ung thư phổi.\\n\\nHiện tại, bác đang rất cần sự hỗ trợ kinh phí để tiến hành các đợt xạ trị kéo dài sự sống. Do hoàn cảnh gia đình khó khăn, bác không thể tự mình chi trả các khoản viện phí đắt đỏ.\\n\\nRất mong nhận được sự chung tay và ủng hộ từ các nhà hảo tâm để bác Nam có thêm nghị lực vượt qua nghịch cảnh này."
        }
        `;

        if (rules) {
            systemPrompt += `\nLƯU Ý RIÊNG: ${rules}\n`;
        }

        systemPrompt += `
        Đầu vào: Thông tin vắn tắt về hoàn cảnh, nhu cầu, mục tiêu.
        
        Đầu ra trả về phải là định dạng JSON CHUẨN với cấu trúc sau:
        {
            "title": "Tiêu đề chiến dịch thu hút, ngắn gọn (kèm icon)",
            "description": "Nội dung mô tả chi tiết bài bản. Chia thành các phần:
                1. Giới thiệu nhân vật/hoàn cảnh (Story)
                2. Khó khăn hiện tại
                3. Mục tiêu quyên góp & Cách sử dụng số tiền
                4. Lời cảm ơn & Kết nối.
                Sử dụng ký tự xuống dòng (\\n) để phân đoạn."
        }
        
        Chỉ trả về JSON thuần.
        `;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.8,
            max_tokens: 2048,
            response_format: { type: "json_object" }
        });

        const responseContent = completion.choices[0]?.message?.content;
        return JSON.parse(responseContent);

    } catch (error) {
        console.error("Error generating description:", error);
        throw error;
    }
};

module.exports = { generatePost, generateCampaignDescription };
