const mongoose = require('mongoose');

const corporateMemberSchema = new mongoose.Schema({
    // 基本資訊
    companyName: {
        type: String,
        required: [true, '公司名稱為必填'],
        trim: true,
        maxlength: [200, '公司名稱不能超過200字符']
    },
    companyNameEn: {
        type: String,
        trim: true,
        maxlength: [200, '英文公司名稱不能超過200字符']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [1000, '公司描述不能超過1000字符']
    },
    
    // 聯絡資訊
    contactPerson: {
        type: String,
        required: [true, '聯絡人為必填'],
        trim: true,
        maxlength: [100, '聯絡人姓名不能超過100字符']
    },
    contactTitle: {
        type: String,
        trim: true,
        maxlength: [100, '職稱不能超過100字符']
    },
    email: {
        type: String,
        required: [true, 'Email為必填'],
        trim: true,
        lowercase: true,
        validate: {
            validator: function(v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: '請輸入有效的Email地址'
        }
    },
    phone: {
        type: String,
        trim: true,
        validate: {
            validator: function(v) {
                return !v || /^[\d\-\+\(\)\s]+$/.test(v);
            },
            message: '請輸入有效的電話號碼'
        }
    },
    website: {
        type: String,
        trim: true,
        validate: {
            validator: function(v) {
                return !v || /^https?:\/\/.+/.test(v);
            },
            message: '網站URL必須以http://或https://開頭'
        }
    },
    
    // 地址資訊
    address: {
        type: String,
        trim: true,
        maxlength: [300, '地址不能超過300字符']
    },
    city: {
        type: String,
        trim: true,
        maxlength: [50, '城市不能超過50字符']
    },
    country: {
        type: String,
        trim: true,
        maxlength: [50, '國家不能超過50字符'],
        default: 'Taiwan'
    },
    
    // 會員資訊
    membershipType: {
        type: String,
        enum: ['platinum', 'gold', 'silver', 'bronze', 'regular'],
        default: 'regular',
        required: true
    },
    membershipLevel: {
        type: String,
        enum: ['A+', 'A', 'B+', 'B', 'C'],
        default: 'C'
    },
    joinDate: {
        type: Date,
        default: Date.now
    },
    expiryDate: {
        type: Date
    },
    
    // 媒體資源
    logo: {
        type: String,
        trim: true,
        validate: {
            validator: function(v) {
                if (!v) return true; // 允許空值
                
                // 相對路徑格式: /uploads/images/xxx.jpg
                const relativePathRegex = /^\/uploads\/images\/.+\.(jpg|jpeg|png|gif|webp|svg)$/i;
                
                // 完整URL格式: 支援帶查詢參數的URL
                const fullUrlRegex = /^https?:\/\/.+/i;
                
                // 如果是完整URL，檢查是否包含圖片相關關鍵字或結尾有圖片副檔名
                if (fullUrlRegex.test(v)) {
                    const imageExtRegex = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;
                    const imageKeywordRegex = /(image|img|photo|pic|logo|avatar|thumbnail)/i;
                    return imageExtRegex.test(v) || imageKeywordRegex.test(v) || /placeholder|picsum|unsplash/.test(v);
                }
                
                return relativePathRegex.test(v);
            },
            message: 'Logo URL必須是有效的圖片檔案路徑或URL'
        }
    },
    
    // 業務資訊
    industry: {
        type: String,
        trim: true,
        maxlength: [100, '行業不能超過100字符']
    },
    services: [{
        type: String,
        trim: true,
        maxlength: [200, '服務項目不能超過200字符']
    }],
    specialization: [{
        type: String,
        trim: true,
        maxlength: [100, '專業領域不能超過100字符']
    }],
    
    // 顯示控制
    isActive: {
        type: Boolean,
        default: true,
        required: true,
        index: true
    },
    isDisplayed: {
        type: Boolean,
        default: false,
        required: true,
        index: true
    },
    displayOrder: {
        type: Number,
        default: 0,
        index: true
    },
    
    // 附加資訊
    tags: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    notes: {
        type: String,
        trim: true,
        maxlength: [1000, '備註不能超過1000字符']
    },
    
    // 系統資訊
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// 索引
corporateMemberSchema.index({ companyName: 1 });
corporateMemberSchema.index({ membershipType: 1 });
corporateMemberSchema.index({ isActive: 1, isDisplayed: 1 });
corporateMemberSchema.index({ displayOrder: 1, createdAt: -1 });
corporateMemberSchema.index({ industry: 1 });
corporateMemberSchema.index({ tags: 1 });

// 虛擬字段
corporateMemberSchema.virtual('membershipStatus').get(function() {
    if (!this.isActive) return 'inactive';
    if (this.expiryDate && this.expiryDate < new Date()) return 'expired';
    return 'active';
});

corporateMemberSchema.virtual('formattedJoinDate').get(function() {
    return this.joinDate.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
});

corporateMemberSchema.virtual('daysUntilExpiry').get(function() {
    if (!this.expiryDate) return null;
    const today = new Date();
    const diffTime = this.expiryDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// 靜態方法
/** 前台列表／分頁 count 共用之查詢條件 */
corporateMemberSchema.statics.buildDisplayedMembersFilter = function(filters = {}) {
    const { membershipType, industry, search } = filters;
    const query = { isActive: true, isDisplayed: true };

    if (membershipType) {
        query.membershipType = membershipType;
    }

    if (industry) {
        query.industry = new RegExp(industry, 'i');
    }

    if (search && String(search).trim()) {
        const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'i');
        query.$or = [{ companyName: re }, { companyNameEn: re }];
    }

    return query;
};

corporateMemberSchema.statics.getDisplayedMembers = function(options = {}) {
    const {
        membershipType,
        industry,
        search,
        limit = 20,
        skip = 0,
        sortBy = 'displayOrder'
    } = options;

    const query = this.buildDisplayedMembersFilter({ membershipType, industry, search });

    let sort = {};
    if (sortBy === 'displayOrder') {
        sort = { displayOrder: 1, createdAt: -1 };
    } else if (sortBy === 'joinDate') {
        sort = { joinDate: -1 };
    } else if (sortBy === 'companyName') {
        sort = { companyName: 1 };
    }
    
    return this.find(query)
        .sort(sort)
        .limit(limit)
        .skip(skip);
};

corporateMemberSchema.statics.getMembershipStats = function() {
    return this.aggregate([
        {
            $group: {
                _id: '$membershipType',
                count: { $sum: 1 },
                active: {
                    $sum: {
                        $cond: [{ $eq: ['$isActive', true] }, 1, 0]
                    }
                },
                displayed: {
                    $sum: {
                        $cond: [{ $eq: ['$isDisplayed', true] }, 1, 0]
                    }
                }
            }
        },
        {
            $sort: { _id: 1 }
        }
    ]);
};

// 實例方法
corporateMemberSchema.methods.toggleDisplay = function() {
    this.isDisplayed = !this.isDisplayed;
    return this.save();
};

corporateMemberSchema.methods.updateDisplayOrder = function(newOrder) {
    this.displayOrder = newOrder;
    return this.save();
};

// 前置鉤子
corporateMemberSchema.pre('save', function(next) {
    if (this.services && Array.isArray(this.services)) {
        this.services = this.services.filter(service => service && service.trim());
    }
    if (this.specialization && Array.isArray(this.specialization)) {
        this.specialization = this.specialization.filter(spec => spec && spec.trim());
    }
    if (this.tags && Array.isArray(this.tags)) {
        this.tags = this.tags
            .filter(tag => tag && tag.trim())
            .map(tag => tag.trim().toLowerCase());
    }
    next();
});

const CorporateMember = mongoose.model('CorporateMember', corporateMemberSchema);

module.exports = CorporateMember;