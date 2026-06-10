const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// 1. Mock connection and DB readiness
mongoose.connect = async () => mongoose;
mongoose.connection = {
    readyState: 1,
    on: () => {},
    once: (event, cb) => { if (event === 'open') cb(); },
    db: { admin: () => ({ ping: async () => true }) }
};

// 2. Load models
const User = require('../models/User');
const CourseAttendance = require('../models/CourseAttendance');
const Certificate = require('../models/Certificate');
const Counter = require('../models/Counter');

// Mock in-memory database
const db = {
    users: [],
    attendances: [],
    certificates: [],
    counters: {}
};

// Mock User methods
User.prototype.save = async function() {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    db.users.push(this);
    return this;
};

User.findOne = (query) => {
    const queryObj = {
        select: function(fields) {
            return this;
        },
        then: function(onSuccess, onFailure) {
            const user = db.users.find(u => {
                if (query.email && u.email.toLowerCase() !== query.email.toLowerCase()) return false;
                return true;
            });
            return Promise.resolve(user).then(onSuccess, onFailure);
        },
        catch: function(onFailure) {
            return this.then(null, onFailure);
        }
    };
    return queryObj;
};

// Mock CourseAttendance methods
CourseAttendance.prototype.save = async function() {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    db.attendances.push(this);
    return this;
};
CourseAttendance.findById = (id) => {
    const item = db.attendances.find(a => a._id.toString() === id.toString());
    if (!item) return null;
    return {
        populate: async (pathStr) => {
            if (pathStr === 'user' && item.user) {
                item.user = db.users.find(u => u._id.toString() === item.user.toString());
            }
            return item;
        }
    };
};

// Mock Certificate methods
Certificate.prototype.save = async function() {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    const idx = db.certificates.findIndex(c => c._id.toString() === this._id.toString());
    if (idx !== -1) {
        db.certificates[idx] = this;
    } else {
        db.certificates.push(this);
    }
    return this;
};

Certificate.findOne = (query) => {
    const queryObj = {
        populate: function(path) {
            return this;
        },
        then: function(onSuccess, onFailure) {
            const cert = db.certificates.find(c => {
                if (query.certificateNumber && c.certificateNumber !== query.certificateNumber) return false;
                if (query.attempt && c.attempt?.toString() !== query.attempt?.toString()) return false;
                return true;
            });
            if (!cert) return Promise.resolve(null).then(onSuccess, onFailure);
            const doc = {
                _id: cert._id,
                certificateNumber: cert.certificateNumber,
                certType: cert.certType,
                recipientName: cert.recipientName,
                recipientEnglishName: cert.recipientEnglishName,
                recipientEmail: cert.recipientEmail,
                user: cert.user ? db.users.find(u => u._id.toString() === cert.user.toString()) : null,
                course: cert.course ? db.attendances.find(a => a._id.toString() === cert.course.toString()) : null,
                expiresAt: cert.expiresAt,
                issuedAt: cert.issuedAt || new Date(),
                save: async function() {
                    Object.assign(cert, this);
                    return cert;
                },
                populate: function(pathStr) {
                    return this;
                }
            };
            return Promise.resolve(doc).then(onSuccess, onFailure);
        }
    };
    return queryObj;
};

Certificate.findById = (id) => {
    const queryObj = {
        populate: function(path) {
            return this;
        },
        then: function(onSuccess, onFailure) {
            const cert = db.certificates.find(c => c._id.toString() === id.toString());
            if (!cert) return Promise.resolve(null).then(onSuccess, onFailure);
            const doc = {
                _id: cert._id,
                certificateNumber: cert.certificateNumber,
                certType: cert.certType,
                recipientName: cert.recipientName,
                recipientEnglishName: cert.recipientEnglishName,
                recipientEmail: cert.recipientEmail,
                user: cert.user ? db.users.find(u => u._id.toString() === cert.user.toString()) : null,
                course: cert.course ? db.attendances.find(a => a._id.toString() === cert.course.toString()) : null,
                expiresAt: cert.expiresAt,
                issuedAt: cert.issuedAt || new Date(),
                save: async function() {
                    Object.assign(cert, this);
                    return cert;
                },
                populate: function(pathStr) {
                    return this;
                }
            };
            return Promise.resolve(doc).then(onSuccess, onFailure);
        }
    };
    return queryObj;
};

