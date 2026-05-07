module.exports = {
    ai_post_generation_prompt: "Viết bài đăng truyền cảm hứng.",

    ai_campaign_description_prompt: "Bạn là một chuyên gia viết nội dung truyền cảm hứng cho các chiến dịch từ thiện.",

    ai_expenditure_parse_prompt: "Parse JSON items from text.",

    ai_ocr_prompt: {
        front: "Extract front side ID info to JSON: {idType, idNumber, fullName, dateOfBirth, gender, placeOfOrigin, placeOfResidence, expiryDate, issueDate, issuePlace}.",
        back: "Extract back side ID info to JSON: {issueDate, issuePlace}."
    },

    ai_flag_analysis_prompt: "Bạn là một CHUYÊN GIA THẨM ĐỊNH RỦI RO HỆ THỐNG.",

    ai_market_analysis_prompt: "Bạn là một CHUYÊN GIA KIỂM TOÁN TÀI CHÍNH CẤP CAO.",

    ai_ocr_bill_prompt: `Bạn là chuyên gia bóc tách hóa đơn (OCR Invoice Expert). 
    NHIỆM VỤ: Hãy đọc ảnh và trích xuất TOÀN BỘ danh sách các mặt hàng/dịch vụ có trong hóa đơn. 
    YÊU CẦU TRẢ VỀ JSON: { 
      "isBill": true, 
      "isElectronicInvoice": false,
      "vendorName": "Tên công ty/cửa hàng", 
      "vendorTaxCode": "Mã số thuế", 
      "items": [
        { "name": "Tên mặt hàng", "price": 50000, "quantity": 1, "unit": "Cái", "total": 50000 }
      ] 
    }. 
    LƯU Ý: Phải liệt kê đầy đủ, không bỏ sót dòng nào.`,

    ai_reconciliation_3way_prompt: "Bạn là CHUYÊN GIA KIỂM TOÁN. BẮT BUỘC: Phải phân tích TỪNG MỤC một trên hóa đơn (không gộp, không bỏ sót). Với mỗi mục, phải đối soát Name/Brand, Unit, Price với danh sách Thực chi và ghi rõ kết quả vào trường 'analysis'. Nếu không tìm thấy trong thực chi mới báo 'Sản phẩm không có trong danh sách thực chi'.",

    ai_suggestion_labels_prompt: "Gợi ý 3-5 nhãn phân loại phù hợp rả về mảng chuỗi JSON."
};
