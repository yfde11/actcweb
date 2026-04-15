const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    type: {
        type: String,
        required: [true, 'Event type is required'],
        enum: {
            values: ['meetup', 'workshop', 'course', 'conference', 'training', 'others'],
            message: 'Event type must be one of: meetup, workshop, course, conference, training, others'
        }
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        trim: true,
        maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    shortDescription: {
        type: String,
        trim: true,
        maxlength: [200, 'Short description cannot exceed 200 characters']
    },
    date: {
        type: Date,
        required: [true, 'Date is required']
    },
    endDate: {
        type: Date,
        validate: {
            validator: function(v) {
                if (!v) return true; // 允許空值
                return v >= this.date;
            },
            message: 'End date must be after or equal to start date'
        }
    },
    location: {
        type: String,
        required: [true, 'Location is required'],
        trim: true,
        maxlength: [200, 'Location cannot exceed 200 characters']
    },
    virtualLocation: {
        type: String,
        trim: true,
        maxlength: [200, 'Virtual location cannot exceed 200 characters']
    },
    link: {
        type: String,
        trim: true,
        validate: {
            validator: function(v) {
                if (!v) return true; // 允許空值
                return /^https?:\/\/.+/.test(v);
            },
            message: 'Link must be a valid URL'
        }
    },
    // 活動圖檔
    image: {
        type: String,
        trim: true,
        validate: {
            validator: function(v) {
                if (!v) return true; // 允許空值
                return /^\/uploads\/images\/.+/.test(v);
            },
            message: 'Image path must be a valid upload path'
        }
    },
    // 活動檔案（20MB以下）
    file: {
        path: {
            type: String,
            trim: true,
            validate: {
                validator: function(v) {
                    if (!v) return true; // 允許空值
                    return /^\/uploads\/files\/.+/.test(v);
                },
                message: 'File path must be a valid upload path'
            }
        },
        originalName: {
            type: String,
            trim: true,
            maxlength: [255, 'Original filename cannot exceed 255 characters']
        },
        size: {
            type: Number,
            min: [0, 'File size cannot be negative'],
            max: [20 * 1024 * 1024, 'File size cannot exceed 20MB'] // 20MB限制
        },
        mimeType: {
            type: String,
            trim: true
        }
    },
    // 增強的講師介紹
    instructor: {
        name: {
            type: String,
            trim: true,
            maxlength: [100, 'Instructor name cannot exceed 100 characters']
        },
        title: {
            type: String,
            trim: true,
            maxlength: [100, 'Instructor title cannot exceed 100 characters']
        },
        company: {
            type: String,
            trim: true,
            maxlength: [100, 'Company name cannot exceed 100 characters']
        },
        bio: {
            type: String,
            trim: true,
            maxlength: [500, 'Instructor bio cannot exceed 500 characters']
        },
        photo: {
            type: String,
            trim: true,
            validate: {
                validator: function(v) {
                    if (!v) return true; // 允許空值
                    return /^\/uploads\/images\/.+/.test(v);
                },
                message: 'Instructor photo path must be a valid upload path'
            }
        },
        expertise: [{
            type: String,
            trim: true,
            maxlength: [50, 'Expertise item cannot exceed 50 characters']
        }],
        socialLinks: {
            linkedin: {
                type: String,
                trim: true,
                validate: {
                    validator: function(v) {
                        if (!v) return true;
                        return /^https?:\/\/.+/.test(v);
                    },
                    message: 'LinkedIn URL must be a valid URL'
                }
            },
            twitter: {
                type: String,
                trim: true,
                validate: {
                    validator: function(v) {
                        if (!v) return true;
                        return /^https?:\/\/.+/.test(v);
                    },
                    message: 'Twitter URL must be a valid URL'
                }
            },
            website: {
                type: String,
                trim: true,
                validate: {
                    validator: function(v) {
                        if (!v) return true;
                        return /^https?:\/\/.+/.test(v);
                    },
                    message: 'Website URL must be a valid URL'
                }
            }
        }
    },
    duration: {
        hours: {
            type: Number,
            min: [0, 'Duration hours cannot be negative']
        },
        minutes: {
            type: Number,
            min: [0, 'Duration minutes cannot be negative'],
            max: [59, 'Duration minutes cannot exceed 59']
        }
    },
    capacity: {
        type: Number,
        min: [1, 'Capacity must be at least 1']
    },
    registeredCount: {
        type: Number,
        default: 0,
        min: [0, 'Registered count cannot be negative']
    },
    price: {
        amount: {
            type: Number,
            min: [0, 'Price cannot be negative']
        },
        currency: {
            type: String,
            default: 'TWD',
            enum: ['TWD', 'USD', 'EUR', 'JPY']
        },
        isFree: {
            type: Boolean,
            default: true
        }
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'registration_open', 'registration_closed', 'cancelled', 'completed'],
        default: 'draft'
    },
    tags: [{
        type: String,
        trim: true,
        maxlength: [50, 'Tag cannot exceed 50 characters']
    }],
    requirements: {
        type: String,
        trim: true,
        maxlength: [500, 'Requirements cannot exceed 500 characters']
    },
    materials: [{
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: [100, 'Material name cannot exceed 100 characters']
        },
        type: {
            type: String,
            enum: ['document', 'video', 'software', 'other'],
            default: 'document'
        },
        url: {
            type: String,
            trim: true
        },
        description: {
            type: String,
            trim: true,
            maxlength: [200, 'Material description cannot exceed 200 characters']
        }
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    notifyAudience: {
        type: String,
        enum: ['none', 'verified_users', 'approved_members'],
        default: 'none'
    },
    // 活動統計
    views: {
        type: Number,
        default: 0,
        min: [0, 'Views cannot be negative']
    },
    downloads: {
        type: Number,
        default: 0,
        min: [0, 'Downloads cannot be negative']
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// 索引優化
eventSchema.index({ date: -1 });
eventSchema.index({ type: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ tags: 1 });
eventSchema.index({ createdAt: -1 });
eventSchema.index({ 'instructor.name': 1 });

// 虛擬字段：格式化日期
eventSchema.virtual('formattedDate').get(function() {
    return this.date.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short'
    });
});