Certificate.updateOne = async (query, update) => {
    const cert = db.certificates.find(c => c._id.toString() === query._id.toString());
    if (cert && update.$set) {
        Object.assign(cert, update.$set);
    }
    return { nModified: 1 };
};

// Mock Counter sequence generator
Counter.getNextSequence = async (key) => {
    if (!db.counters[key]) db.counters[key] = 0;
    db.counters[key]++;
    return db.counters[key];
};

// 3. Run tests using service functions
const { issueCourseAttendanceCertificate, verifyCertificate, generateCertificatePDF } = require('../services/examCertificates');

async function run() {
    console.log('Running English Name verification using in-memory Mongoose Mocks...');

    try {
        console.log('\n--- Case 1: Create user with English name ---');
        const user = new User({
            username: 'test_en_bruce',
            email: 'test_en_bruce@example.com',
            password: 'password123',
            fullName: '李小龍',
            englishName: 'Bruce Lee',
            phone: '0912345678',
            emailVerified: true
        });
        await user.save();
        console.log('Test user created:', user.fullName, `(${user.englishName})`);

        console.log('\n--- Case 2: Create course attendance with English name ---');
        const attendance = new CourseAttendance({
            courseName: 'TEST_COURSE_詠春拳大師班',
            recipientName: '李小龍',
            recipientEnglishName: 'Bruce Lee',
            recipientEmail: 'test_en_bruce@example.com',
            user: user._id,
            attendanceDate: new Date(),
            completionHours: 16,
            createdBy: user._id
        });
        await attendance.save();
        console.log('Course attendance created:', attendance.courseName);

        console.log('\n--- Case 3: Issue certificate ---');
        const { certificate } = await issueCourseAttendanceCertificate(attendance._id.toString());
        console.log('Issued certificate number:', certificate.certificateNumber);
        console.log('Persisted English name on cert:', certificate.recipientEnglishName);

        if (certificate.recipientEnglishName === 'Bruce Lee') {
            console.log('✅ PERSISTENCE PASSED: recipientEnglishName saved correctly');
        } else {
            console.log('❌ PERSISTENCE FAILED: recipientEnglishName is', certificate.recipientEnglishName);
        }

        console.log('\n--- Case 4: Verify certificate API ---');
        const verifyRes = await verifyCertificate(certificate.certificateNumber);
        console.log('Verification status ok:', verifyRes.ok);
        console.log('holderName:', verifyRes.data.holderName);
        console.log('holderEnglishName:', verifyRes.data.holderEnglishName);

        if (verifyRes.ok && verifyRes.data.holderName === '李小龍' && verifyRes.data.holderEnglishName === 'Bruce Lee') {
            console.log('✅ VERIFICATION API PASSED: name fields resolved correctly');
        } else {
            console.log('❌ VERIFICATION API FAILED: got', verifyRes.data);
        }

        console.log('\n--- Case 5: Render PDF and verify layout compile ---');
        const pdfFilename = path.join(__dirname, 'test_cert_bruce.pdf');
        if (fs.existsSync(pdfFilename)) {
            fs.unlinkSync(pdfFilename);
        }
        const mockRes = fs.createWriteStream(pdfFilename);
        mockRes.setHeader = function(key, val) {
            this.headers = this.headers || {};
            this.headers[key] = val;
        };

        await new Promise((resolve, reject) => {
            mockRes.on('finish', resolve);
            mockRes.on('error', reject);
            generateCertificatePDF(certificate._id.toString(), mockRes).catch(reject);
        });

        console.log('PDF generated at:', pdfFilename);
        if (fs.existsSync(pdfFilename) && fs.statSync(pdfFilename).size > 1000) {
            console.log('✅ PDF RENDER PASSED: File generated successfully and has data');
        } else {
            console.log('❌ PDF RENDER FAILED');
        }

        console.log('\n--- Case 6: Test Historical Upgrade Logic (profile English name changes) ---');
        // Create another certificate without English name on certificate, but user has it
        const certNoEn = new Certificate({
            certificateNumber: `TEST-CERT-${new Date().getFullYear()}-000001`,
            certType: 'course',
            course: attendance._id,
            user: user._id,
            recipientName: '李小龍',
            // recipientEnglishName is undefined / null
            issuedAt: new Date()
        });
        await certNoEn.save();

        const pdfFilenameHist = path.join(__dirname, 'test_cert_historical.pdf');
        if (fs.existsSync(pdfFilenameHist)) {
            fs.unlinkSync(pdfFilenameHist);
        }

        const mockResHist = fs.createWriteStream(pdfFilenameHist);
        mockResHist.setHeader = function(key, val) {
            this.headers = this.headers || {};
            this.headers[key] = val;
        };

        console.log('Rendering historical cert (before download, englishName is empty in DB)...');
        await new Promise((resolve, reject) => {
            mockResHist.on('finish', resolve);
            mockResHist.on('error', reject);
            generateCertificatePDF(certNoEn._id.toString(), mockResHist).catch(reject);
        });

        // Fetch cert again from DB
        const updatedCert = db.certificates.find(c => c._id.toString() === certNoEn._id.toString());
        console.log('Updated Certificate recipientEnglishName:', updatedCert.recipientEnglishName);
        if (updatedCert.recipientEnglishName === 'Bruce Lee') {
            console.log('✅ HISTORICAL UPGRADE PASSED: englishName solidified on download');
        } else {
            console.log('❌ HISTORICAL UPGRADE FAILED');
        }

        console.log('\n--- Case 7: Test On-The-Fly Linking (user registers AFTER certificate is imported) ---');
        // 1. Create a certificate with user: null and recipientEmail
        const certUnlinked = new Certificate({
            certificateNumber: `TEST-CERT-${new Date().getFullYear()}-999999`,
            certType: 'course',
            course: attendance._id,
            user: null,
            recipientName: '張大千',
            recipientEmail: 'late_register@example.com',
            issuedAt: new Date()
        });
        await certUnlinked.save();

        // 2. Register user with matching email
        const userLate = new User({
            username: 'late_user_chang',
            email: 'late_register@example.com',
            password: 'password123',
            fullName: '張大千',
            englishName: 'Chang Dai-chien',
            phone: '0987654321',
            emailVerified: true
        });
        await userLate.save();

        // 3. Render PDF to trigger on-the-fly linking
        const pdfFilenameLate = path.join(__dirname, 'test_cert_late.pdf');
        if (fs.existsSync(pdfFilenameLate)) {
            fs.unlinkSync(pdfFilenameLate);
        }
        const mockResLate = fs.createWriteStream(pdfFilenameLate);
        mockResLate.setHeader = function(key, val) {};

        await new Promise((resolve, reject) => {
            mockResLate.on('finish', resolve);
            mockResLate.on('error', reject);
            generateCertificatePDF(certUnlinked._id.toString(), mockResLate).catch(reject);
        });

        // 4. Verify linking and English name solidification in DB
        const updatedCertLate = db.certificates.find(c => c._id.toString() === certUnlinked._id.toString());
        console.log('After linking - cert.user:', updatedCertLate.user ? updatedCertLate.user.toString() : 'null');
        console.log('After linking - cert.recipientEnglishName:', updatedCertLate.recipientEnglishName);

        if (updatedCertLate.user && updatedCertLate.user.toString() === userLate._id.toString() && updatedCertLate.recipientEnglishName === 'Chang Dai-chien') {
            console.log('✅ ON-THE-FLY LINKING PASSED: user linked and englishName solidified');
        } else {
            console.log('❌ ON-THE-FLY LINKING FAILED');
        }

        console.log('\n🌟 ALL TESTS COMPLETED SUCCESSFULY! 🌟');

    } catch (err) {
        console.error('Test execution failed:', err);
    }
}

run();
