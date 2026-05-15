require('../models/User');
const mongoose = require('mongoose');
require('dotenv').config();

async function createMember() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const User = mongoose.model('User');
        
        // Check if test member already exists
        const existing = await User.findOne({ username: 'testmember' });
        if (existing) {
            console.log('Test member already exists');
            console.log('Username: testmember');
            console.log('Password: test123');
            process.exit(0);
        }

        // Create member user
        const member = new User({
            username: 'testmember',
            password: 'test123',
            email: 'test@example.com',
            fullName: 'Test Member',
            role: 'user',
            emailVerified: true,
            membershipStatus: 'approved',
            isFirstLogin: false
        });

        await member.save();
        console.log('Member user created successfully');
        console.log('Username: testmember');
        console.log('Password: test123');
        
    } catch (error) {
        console.error('Error creating member:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

createMember();
