const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Certificate = require('../models/Certificate');

async function run() {
    try {
        console.log('Connecting to database:', process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/actc_website');
        console.log('Connected.');

        console.log('\n--- 1. Users with English names ---');
        const users = await User.find({}, 'username fullName englishName email');
        console.log(`Total users found: ${users.length}`);
        users.forEach(u => {
            console.log(`- Username: ${u.username}, FullName: ${u.fullName}, EnglishName: ${u.englishName || '(None)'}, Email: ${u.email}`);
        });

        console.log('\n--- 2. Certificates & recipientEnglishName ---');
        const certs = await Certificate.find({})
            .populate('user', 'username fullName englishName')
            .populate('course')
            .populate('exam');
        
        console.log(`Total certificates found: ${certs.length}`);
        certs.forEach(c => {
            const holderName = c.recipientName || (c.user && c.user.fullName) || '—';
            const holderEnglish = c.recipientEnglishName || (c.user && c.user.englishName) || '(None)';
            console.log(`- CertNo: ${c.certificateNumber}`);
            console.log(`  Holder: ${holderName} / ${holderEnglish}`);
            console.log(`  c.recipientEnglishName in DB: ${c.recipientEnglishName || '(None)'}`);
            if (c.user) {
                console.log(`  User englishName in DB: ${c.user.englishName || '(None)'}`);
            } else {
                console.log(`  User association: None`);
            }
            console.log(`  Type: ${c.certType}`);
            if (c.course) {
                console.log(`  Course: ${c.course.courseName}`);
            }
            if (c.exam) {
                console.log(`  Exam: ${c.exam.title}`);
            }
            console.log('-----------------------------------');
        });

        await mongoose.disconnect();
        console.log('\nDisconnected.');
    } catch (err) {
        console.error('Error running script:', err);
    }
}

run();
