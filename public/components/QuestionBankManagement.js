function questionBankTab() {
    return {
        questions: [],
        domains: [
            { id: 1, name: 'Security and Risk Management' },
            { id: 2, name: 'Asset Security' },
            { id: 3, name: 'Security Architecture and Engineering' },
            { id: 4, name: 'Communication and Network Security' },
            { id: 5, name: 'Identity and Access Management' },
            { id: 6, name: 'Security Assessment and Testing' },
            { id: 7, name: 'Security Operations' },
            { id: 8, name: 'Software Development Security' }
        ],
        selectedDomain: null,
        searchQuery: '',
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
        loading: false,

        showCreateModal: false,
        showEditModal: false,
        showImportModal: false,
        showQBankStatisticsModal: false,
        showGenerateExamModal: false,
        editingQuestion: null,
        selectedQuestions: [],
        selectedFile: null,

        formData: {
            type: 'multiple_choice',
            domain: 1,
            content: '',
            options: [
                { text: '', label: 'A' },
                { text: '', label: 'B' },
                { text: '', label: 'C' },
                { text: '', label: 'D' }
            ],
            correctOptionIndex: 0,
            correctBoolean: true,
            correctAnswers: [''],
            acceptableAnswers: [''],
            points: 1,
            difficulty: 'easy',
            explanation: ''
        },

        generateMode: 'manual',
        examTitle: '',
        questionsPerAttempt: 100,
        domainRatio: {},
        statistics: null,

        getToken() {
            return localStorage.getItem('adminToken') || '';
        },

        async init() {
            await this.loadQuestions();
        },

        async loadQuestions() {
            this.loading = true;
            try {
                const query = new URLSearchParams();
                if (this.selectedDomain) query.append('domain', this.selectedDomain);
                if (this.searchQuery) query.append('search', this.searchQuery);
                query.append('page', this.page);
                query.append('limit', this.limit);

                const res = await fetch(`/api/question-bank?${query}`, {
                    headers: { 'Authorization': `Bearer ${this.getToken()}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    this.questions = data.data || [];
                    this.total = data.pagination.total;
                    this.totalPages = data.pagination.totalPages;
                }
            } catch (e) {
                console.error('Load questions error:', e);
            } finally {
                this.loading = false;
            }
        },

        async createQuestion() {
            try {
                const res = await fetch('/api/question-bank', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.getToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(this.formData)
                });
                if (res.ok) {
                    this.showCreateModal = false;
                    await this.loadQuestions();
                }
            } catch (e) {
                console.error('Create error:', e);
            }
        },

        async updateQuestion(id) {
            try {
                const res = await fetch(`/api/question-bank/${id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${this.getToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(this.formData)
                });
                if (res.ok) {
                    this.showEditModal = false;
                    await this.loadQuestions();
                }
            } catch (e) {
                console.error('Update error:', e);
            }
        },

        editQuestion(q) {
            this.editingQuestion = q;
            this.formData = {
                type: q.type,
                domain: q.domain,
                content: q.content,
                options: q.options || [{ text: '', label: 'A' }, { text: '', label: 'B' }, { text: '', label: 'C' }, { text: '', label: 'D' }],
                correctOptionIndex: q.correctOptionIndex || 0,
                correctBoolean: q.correctBoolean !== undefined ? q.correctBoolean : true,
                correctAnswers: q.correctAnswers || [''],
                acceptableAnswers: q.acceptableAnswers || [''],
                points: q.points || 1,
                difficulty: q.difficulty || 'easy',
                explanation: q.explanation || ''
            };
            this.showEditModal = true;
        },

        async deleteQuestion(id) {
            if (!confirm('確定要刪除這個題目嗎？')) return;
            try {
                await fetch(`/api/question-bank/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.getToken()}` }
                });
                await this.loadQuestions();
            } catch (e) {
                console.error('Delete error:', e);
            }
        },

        closeModal() {
            this.showCreateModal = false;
            this.showEditModal = false;
            this.editingQuestion = null;
            this.formData = {
                type: 'multiple_choice',
                domain: 1,
                content: '',
                options: [
                    { text: '', label: 'A' },
                    { text: '', label: 'B' },
                    { text: '', label: 'C' },
                    { text: '', label: 'D' }
                ],
                correctOptionIndex: 0,
                correctBoolean: true,
                correctAnswers: [''],
                acceptableAnswers: [''],
                points: 1,
                difficulty: 'easy',
                explanation: ''
            };
        },

        handleFileUpload(event) {
            this.selectedFile = event.target.files[0];
        },

        async importCSV() {
            if (!this.selectedFile) return;
            const formData = new FormData();
            formData.append('file', this.selectedFile);

            try {
                const res = await fetch('/api/question-bank/import', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.getToken()}` },
                    body: formData
                });
                const data = await res.json();
                alert(`匯入成功 ${data.data.imported} 題，失敗 ${data.data.errors.length} 題`);
                this.showImportModal = false;
                await this.loadQuestions();
            } catch (e) {
                console.error('Import error:', e);
            }
        },

        async loadStatistics() {
            try {
                console.log('[DEBUG] Loading statistics...');
                const token = this.getToken();
                console.log('[DEBUG] Token present:', !!token);
                
                const res = await fetch('/api/question-bank/statistics', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                console.log('[DEBUG] Response status:', res.status);
                
                if (res.ok) {
                    const result = await res.json();
                    console.log('[DEBUG] Statistics data:', result);
                    this.statistics = result.data || result;
                    // Force Alpine.js to update by using $nextTick
                    const self = this;
                    setTimeout(() => {
                        self.showQBankStatisticsModal = true;
                        console.log('[DEBUG] showQBankStatisticsModal set to true after timeout');
                    }, 0);
                    // Also try immediate
                    this.showQBankStatisticsModal = true;
                    console.log('[DEBUG] Modal should be visible now');
                    console.log('[DEBUG] showQBankStatisticsModal set to true');
                } else {
                    const text = await res.text();
                    console.error('[DEBUG] Statistics API error:', res.status, text);
                    alert('统计加载失败：' + res.status + ' - ' + text.substring(0, 100));
                }
            } catch (e) {
                console.error('[DEBUG] Statistics error:', e);
                alert('统计加载出错：' + e.message);
            }
        },

        filterByDomain() {
            this.page = 1;
            this.loadQuestions();
        },

        search() {
            this.page = 1;
            this.loadQuestions();
        },

        prevPage() {
            if (this.page > 1) {
                this.page--;
                this.loadQuestions();
            }
        },

        nextPage() {
            if (this.page < this.totalPages) {
                this.page++;
                this.loadQuestions();
            }
        },

        toggleAll() {
            if (this.selectedQuestions.length === this.questions.length) {
                this.selectedQuestions = [];
            } else {
                this.selectedQuestions = this.questions.map(q => q._id);
            }
        },

        async generateExamByManual() {
            if (this.selectedQuestions.length === 0) {
                alert('請選擇至少一個題目');
                return;
            }
            try {
                const res = await fetch('/api/exams/from-bank', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.getToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        mode: 'manual',
                        title: this.examTitle || '從題庫生成的考試',
                        questionIds: this.selectedQuestions
                    })
                });
                if (res.ok) {
                    alert('考試生成成功');
                    this.showGenerateExamModal = false;
                    this.selectedQuestions = [];
                }
            } catch (e) {
                console.error('Generate exam error:', e);
            }
        },

        async generateExamByRandom() {
            if (!this.examTitle) {
                alert('請輸入考試標題');
                return;
            }
            try {
                const res = await fetch('/api/exams/from-bank', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.getToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        mode: 'random',
                        title: this.examTitle,
                        questionsPerAttempt: this.questionsPerAttempt,
                        domainRatio: this.domainRatio
                    })
                });
                if (res.ok) {
                    alert('考試生成成功');
                    this.showGenerateExamModal = false;
                }
            } catch (e) {
                console.error('Generate exam error:', e);
            }
        }
    };
}
