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

module.exports = { generatePost };
