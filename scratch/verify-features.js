const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// 1. Mock Mongoose connect and DB readiness
mongoose.connect = async () => mongoose;
mongoose.connection = {
    readyState: 1,
    on: () => {},
    once: (event, cb) => { if (event === 'open') cb(); },
    db: { admin: () => ({ ping: async () => true }) }
};

// 2. Load models
if (!mongoose.models.CertificateType) {
    require('../models/CertificateType');
}
if (!mongoose.models.Counter) {
    require('../models/Counter');
}
if (!mongoose.models.Exam) {
    require('../models/Exam');
}

const CertificateType = mongoose.model('CertificateType');
const Counter = mongoose.model('Counter');
const Exam = mongoose.model('Exam');

// In-memory mock database
let certificateTypes = [];
let counters = {};
let exams = [];

// Mock Mongoose model queries
CertificateType.findOne = async (query) => {
    return certificateTypes.find(t => {
        if (query.name && t.name !== query.name) return false;
        if (query.prefix && t.prefix !== query.prefix) return false;
        return true;
    }) || null;
};

CertificateType.prototype.save = async function() {
    this.counterKey = this.prefix.toLowerCase().replace(/-/g, '_') + '_cert_num';
    if (!this._id) {
        this._id = new mongoose.Types.ObjectId();
    }
    certificateTypes.push(this);
    return this;
};

CertificateType.findByIdAndUpdate = async (id, update, options) => {
    const item = certificateTypes.find(t => t._id.toString() === id.toString());
    if (item) {
        if (update.$set) {
            Object.assign(item, update.$set);
        }
        return item;
    }
    return null;
};

Counter.findByIdAndUpdate = async (id, update, options) => {
    if (update.$set && update.$set.seq !== undefined) {
        counters[id] = update.$set.seq;
    }
    return { _id: id, seq: counters[id] || 0 };
};

Exam.find = async (query) => {
    return exams.filter(e => {
        if (query.certTypeRef && e.certTypeRef.toString() !== query.certTypeRef.toString()) return false;
        if (query.isActive !== undefined && e.isActive !== query.isActive) return false;
        return true;
    });
};

// 3. Mock middleware auth
const adminAuth = (req, res, next) => {
    req.user = { userId: new mongoose.Types.ObjectId().toString(), role: 'admin' };
    next();
};
require('../middleware/adminAuth').adminAuth = adminAuth;

// 4. Setup Express App
const app = express();
app.use(express.json());

const adminCertTypeRoutes = require('../routes/admin-certificate-types');
app.use('/api/admin/certificate-types', adminCertTypeRoutes);

const PORT = 6003;
let server;

async function runTests() {
    server = app.listen(PORT, async () => {
        console.log(`Test server running on port ${PORT}`);
        try {
            // TEST 1: POST /api/admin/certificate-types with startingSequence = 100
            console.log('\n--- TEST 1: Create Certificate Type with startingSequence 100 ---');
            const res1 = await fetch(`http://localhost:${PORT}/api/admin/certificate-types`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Test CISSP',
                    titleZh: 'CISSP 認證證書',
                    titleEn: 'CISSP Certificate',
                    prefix: 'ACTC-CISSP',
                    startingSequence: 100
                })
            });
            const data1 = await res1.json();
            console.log('Status:', res1.status);
            console.log('Created Type:', data1.data);
            
            const expectedCounterKey = 'actc_cissp_cert_num';
            console.log('Stored Counter value:', counters[expectedCounterKey]);
            if (counters[expectedCounterKey] === 99) {
                console.log('✅ TEST 1 PASSED: Counter initialized to startingSequence - 1 (99)');
            } else {
                console.log('❌ TEST 1 FAILED: Expected counter 99, got', counters[expectedCounterKey]);
            }

            // TEST 2: PATCH /api/admin/certificate-types/:id with prefix change and startingSequence = 500
            console.log('\n--- TEST 2: Update Prefix and startingSequence to 500 ---');
            const certTypeId = data1.data._id;
            const res2 = await fetch(`http://localhost:${PORT}/api/admin/certificate-types/${certTypeId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prefix: 'ACTC-CISSP-NEW',
                    confirmPrefixChange: true,
                    startingSequence: 500
                })
            });
            const data2 = await res2.json();
            console.log('Status:', res2.status);
            console.log('Updated Type:', data2.data);
            
            const expectedNewCounterKey = 'actc_cissp_new_cert_num';
            console.log('New Counter value:', counters[expectedNewCounterKey]);
            if (counters[expectedNewCounterKey] === 499) {
                console.log('✅ TEST 2 PASSED: New counter initialized to 499');
            } else {
                console.log('❌ TEST 2 FAILED: Expected new counter 499, got', counters[expectedNewCounterKey]);
            }

            // TEST 3: POST /api/admin/certificate-types/preview
            console.log('\n--- TEST 3: Generate Preview PDF ---');
            const res3 = await fetch(`http://localhost:${PORT}/api/admin/certificate-types/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    titleZh: '自訂預覽證書',
                    titleEn: 'Custom Preview Certificate',
                    bodyText: '本證書證明 {{name}} 已通過 {{examTitle}}，發證日期 {{date}}。'
                })
            });
            console.log('Status:', res3.status);
            console.log('Content-Type:', res3.headers.get('content-type'));
            if (res3.status === 200 && res3.headers.get('content-type') === 'application/pdf') {
                console.log('✅ TEST 3 PASSED: Preview PDF successfully streamed');
            } else {
                console.log('❌ TEST 3 FAILED');
            }

            // TEST 4: DELETE /api/admin/certificate-types/:id with active exams
            console.log('\n--- TEST 4: Disable Certificate Type with Active Exam Dependencies ---');
            // Bind active exam to this certificate type
            exams.push({
                _id: new mongoose.Types.ObjectId(),
                title: 'CISSP 資訊安全稽核師考試',
                certTypeRef: new mongoose.Types.ObjectId(certTypeId),
                isActive: true
            });

            const res4 = await fetch(`http://localhost:${PORT}/api/admin/certificate-types/${certTypeId}`, {
                method: 'DELETE'
            });
            const data4 = await res4.json();
            console.log('Status:', res4.status);
            console.log('Response Body:', data4);
            if (res4.status === 400 && data4.error?.code === 'DEPENDENCY_ERROR') {
                console.log('✅ TEST 4 PASSED: Soft-delete blocked due to active exam dependency');
            } else {
                console.log('❌ TEST 4 FAILED');
            }

        } catch (e) {
            console.error('Error during test execution:', e);
        } finally {
            server.close(() => {
                console.log('\nTest server shut down. All tests finished.');
            });
        }
    });
}

runTests();
