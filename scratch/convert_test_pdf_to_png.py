import fitz  # PyMuPDF
import os

pdf_paths = {
    "test_cert_bruce": "/Users/msxiao/mxproject/actcweb/scratch/test_cert_bruce.pdf",
    "test_cert_historical": "/Users/msxiao/mxproject/actcweb/scratch/test_cert_historical.pdf"
}

output_dir = "/Users/msxiao/.gemini/antigravity/brain/930738dc-1aec-43a0-982b-6751d9429bd5"
os.makedirs(output_dir, exist_ok=True)

for name, path in pdf_paths.items():
    if not os.path.exists(path):
        print(f"Error: {path} does not exist!")
        continue
    
    doc = fitz.open(path)
    print(f"Converting {name}...")
    page = doc[0]  # Render first page
    pix = page.get_pixmap(dpi=150)
    png_name = f"{name}.png"
    png_path = os.path.join(output_dir, png_name)
    pix.save(png_path)
    print(f"Saved {name} image to {png_path}")
