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
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
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
            "description": "Bác Nam năm nay 60 tuổi, hiện đang sinh sống tại Quảng Nam..."
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
            "description": "Nội dung mô tả chi tiết..."
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

const parseExpenditureFromText = async (rawText) => {
    try {
        const systemPrompt = `
Bạn là trợ lý phân tích dữ liệu bảng tính cho nền tảng từ thiện "TrustFundMe".

NHIỆM VỤ: Đọc dữ liệu thô từ file Excel/CSV và trích xuất thông tin vật phẩm chi tiêu.

QUY TẮC BẮT BUỘC:
1. Chỉ trả về đúng 5 trường sau cho mỗi hàng: name, unit, quantity, price, note
2. "name": Tên vật phẩm/sản phẩm/hạng mục chi tiêu
3. "unit": Luôn để giá trị mặc định là "chiếc" (KHÔNG lấy từ cột Đơn vị trong Excel)
4. "quantity": CHỈ LẤY SỐ NGUYÊN THUẦN, không kèm chữ hay đơn vị. Ví dụ: nếu Excel ghi "10 chiếc" thì chỉ lấy 10. Nếu không hợp lệ → 1
5. "price": Đơn giá (VNĐ, số nguyên). Nếu không có hoặc không hợp lệ → 0
6. "note": GỘP lại nội dung từ cột "Đơn vị" VÀ cột "Ghi chú" của Excel (nếu có cả 2 thì nối bằng " - "). Ví dụ: nếu Đơn vị là "Bộ" và Ghi chú là "Nhập từ kho", thì note = "Bộ - Nhập từ kho"
7. BỎ QUA tất cả các cột khác (STT, thành tiền, ngày tháng, địa điểm, v.v.)
8. BỎ QUA các hàng trống, hàng tiêu đề, hàng tổng cộng
9. Chỉ giữ lại các hàng có dữ liệu thực sự là vật phẩm/hạng mục

Đầu ra: JSON object với trường "items" là mảng các vật phẩm:
{
  "items": [
    { "name": "Tên vật phẩm", "unit": "chiếc", "quantity": 10, "price": 50000, "note": "Bộ - Ghi chú thêm" }
  ]
}

Chỉ trả về JSON thuần, không giải thích thêm.
        `;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Dữ liệu Excel:\n\n${rawText}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            max_tokens: 4096,
            response_format: { type: "json_object" }
        });

        const responseContent = completion.choices[0]?.message?.content;
        const parsed = JSON.parse(responseContent);
        return parsed.items || [];

    } catch (error) {
        console.error("Error parsing expenditure from text:", error);
        throw error;
    }
};

module.exports = { generatePost, generateCampaignDescription, parseExpenditureFromText };
