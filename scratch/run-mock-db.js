const mongoose = require('mongoose');

// Mock connection state
mongoose.connect = async function() {
    console.log('Mocked mongoose.connect: bypass MongoDB connection');
    mongoose.connection.readyState = 1;
    // mock event listeners
    setTimeout(() => {
        if (mongoose.connection.on) {
            // no-op
        }
    }, 0);
    return mongoose;
};

// Mock the ready state of mongoose connection
mongoose.connection = {
    readyState: 1,
    on: (event, cb) => {},
    once: (event, cb) => {
        if (event === 'open') {
            cb();
        }
    },
    db: {
        admin: () => ({
            ping: async () => true
        })
    }
};

// Mock the bootstrap database helper
const bootstrap = require('../lib/bootstrapDb');
bootstrap.bootstrapDatabase = async function() {
    console.log('Mocked bootstrapDatabase');
};

// Require the real server
require('../server');