// 虛擬字段：格式化時間
eventSchema.virtual('formattedDateTime').get(function() {
    return this.date.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
});

// 虛擬字段：活動類型中文名稱
eventSchema.virtual('typeLabel').get(function() {
    const typeLabels = {
        'meetup': '聚會',
        'workshop': '工作坊',
        'course': '課程',
        'conference': '研討會',
        'training': '培訓',
        'others': '其他'
    };
    return typeLabels[this.type] || this.type;
});

// 虛擬字段：檢查是否有外部連結
eventSchema.virtual('hasLink').get(function() {
    return !!this.link;
});

// 虛擬字段：判斷連結類型
eventSchema.virtual('linkIcon').get(function() {
    if (!this.link) return null;
    
    const url = this.link.toLowerCase();
    if (url.includes('discord')) return 'fab fa-discord';
    if (url.includes('teams') || url.includes('microsoft')) return 'fab fa-microsoft';
    if (url.includes('zoom')) return 'fas fa-video';
    if (url.includes('meet.google')) return 'fab fa-google';
    return 'fas fa-external-link-alt';
});

// 虛擬字段：活動狀態中文名稱
eventSchema.virtual('statusLabel').get(function() {
    const statusLabels = {
        'draft': '草稿',
        'published': '已發布',
        'registration_open': '報名開放',
        'registration_closed': '報名截止',
        'cancelled': '已取消',
        'completed': '已完成'
    };
    return statusLabels[this.status] || this.status;
});

// 虛擬字段：是否仍有正式名額（無設名額時視為仍有名額）
eventSchema.virtual('canRegister').get(function() {
    return this.status === 'registration_open' &&
           (!this.capacity || this.registeredCount < this.capacity);
});

// 虛擬字段：已額滿且可排入候補（僅在有設定 capacity 時有意義）
eventSchema.virtual('canJoinWaitlist').get(function() {
    return this.status === 'registration_open' &&
        !!this.capacity &&
        this.registeredCount >= this.capacity;
});

// 虛擬字段：報名／候補入口是否開放（僅看狀態；實際表單分流用 canRegister / canJoinWaitlist）
eventSchema.virtual('canSubmitRegistration').get(function() {
    return this.status === 'registration_open';
});

// 虛擬字段：剩餘名額
eventSchema.virtual('remainingSpots').get(function() {
    if (!this.capacity) return null;
    return Math.max(0, this.capacity - this.registeredCount);
});

// 虛擬字段：格式化價格
eventSchema.virtual('formattedPrice').get(function() {
    if (this.price.isFree) return '免費';
    if (!this.price.amount) return '價格未定';
    
    const currencySymbols = {
        'TWD': 'NT$',
        'USD': '$',
        'EUR': '€',
        'JPY': '¥'
    };
    
    const symbol = currencySymbols[this.price.currency] || this.price.currency;
    return `${symbol}${this.price.amount}`;
});

// 虛擬字段：格式化時長
eventSchema.virtual('formattedDuration').get(function() {
    if (!this.duration) return '';
    
    let result = '';
    if (this.duration.hours > 0) {
        result += `${this.duration.hours}小時`;
    }
    if (this.duration.minutes > 0) {
        result += `${this.duration.minutes}分鐘`;
    }
    
    return result || '時長未定';
});

// 虛擬字段：檢查是否有檔案
eventSchema.virtual('hasFile').get(function() {
    return !!(this.file && this.file.path);
});

// 虛擬字段：檢查是否有圖片
eventSchema.virtual('hasImage').get(function() {
    return !!(this.image || (this.instructor && this.instructor.photo));
});

// 虛擬字段：檔案大小格式化
eventSchema.virtual('formattedFileSize').get(function() {
    if (!this.file || !this.file.size) return '';
    
    const bytes = this.file.size;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

// 確保虛擬字段在 JSON 中顯示
eventSchema.set('toJSON', { virtuals: true });
eventSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Event', eventSchema);
