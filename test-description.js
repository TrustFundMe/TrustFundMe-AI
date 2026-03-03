async function testDescription() {
    try {
        console.log("--- Testing Generate Description ---");
        const response = await fetch('http://127.0.0.1:8089/api/generate-description', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: "Ông Tư, 80 tuổi, bán vé số nuôi cháu nội đi học. Hiện bị tai nạn gãy chân, không thể đi làm, cần tiền đóng học phí cho cháu và tiền thuốc men.",
            })
        });

        console.log("Status:", response.status);
        const data = await response.json();
        console.log("Result:", JSON.stringify(data, null, 2));

    } catch (error) {
        console.error("Test failed:", error.message);
    }
}

testDescription();
