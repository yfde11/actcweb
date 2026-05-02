# Fonts for Certificate Generation

Certificate PDF generation requires Chinese fonts (Noto Sans CJK TC).

## For Development
Fonts are already downloaded to this directory.

## For Production Deployment
Due to font file size (~32MB), you need to:
1. Download fonts manually:
   - NotoSansCJKtc-Regular.otf
   - NotoSansCJKtc-Bold.otf
2. Place them in `fonts/` directory
3. Or modify `services/examCertificates.js` to use system fonts

## Alternative: Use System Fonts
Edit `services/examCertificates.js`:
```javascript
// Replace:
// const FONT_PATH = path.join(__dirname, '../fonts/NotoSansCJKtc-Regular.otf');
// With:
const FONT_PATH = ''; // Use default system font
```
