import sys
import json
import io
import os
from PIL import Image, ImageChops, ImageEnhance
import exifread

def run_forensics(image_path):
    result = {
        "isManipulated": False,
        "warnings": [],
        "heatmapUrl": None
    }

    try:
        # 1. Metadata Check with exifread
        with open(image_path, 'rb') as f:
            tags = exifread.process_file(f)
            software_tags = ['Image Software', 'Image ProcessingSoftware', 'EXIF Software']
            for tag_name in software_tags:
                if tag_name in tags:
                    software = str(tags[tag_name]).lower()
                    if any(s in software for s in ['photoshop', 'picsart', 'canva', 'lightroom', 'gimp']):
                        result["isManipulated"] = True
                        result["warnings"].append(f"Phát hiện dấu vết phần mềm chỉnh sửa (Metadata): {software}")
                        break

        # 2. ELA (Error Level Analysis)
        # Load image
        original = Image.open(image_path).convert('RGB')
        
        # Temp path for compression
        temp_path = image_path + "_temp.jpg"
        original.save(temp_path, 'JPEG', quality=90)
        
        # Re-open compressed image
        compressed = Image.open(temp_path)
        
        # Calculate absolute difference
        ela_image = ImageChops.difference(original, compressed)
        
        # Calculate max difference to normalize (like the JS version did)
        extrema = ela_image.getextrema()
        max_diff = max([ex[1] for ex in extrema])
        if max_diff == 0:
            max_diff = 1
        scale = 255.0 / max_diff
        
        # Enhance brightness
        ela_image = ImageEnhance.Brightness(ela_image).enhance(scale)
        
        # Convert to Base64 (buffered)
        buffered = io.BytesIO()
        ela_image.save(buffered, format="JPEG")
        import base64
        heatmap_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        result["heatmapUrl"] = f"data:image/jpeg;base64,{heatmap_base64}"
        
        # Clean up
        if os.path.exists(temp_path):
            os.remove(temp_path)

    except Exception as e:
        result["warnings"].append(f"Lỗi phân tích: {str(e)}")

    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing image path"}))
        sys.exit(1)
        
    image_path = sys.argv[1]
    res = run_forensics(image_path)
    print(json.dumps(res))
