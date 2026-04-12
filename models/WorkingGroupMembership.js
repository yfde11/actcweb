const mongoose = require('mongoose');

const workingGroupMembershipSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        workingGroup: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkingGroup',
            required: true
        },
        joinedAt: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

workingGroupMembershipSchema.index({ user: 1, workingGroup: 1 }, { unique: true });
workingGroupMembershipSchema.index({ workingGroup: 1 });

module.exports = mongoose.model('WorkingGroupMembership', workingGroupMembershipSchema);
