require('../models/User');
const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');
require('dotenv').config();

async function resetAdminPassword() {
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

        // Reset password
        const newPassword = 'admin123';
        const hashedPassword = await bcryptjs.hash(newPassword, 10);
        admin.password = hashedPassword;
        await admin.save();
        
        console.log('Admin password reset successfully');
        console.log('Username: admin');
        console.log('Password: ' + newPassword);
        
    } catch (error) {
        console.error('Error resetting password:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

resetAdminPassword();
