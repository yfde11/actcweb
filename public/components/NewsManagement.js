/**
 * 新聞管理組件
 * 提供完整的CRUD功能和批量操作
 */
function newsTab() {
    return {
        newsList: [],
        selectedNews: [],
        searchTerm: '',
        statusFilter: 'all',
        sortBy: 'createdAt-desc',
        pagination: {
            page: 1,
            limit: 20,
            total: 0,
            pages: 0
        },
        stats: {},
        analyticsStatus: { enabled: false },
        isUpdatingAnalytics: false,
        
        // Modal 狀態
        showCreateModal: false,
        showEditModal: false,
        editingNews: null,
        
        // 表單數據
        newsForm: {
            title: '',
            content: '',
            description: '',
            imageUrl: '',
            videoUrl: '',
            publishDate: '',
            status: 'draft',
            tags: '',
            featured: false,
            file: ''
        },
        
        // 文件上傳
        imageFile: null,
        attachmentFile: null,
        imagePreview: '',
        
        // 搜尋防抖
        searchTimeout: null,
        newsDraftSaveTimer: null,
        newsDraftSaveState: '',
        newsDraftSaveMessage: '',
        newsDraftLastSavedPayload: '',

        async init() {
            window.addEventListener('beforeunload', (event) => {
                if (!this.newsDraftSaveTimer && !['pending', 'saving'].includes(this.newsDraftSaveState)) return;
                event.preventDefault();
                event.returnValue = '';
            });
            await this.loadNews();
            await this.loadAnalyticsStatus();
        },

        // 防抖搜尋
        get debouncedSearch() {
            return () => {
                clearTimeout(this.searchTimeout);
                this.searchTimeout = setTimeout(() => {
                    this.pagination.page = 1;
                    this.loadNews();
                }, 500);
            };
        },

        // 載入新聞列表
        async loadNews() {
            try {
                const params = new URLSearchParams({
                    page: this.pagination.page,
                    limit: this.pagination.limit,
                    sortBy: this.sortBy.split('-')[0],
                    order: this.sortBy.split('-')[1]
                });

                if (this.statusFilter !== 'all') {
                    params.append('status', this.statusFilter);
                }

                if (this.searchTerm) {
                    params.append('search', this.searchTerm);
                }

                const response = await fetch(`/api/news/admin?${params}`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    this.newsList = data.news;
                    this.pagination = data.pagination;
                    this.stats = data.stats || {};
                } else {
                    throw new Error('Failed to load news');
                }
            } catch (error) {
                console.error('Load news error:', error);
                this.showToast('載入新聞失敗', 'error');
            }
        },

        // 載入 Analytics 狀態
        async loadAnalyticsStatus() {
            try {
                const response = await fetch('/api/news/admin/analytics-status', {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    }
                });

                if (response.ok) {
                    this.analyticsStatus = await response.json();
                }
            } catch (error) {
                console.error('Load analytics status error:', error);
            }
        },

        // 更新 Analytics 數據
        async updateAnalytics() {
            this.isUpdatingAnalytics = true;
            try {
                const response = await fetch('/api/news/admin/update-analytics', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: JSON.stringify({ days: 7 })
                });

                if (response.ok) {
                    const result = await response.json();
                    this.showToast(`已更新 ${result.updatedCount || 0} 篇新聞的瀏覽數據`);
                    await this.loadNews();
                } else {
                    throw new Error('Failed to update analytics');
                }
            } catch (error) {
                console.error('Update analytics error:', error);
                this.showToast('更新 Analytics 數據失敗', 'error');
            } finally {
                this.isUpdatingAnalytics = false;
            }
        },

        // 分頁相關
        changePage(page) {
            if (page >= 1 && page <= this.pagination.pages && page !== this.pagination.page) {
                this.pagination.page = page;
                this.loadNews();
            }
        },

        getPageNumbers() {
            const pages = [];
            const current = this.pagination.page;
            const total = this.pagination.pages;
            
            // 顯示當前頁前後各2頁
            const start = Math.max(1, current - 2);
            const end = Math.min(total, current + 2);
            
            for (let i = start; i <= end; i++) {
                pages.push(i);
            }
            
            return pages;
        },

        // 選擇相關
        toggleSelect(event, newsId) {
            if (event.target.checked) {
                if (!this.selectedNews.includes(newsId)) {
                    this.selectedNews.push(newsId);
                }
            } else {
                this.selectedNews = this.selectedNews.filter(id => id !== newsId);
            }
        },

        toggleSelectAll(event) {
            if (event.target.checked) {
                this.selectedNews = this.newsList.map(news => news._id);
            } else {
                this.selectedNews = [];
            }
        },

        get isAllSelected() {
            return this.newsList.length > 0 && this.selectedNews.length === this.newsList.length;
        },

        // Modal 相關
        closeModal() {
            if (this.newsDraftSaveTimer) {
                clearTimeout(this.newsDraftSaveTimer);
                this.newsDraftSaveTimer = null;
            }
            this.showCreateModal = false;
            this.showEditModal = false;
            this.editingNews = null;
            this.newsDraftSaveState = '';
            this.newsDraftSaveMessage = '';
            this.newsDraftLastSavedPayload = '';
            this.resetForm();
        },

        resetForm() {
            this.newsForm = {
                title: '',
                content: '',
                description: '',
                imageUrl: '',
                videoUrl: '',
                publishDate: '',
                status: 'draft',
                tags: '',
                featured: false,
                file: ''
            };
            this.imageFile = null;
            this.attachmentFile = null;
            this.imagePreview = '';
        },

        // 檔案處理
        handleImageUpload(event) {
            const file = event.target.files[0];
            if (file) {
                this.imageFile = file;
                const reader = new FileReader();
                reader.onload = (e) => {
                    this.imagePreview = e.target.result;
                };
                reader.readAsDataURL(file);
            }
        },

        handleFileUpload(event) {
            const file = event.target.files[0];
            if (file) {
                this.attachmentFile = file;
            }
        },

        removeImage() {
            this.newsForm.imageUrl = '';
            this.imageFile = null;
            this.imagePreview = '';
        },

        buildNewsFormData(includeFiles = false) {
            const formData = new FormData();
            formData.append('title', this.newsForm.title);
            formData.append('content', this.newsForm.content);
            formData.append('description', this.newsForm.description || '');
            formData.append('videoUrl', this.newsForm.videoUrl || '');
            formData.append('publishDate', this.newsForm.publishDate || '');
            formData.append('status', this.newsForm.status);
            formData.append('tags', this.newsForm.tags || '');
            formData.append('featured', this.newsForm.featured);

            if (includeFiles) {
                if (this.imageFile) {
                    formData.append('image', this.imageFile);
                } else if (!this.newsForm.imageUrl && this.editingNews?.imageUrl) {
                    formData.append('removeImage', 'true');
                }
                if (this.attachmentFile) {
                    formData.append('file', this.attachmentFile);
                }
            }

            return formData;
        },

        newsDraftPayloadKey() {
            return JSON.stringify({
                title: this.newsForm.title,
                content: this.newsForm.content,
                description: this.newsForm.description || '',
                imageUrl: this.newsForm.imageUrl || '',
                videoUrl: this.newsForm.videoUrl || '',
                publishDate: this.newsForm.publishDate || '',
                status: this.newsForm.status,
                tags: this.newsForm.tags || '',
                featured: !!this.newsForm.featured,
                file: this.newsForm.file || ''
            });
        },

        newsDraftReady() {
            return Boolean(this.editingNews?._id && this.newsForm.title && this.newsForm.content);
        },

        newsDraftSaveText() {
            const texts = {
                pending: '待自動儲存',
                saving: '自動儲存中…',
                saved: '已自動儲存',
                error: this.newsDraftSaveMessage || '自動儲存失敗'
            };
            return texts[this.newsDraftSaveState] || '';
        },

        queueNewsDraftSave(event) {
            if (!this.showEditModal || !this.editingNews?._id) return;
            if (event?.target?.type === 'file') return;
            if (this.newsDraftSaveTimer) clearTimeout(this.newsDraftSaveTimer);
            this.newsDraftSaveState = 'pending';
            this.newsDraftSaveTimer = setTimeout(() => {
                this.newsDraftSaveTimer = null;
                this.saveNewsDraft();
            }, 900);
        },

        async saveNewsDraft() {
            if (!this.showEditModal || !this.newsDraftReady()) return;
            const payloadKey = this.newsDraftPayloadKey();
            if (payloadKey === this.newsDraftLastSavedPayload) {
                this.newsDraftSaveState = '';
                return;
            }
            this.newsDraftSaveState = 'saving';
            this.newsDraftSaveMessage = '';
            try {
                const response = await fetch(`/api/news/admin/${this.editingNews._id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: this.buildNewsFormData(false)
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.message || '自動儲存失敗');
                }
                this.newsDraftLastSavedPayload = this.newsDraftPayloadKey();
                this.newsDraftSaveState = 'saved';
                await this.loadNews();
            } catch (error) {
                console.error('Auto save news error:', error);
                this.newsDraftSaveMessage = error.message || '自動儲存失敗';
                this.newsDraftSaveState = 'error';
            }
        },

        // 創建新聞
        async createNews() {
            try {
                console.log('開始創建新聞');
                console.log('表單數據:', this.newsForm);
                
                const formData = new FormData();
                
                // 基本欄位
                formData.append('title', this.newsForm.title);
                formData.append('content', this.newsForm.content);
                formData.append('description', this.newsForm.description || '');
                formData.append('videoUrl', this.newsForm.videoUrl || '');
                formData.append('publishDate', this.newsForm.publishDate || '');
                formData.append('status', this.newsForm.status);
                formData.append('tags', this.newsForm.tags || '');
                formData.append('featured', this.newsForm.featured);

                // 檔案
                if (this.imageFile) {
                    console.log('上傳圖片:', this.imageFile.name);
                    formData.append('image', this.imageFile);
                }
                if (this.attachmentFile) {
                    console.log('上傳附件:', this.attachmentFile.name);
                    formData.append('file', this.attachmentFile);
                }

                console.log('發送創建請求');
                
                const response = await fetch('/api/news/admin', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: formData
                });

                console.log('創建響應狀態:', response.status);

                if (response.ok) {
                    const result = await response.json();
                    console.log('創建成功:', result);
                    this.showToast('新聞創建成功');
                    this.closeModal();
                    await this.loadNews();
                } else {
                    const errorText = await response.text();
                    console.error('創建響應錯誤:', response.status, errorText);
                    let errorData;
                    try {
                        errorData = JSON.parse(errorText);
                    } catch (e) {
                        errorData = { message: errorText };
                    }
                    throw new Error(errorData.message || `HTTP ${response.status}`);
                }
            } catch (error) {
                console.error('Create news error:', error);
                this.showToast('創建新聞失敗：' + error.message, 'error');
            }
        },

        // 編輯新聞
        editNews(news) {
            this.editingNews = news;
            this.newsForm = {
                title: news.title,
                content: news.content,
                description: news.description || '',
                imageUrl: news.imageUrl || '',
                videoUrl: news.videoUrl || '',
                publishDate: news.publishDate ? new Date(news.publishDate).toISOString().slice(0, 16) : '',
                status: news.status,
                tags: news.tags ? news.tags.join(', ') : '',
                featured: news.featured || false,
                file: news.file || ''
            };
            this.newsDraftLastSavedPayload = this.newsDraftPayloadKey();
            this.newsDraftSaveState = '';
            this.newsDraftSaveMessage = '';
            this.showEditModal = true;
        },

        // 更新新聞
        async updateNews() {
            try {
                console.log('開始更新新聞，ID:', this.editingNews._id);
                console.log('表單數據:', this.newsForm);
                
                console.log('發送請求到:', `/api/news/admin/${this.editingNews._id}`);
                
                const response = await fetch(`/api/news/admin/${this.editingNews._id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: this.buildNewsFormData(true)
                });

                console.log('響應狀態:', response.status);
                
                if (response.ok) {
                    const result = await response.json();
                    console.log('更新成功:', result);
                    this.showToast('新聞更新成功');
                    this.closeModal();
                    await this.loadNews();
                } else {
                    const errorText = await response.text();
                    console.error('響應錯誤:', response.status, errorText);
                    let errorData;
                    try {
                        errorData = JSON.parse(errorText);
                    } catch (e) {
                        errorData = { message: errorText };
                    }
                    throw new Error(errorData.message || `HTTP ${response.status}`);
                }
            } catch (error) {
                console.error('Update news error:', error);
                this.showToast('更新新聞失敗：' + error.message, 'error');
            }
        },

        // 切換狀態
        async toggleStatus(news) {
            const newStatus = news.status === 'published' ? 'draft' : 'published';
            
            try {
                const response = await fetch(`/api/news/admin/${news._id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: JSON.stringify({ status: newStatus })
                });

                if (response.ok) {
                    this.showToast(`新聞已${newStatus === 'published' ? '發布' : '設為草稿'}`);
                    await this.loadNews();
                } else {
                    throw new Error('Failed to update status');
                }
            } catch (error) {
                console.error('Toggle status error:', error);
                this.showToast('更新狀態失敗', 'error');
            }
        },

        // 刪除新聞
        async deleteNews(news) {
            if (!confirm(`確定要刪除新聞「${news.title}」嗎？此操作無法復原。`)) {
                return;
            }

            try {
                const response = await fetch(`/api/news/admin/${news._id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    }
                });

                if (response.ok) {
                    this.showToast('新聞已刪除');
                    await this.loadNews();
                } else {
                    throw new Error('Failed to delete news');
                }
            } catch (error) {
                console.error('Delete news error:', error);
                this.showToast('刪除新聞失敗', 'error');
            }
        },

        // 批量操作
        async batchPublish() {
            await this.batchOperation('updateStatus', { status: 'published' });
        },

        async batchDraft() {
            await this.batchOperation('updateStatus', { status: 'draft' });
        },

        async batchDelete() {
            if (!confirm(`確定要刪除選中的 ${this.selectedNews.length} 篇新聞嗎？此操作無法復原。`)) {
                return;
            }
            await this.batchOperation('delete');
        },

        async batchOperation(action, data = {}) {
            try {
                const response = await fetch('/api/news/admin/batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: JSON.stringify({
                        action,
                        ids: this.selectedNews,
                        data
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    this.showToast(`批量操作完成，影響 ${result.modifiedCount} 篇新聞`);
                    this.selectedNews = [];
                    await this.loadNews();
                } else {
                    throw new Error('Batch operation failed');
                }
            } catch (error) {
                console.error('Batch operation error:', error);
                this.showToast('批量操作失敗', 'error');
            }
        },

        // 工具方法
        formatDate(dateString) {
            if (!dateString) return '-';
            return new Date(dateString).toLocaleString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        },

        showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg text-white font-medium z-50 transform transition-all duration-300 translate-y-0 opacity-100 ${
                type === 'error' ? 'bg-red-500' : 'bg-green-500'
            }`;
            toast.textContent = message;
            
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.classList.add('translate-y-2', 'opacity-0');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }, 3000);
        }
    };
}
