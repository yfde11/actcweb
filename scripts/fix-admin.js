require('../models/User');
const mongoose = require('mongoose');
require('dotenv').config();

async function fixAdmin() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const User = mongoose.model('User');
        
        // Find admin user
        const admin = await User.findOne({ username: 'admin' });
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
        
        // Fix: set emailVerified to true
        admin.emailVerified = true;
        admin.isActive = true;
        await admin.save();
        
        console.log('\nAdmin user updated:');
        console.log('- EmailVerified: true');
        console.log('- IsActive: true');
        console.log('\nYou can now login with:');
        console.log('- Username: admin');
        console.log('- Password: admin123');
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

fixAdmin();
