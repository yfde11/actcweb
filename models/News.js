const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    content: {
        type: String,
        required: [true, 'Content is required'],
        trim: true,
        maxlength: [5000, 'Content cannot exceed 5000 characters']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [500, 'Description cannot exceed 500 characters']
    },
    imageUrl: {
        type: String,
        trim: true,
        validate: {
            validator: function(v) {
                if (!v) return true; // 允許空值
                // 允許相對路徑（如 /uploads/images/xxx.jpg）或完整 URL
                const relativePathRegex = /^\/uploads\/images\/.+\.(jpg|jpeg|png|gif|webp)$/i;
                const fullUrlRegex = /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i;
                return relativePathRegex.test(v) || fullUrlRegex.test(v);
            },
            message: 'Image URL must be a valid image file path or URL'
        }
    },
    videoUrl: {
        type: String,
        trim: true,
        validate: {
            validator: function(v) {
                if (!v) return true;
                // 支持 YouTube 和 Instagram 連結
                const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/;
                const instagramRegex = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//;
                return youtubeRegex.test(v) || instagramRegex.test(v);
            },
            message: 'Video URL must be a valid YouTube or Instagram link'
        }
    },
    videoType: {
        type: String,
        enum: ['youtube', 'instagram', null],
        default: null
    },
    publishDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft'
    },
    viewCount: {
        type: Number,
        default: 0,
        min: 0
    },
    analyticsId: {
        type: String,
        trim: true,
        sparse: true
    },
    // 保留舊欄位以向後兼容
    date: {
        type: Date,
        default: Date.now
    },
    images: [{
        type: String,
        trim: true
    }],
    file: {
        type: String,
        trim: true
    },
    link: {
        type: String,
        trim: true
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    tags: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    featured: {
        type: Boolean,
        default: false
    },
    /** 發布時是否寄信：僅限已驗證 email；approved_members 再限縮為已核准會員 */
    notifyAudience: {
        type: String,
        enum: ['none', 'verified_users', 'approved_members'],
        default: 'none'
    }
}, {
    timestamps: true
});

// 索引優化
newsSchema.index({ publishDate: -1 });
newsSchema.index({ status: 1, publishDate: -1 });
newsSchema.index({ createdAt: -1 });
newsSchema.index({ featured: -1, publishDate: -1 });
newsSchema.index({ tags: 1 });
newsSchema.index({ viewCount: -1 });
newsSchema.index({ analyticsId: 1 }, { unique: true, sparse: true });

// Pre-save middleware 自動設置 videoType
newsSchema.pre('save', function(next) {
    if (this.videoUrl) {
        if (this.videoUrl.includes('youtube.com') || this.videoUrl.includes('youtu.be')) {
            this.videoType = 'youtube';
        } else if (this.videoUrl.includes('instagram.com')) {
            this.videoType = 'instagram';
        }
    } else {
        this.videoType = null;
    }
    
    // 生成唯一的 analytics ID
    if (!this.analyticsId) {
        this.analyticsId = `news_${this._id}_${Date.now()}`;
    }
    
    next();
});

// 虛擬字段：格式化發布日期
newsSchema.virtual('formattedPublishDate').get(function() {
    return this.publishDate.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
});

// 虛擬字段：摘要（如果沒有描述則從內容截取）
newsSchema.virtual('summary').get(function() {
    if (this.description) return this.description;
    if (this.content) return this.content.substring(0, 150) + '...';
    return '';
});

// 虛擬字段：YouTube 嵌入 ID
newsSchema.virtual('youtubeEmbedId').get(function() {
    if (this.videoType !== 'youtube' || !this.videoUrl) return null;
    
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = this.videoUrl.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
});

// 虛擬字段：檢查是否有媒體內容
newsSchema.virtual('hasMedia').get(function() {
    return !!(this.imageUrl || this.videoUrl || (this.images && this.images.length > 0));
});

// 虛擬字段：向後兼容
newsSchema.virtual('formattedDate').get(function() {
    return this.date?.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }) || this.formattedPublishDate;
});

newsSchema.virtual('hasAttachment').get(function() {
    return this.file || this.link || this.hasMedia;
});

// 靜態方法：獲取已發布的新聞
newsSchema.statics.getPublished = function(limit = 10, skip = 0) {
    return this.find({ status: 'published' })
        .sort({ publishDate: -1 })
        .limit(limit)
        .skip(skip)
        .populate('author', 'username fullName');
};

// 靜態方法：獲取精選新聞
newsSchema.statics.getFeatured = function(limit = 5) {
    return this.find({ status: 'published', featured: true })
        .sort({ publishDate: -1 })
        .limit(limit)
        .populate('author', 'username fullName');
};

// 實例方法：增加閱覽次數
newsSchema.methods.incrementViewCount = function() {
    this.viewCount += 1;
    return this.save();
};

// 確保虛擬字段在 JSON 中顯示
newsSchema.set('toJSON', { virtuals: true });
newsSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('News', newsSchema);
