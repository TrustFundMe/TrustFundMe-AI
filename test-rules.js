// Removed axios requirement, using native fetch

// Using native fetch for simplicity since Node.js environment is likely modern.

async function testCustomRules() {
    const url = 'http://localhost:3000/api/generate-post';
    const data = {
        prompt: "Bé Nam, 10 tuổi, ung thư máu, cần 100 triệu, Viện Huyết học",
        rules: "Bài viết phải có giọng văn cực kỳ nghiêm túc. KHÔNG dùng icon. Bắt buộc thêm câu: 'Liên hệ hotline TrustFundMe: 1900 1234' vào cuối bài."
    };

    console.log("Testing with Custom Rules:", data.rules);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        console.log("\n--- Generated Result ---\n");
        console.log(JSON.stringify(result, null, 2));

        if (result.content.includes("1900 1234")) {
            console.log("\n[SUCCESS] Rule verification passed: Hotline found.");
        } else {
            console.log("\n[WARNING] Rule verification: Hotline NOT found.");
        }

    } catch (error) {
        console.error("Test Failed:", error);
    }
}

testCustomRules();
