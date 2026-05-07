const exifr = require('exifr');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');

async function runForensics(photoUrl) {
    let isManipulated = false;
    let warnings = [];
    let heatmapUrl = null;

    // Create a temporary file path
    const tempDir = os.tmpdir();
    const tempImageName = `forensics_${Date.now()}.jpg`;
    const tempImagePath = path.join(tempDir, tempImageName);

    try {
        console.log(`[Forensics] Fetching image: ${photoUrl}`);
        // 1. Fetch and save to temp file
        const response = await axios({
            url: photoUrl,
            method: 'GET',
            responseType: 'arraybuffer'
        });
        fs.writeFileSync(tempImagePath, response.data);

        // 2. Call Python Forensics
        console.log(`[Forensics] Calling Python forensics script...`);
        const pythonScriptPath = path.join(__dirname, 'forensics.py');
        
        // Use 'python' or 'python3' or 'py' depending on environment
        // Try 'python' first, then 'py' as fallback on Windows
        const command = `python "${pythonScriptPath}" "${tempImagePath}" || py "${pythonScriptPath}" "${tempImagePath}"`;

        const forensicsResult = await new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.warn(`[Forensics] Python execution error: ${error.message}`);
                    // Fallback to basic EXIF check if Python fails
                    resolve(null);
                    return;
                }
                if (stderr) {
                    console.warn(`[Forensics] Python stderr: ${stderr}`);
                }
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    console.error(`[Forensics] Failed to parse Python output: ${stdout}`);
                    resolve(null);
                }
            });
        });

        if (forensicsResult) {
            isManipulated = forensicsResult.isManipulated;
            warnings = forensicsResult.warnings || [];
            heatmapUrl = forensicsResult.heatmapUrl;
            console.log(`[Forensics] Python analysis completed. manipulated: ${isManipulated}`);
        } else {
            // Fallback: Use exifr (Node) if Python fails
            console.log(`[Forensics] Falling back to Node-based EXIF check...`);
            try {
                const exifData = await exifr.parse(response.data);
                if (exifData) {
                    const software = (exifData.Software || exifData.ProcessingSoftware || '').toLowerCase();
                    if (software.includes('photoshop') || software.includes('picsart') || software.includes('canva') || software.includes('lightroom')) {
                        isManipulated = true;
                        warnings.push(`Phát hiện dấu vết phần mềm chỉnh sửa: ${exifData.Software || exifData.ProcessingSoftware}`);
                    }
                }
            } catch (exifErr) {
                console.log(`[Forensics] No EXIF data or failed to parse for ${photoUrl}`);
            }
        }

    } catch (err) {
        console.error("[Forensics] Error analyzing image:", err);
    } finally {
        // Cleanup temp file
        if (fs.existsSync(tempImagePath)) {
            try { fs.unlinkSync(tempImagePath); } catch (e) {}
        }
    }

    return {
        isManipulated,
        warnings,
        heatmapUrl
    };
}

module.exports = { runForensics };

