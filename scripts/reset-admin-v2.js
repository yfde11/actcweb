require('../models/User');
const mongoose = require('mongoose');
require('dotenv').config();

async function resetAdmin() {
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

        console.log('Found admin user, resetting password...');
        
        // Set plain text password - let pre-save middleware hash it
        admin.password = 'admin123';
        await admin.save();
        
        console.log('Password reset successfully');
        console.log('Username: admin');
        console.log('Password: admin123');
        console.log('\nYou can now login with these credentials.');
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

resetAdmin();
