require('../models/User');
const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');
require('dotenv').config();

async function createAdmin() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const User = mongoose.model('User');
        
        // Check if admin already exists
        const existingAdmin = await User.findOne({ username: 'admin' });
        if (existingAdmin) {
            console.log('Admin user already exists');
            process.exit(0);
        }

        // Create admin user
        const hashedPassword = await bcryptjs.hash('admin123', 10);
        const admin = new User({
            username: 'admin',
            password: hashedPassword,
            email: 'admin@actc.org.tw',
            fullName: 'Administrator',
            role: 'admin',
            emailVerified: true,
            membershipStatus: 'none'
        });

        await admin.save();
        console.log('Admin user created successfully');
        console.log('Username: admin');
        console.log('Password: admin123');
        
    } catch (error) {
        console.error('Error creating admin:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

createAdmin();
