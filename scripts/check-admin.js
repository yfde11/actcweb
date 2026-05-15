require('../models/User');
const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');
require('dotenv').config();

async function checkAdmin() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const User = mongoose.model('User');
        
        // Find admin user
        const admin = await User.findOne({ username: 'admin' }).select('+password');
        if (!admin) {
            console.log('Admin user not found');
            process.exit(1);
        }

        console.log('Admin user found:');
        console.log('- Username:', admin.username);
        console.log('- Email:', admin.email);
        console.log('- Role:', admin.role);
        console.log('- EmailVerified:', admin.emailVerified);
        console.log('- IsActive:', admin.isActive);
        console.log('- Password hash:', admin.password.substring(0, 20) + '...');
        
        // Test password comparison
        const testPassword = 'admin123';
        const isMatch = await bcryptjs.compare(testPassword, admin.password);
        console.log('\nPassword test:');
        console.log('- Testing password: admin123');
        console.log('- Match:', isMatch);
        
        if (!isMatch) {
            console.log('\nFixing password...');
            const hashedPassword = await bcryptjs.hash(testPassword, 10);
            admin.password = hashedPassword;
            await admin.save();
            console.log('Password updated');
            
            // Verify again
            const isMatch2 = await bcryptjs.compare(testPassword, admin.password);
            console.log('- Verify new password:', isMatch2);
        }
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

checkAdmin();
