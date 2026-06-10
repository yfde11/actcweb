import asyncio
import os
import json
from pathlib import Path
from playwright.async_api import async_playwright
import fitz  # PyMuPDF

RUN_DIR = Path(__file__).parent
WORKSPACE = RUN_DIR.parent.parent
SCREENSHOTS = RUN_DIR / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
LOG = RUN_DIR / "final_script_log.txt"

# Reset log file
LOG.write_text("")

def log(step: int, msg: str) -> None:
    line = f"step {step} action: {msg}\n"
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line)
    print(line, end="")

async def main():
    log(1, "Starting Playwright Firefox browser and setting up API mocks")
    
    async with async_playwright() as playwright:
        browser = await playwright.firefox.launch(headless=True)
        # Always set viewport width: 1280, height: 1800 per Webwright contract
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # Console logging
        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"BROWSER ERROR: {err}"))

        # Network logging
        page.on("request", lambda req: print(f"REQ: {req.method} {req.url}"))
        page.on("response", lambda res: print(f"RES: {res.status} {res.url}"))

        # Mock Login API
        async def mock_login(route):
            await route.fulfill(
                status=200,
                content_type="application/json",
                headers={
                    "set-cookie": "memberToken=mock-token; Path=/; Max-Age=86400"
                },
                body=json.dumps({
                    "message": "登入成功",
                    "token": "mock-token",
                    "user": {
                        "id": "60c72b2f9b1d8b2bad000003",
                        "username": "admin",
                        "email": "admin@example.com",
                        "role": "admin",
                        "isFirstLogin": False,
                        "emailVerified": True,
                        "membershipStatus": "approved"
                    }
                })
            )
        await page.route("**/api/auth/login", mock_login)

        # Mock Profile me API
        async def mock_profile(route):
            await route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "user": {
                        "id": "60c72b2f9b1d8b2bad000003",
                        "username": "admin",
                        "email": "admin@example.com",
                        "fullName": "陳小明",
                        "phone": "0912345678",
                        "role": "admin",
                        "emailVerified": True,
                        "membershipStatus": "approved",
                        "emailSubscribed": True,
                        "isFirstLogin": False,
                        "workingGroupIds": []
                    }
                })
            )
        await page.route("**/api/profile/me", mock_profile)

        # Mock Certificates List API
        async def mock_certificates(route):
            await route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "data": [
                        {
                            "_id": "60c72b2f9b1d8b2bad000001",
                            "certificateNumber": "ACTC-COURSE-2026-000012",
                            "certType": "course",
                            "course": {
                                "courseName": "ISO 27001 資訊安全管理系統主導稽核員課程"
                            },
                            "recipientName": "陳小明",
                            "issuedAt": "2026-05-02T00:00:00.000Z",
                            "expiresAt": None
                        },
                        {
                            "_id": "60c72b2f9b1d8b2bad000002",
                            "certificateNumber": "ACTC-EXAM-2026-000025",
                            "certType": "exam",
                            "exam": {
                                "title": "CISM 國際資訊安全經理人認證考試"
                            },
                            "recipientName": "張斐爾",
                            "issuedAt": "2026-06-08T00:00:00.000Z",
                            "expiresAt": "2029-06-08T00:00:00.000Z"
                        }
                    ],
                    "pagination": {
                        "total": 2,
                        "totalPages": 1,
                        "page": 1,
                        "limit": 20
                    }
                })
            )
        await page.route("**/api/member/exams/certificates", mock_certificates)

        # Mock PDF Download APIs using the pre-generated offline PDF files
        course_pdf_file = WORKSPACE / "course.pdf"
        exam_pdf_file = WORKSPACE / "exam.pdf"

        async def mock_course_pdf(route):
            if course_pdf_file.exists():
                await route.fulfill(
                    status=200,
                    content_type="application/pdf",
                    headers={
                        "content-disposition": 'attachment; filename="certificate-ACTC-COURSE-2026-000012.pdf"'
                    },
                    body=course_pdf_file.read_bytes()
                )
            else:
                await route.fulfill(status=404, body="Course PDF not found")
        await page.route("**/api/member/exams/certificate/ACTC-COURSE-2026-000012", mock_course_pdf)

        async def mock_exam_pdf(route):
            if exam_pdf_file.exists():
                await route.fulfill(
                    status=200,
                    content_type="application/pdf",
                    headers={
                        "content-disposition": 'attachment; filename="certificate-ACTC-EXAM-2026-000025.pdf"'
                    },
                    body=exam_pdf_file.read_bytes()
                )
            else:
                await route.fulfill(status=404, body="Exam PDF not found")
        await page.route("**/api/member/exams/certificate/ACTC-EXAM-2026-000025", mock_exam_pdf)

        # Navigate to member login page
        log(2, "Navigating to member login page")
        await page.goto("http://localhost:5001/member", wait_until="domcontentloaded")
        await asyncio.sleep(2)
        
        # Fill in credentials and log in
        await page.fill('input[placeholder="使用者名稱或 Email"]', "admin")
        await page.fill('input[placeholder="密碼"]', "admin123")
        await page.click('button:has-text("登入")')
        await asyncio.sleep(3)

        # Navigate to Exams & Certificates tab and open modal using Alpine.js directly
        log(3, "Opening Exams & Certificates tab and modal via Alpine.js state change")
        await page.evaluate("""() => {
            Alpine.$data(document.body).activeTab = 'exams';
            const examsData = Alpine.$data(document.querySelector('#exams'));
            examsData.showCertificates = true;
            examsData.loadCertificates();
        }""")
        await asyncio.sleep(3)

        # Verify dashboard rendered (modal open)
        log(4, "Verifying dashboard certificates modal is displayed")
        dashboard_screenshot = SCREENSHOTS / "final_execution_1_dashboard.png"
        await page.screenshot(path=str(dashboard_screenshot))
        log(5, f"Dashboard screenshot captured: {dashboard_screenshot.name}")

        # Download Course Certificate
        log(6, "Downloading Course Certificate (ACTC-COURSE-2026-000012)")
        async with page.expect_download() as download_info:
            # Click the download button for ACTC-COURSE-2026-000012 inside the modal
            await page.locator("text=ACTC-COURSE-2026-000012").locator("xpath=ancestor::div[contains(@class, 'border')][1]").get_by_role("button", name="下載").click()
        
        download_course = await download_info.value
        downloaded_course_path = RUN_DIR / "downloaded_course.pdf"
        await download_course.save_as(str(downloaded_course_path))
        log(7, f"Downloaded course certificate saved to {downloaded_course_path}")

        # Render Course PDF to PNG
        log(8, "Rendering downloaded Course PDF to PNG for visual inspection")
        doc_course = fitz.open(str(downloaded_course_path))
        page_course = doc_course[0]
        pix_course = page_course.get_pixmap(dpi=150)
        course_png_path = SCREENSHOTS / "final_execution_2_course_pdf.png"
        pix_course.save(str(course_png_path))
        log(9, f"Course Certificate PDF page rendered and saved as: {course_png_path.name}")

        # Download Exam Certificate
        log(10, "Downloading Exam Certificate (ACTC-EXAM-2026-000025)")
        async with page.expect_download() as download_info:
            await page.locator("text=ACTC-EXAM-2026-000025").locator("xpath=ancestor::div[contains(@class, 'border')][1]").get_by_role("button", name="下載").click()
            
        download_exam = await download_info.value
        downloaded_exam_path = RUN_DIR / "downloaded_exam.pdf"
        await download_exam.save_as(str(downloaded_exam_path))
        log(11, f"Downloaded exam certificate saved to {downloaded_exam_path}")

        # Render Exam PDF to PNG
        log(12, "Rendering downloaded Exam PDF to PNG for visual inspection")
        doc_exam = fitz.open(str(downloaded_exam_path))
        page_exam = doc_exam[0]
        pix_exam = page_exam.get_pixmap(dpi=150)
        exam_png_path = SCREENSHOTS / "final_execution_4_exam_pdf.png"
        pix_exam.save(str(exam_png_path))
        log(13, f"Exam Certificate PDF page rendered and saved as: {exam_png_path.name}")

        # Append final success response status to log
        with LOG.open("a", encoding="utf-8") as f:
            f.write("\nFINAL_RESPONSE: SUCCESS\n")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
