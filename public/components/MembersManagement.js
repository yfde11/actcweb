/**
 * 會員管理 (MembersManagement)
 * Phase 1：UI/UX + Mock 互動
 *
 * 邏輯切片（與 admin.html 內 HTML 註解段落對應）：
 *   - MemberDashboardPage：頂層容器與 Header
 *   - MemberSummaryCards：4 張統計卡
 *   - MemberFilterBar：搜尋、快速篩選、日期、排序
 *   - MemberTable：會員列表 + 分頁
 *   - MemberInsightPanel：右側三張小卡
 *   - MemberBatchActionBar：批次選取後 sticky 工具列
 *   - MemberStatusBadge：badgeClass() helper 集中呈現
 *   - MemberActionMenu：每列「更多」 dropdown
 *
 * 後端對接點皆以 `// TODO: API` 標示，Phase 1 沿用既有 /api/users 與 /api/membership/admin/*。
 */
function usersTab() {
    return {
        // ---------- MemberDashboardPage / 資料源 ----------
        rawUsers: [],
        loading: false,
        loadError: '',

        // ---------- MemberFilterBar ----------
        searchTerm: '',
        activeFilter: 'all', // all / pending / new7d / active / attention / admin / disabled
        dateRange: 'all', // all / 7d / 30d / 90d / thisMonth / lastMonth / custom
        customStart: '',
        customEnd: '',
        sortKey: 'lastLogin', // lastLogin / joined / activity / pendingFirst / dormantFirst
        sortDir: 'desc',

        // ---------- MemberTable ----------
        page: 1,
        pageSize: 20,
        selectedMemberIds: [],
        starredOverrides: {}, // memberId -> bool（Phase1 暫存於記憶體；TODO: API 持久化）

        // ---------- 操作 dropdown / Modal 狀態 ----------
        actionMenuOpenId: null,
        showCreateModal: false,
        showEditModal: false,
        editingUser: null,
        userForm: {
            username: '',
            email: '',
            fullName: '',
            role: 'user',
            membershipStatus: 'none'
        },
        userFormSnapshot: '',

        // 操作回饋
        toastMsg: '',
        toastType: 'info', // info / success / error
        toastTimer: null,

        // ---------- 生命週期 ----------
        async init() {
            await this.loadUsers();
            window.addEventListener('beforeunload', (event) => {
                const formDirty =
                    (this.showCreateModal || this.showEditModal) &&
                    JSON.stringify(this.userForm) !== this.userFormSnapshot;
                if (this.selectedMemberIds.length === 0 && !formDirty) return;
                event.preventDefault();
                event.returnValue = '';
            });
        },

        async loadUsers() {
            this.loading = true;
            this.loadError = '';
            try {
                // TODO: API GET /api/admin/members?search=&filter=&dateRange=&sort=&page=
                // 暫沿用既有 /api/users，改為伺服器端分頁/篩選後可改寫
                const response = await fetch('/api/users', {
                    headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
                });
                if (!response.ok) throw new Error('載入失敗');
                const data = await response.json();
                this.rawUsers = Array.isArray(data.users) ? data.users : [];
            } catch (error) {
                console.error('Load users failed:', error);
                this.loadError = error.message || '載入失敗';
                this.rawUsers = [];
            } finally {
                this.loading = false;
            }
        },

        // ---------- enrichMembers / derive 規則 ----------
        get members() {
            return this.rawUsers.map((u) => this.enrichMember(u));
        },

        enrichMember(u) {
            const now = Date.now();
            const lastLoginAt = u.lastLogin ? new Date(u.lastLogin) : null;
            const joinedAt = u.createdAt ? new Date(u.createdAt) : null;
            const reference = lastLoginAt || joinedAt;
            const inactiveDays = reference
                ? Math.max(0, Math.floor((now - reference.getTime()) / 86400000))
                : 999;

            const isAdmin = u.role === 'admin';

            // 目前 User schema 無公司欄位；個人會員一律不顯示公司
            // TODO: model field（若日後新增 user.company 再啟用）
            const company = '';

            // mock tags：依 hash 從固定池抽 0~2 個
            const tags = this.mockTags(u._id || u.username || '');

            // mock 30 天登入次數（用於區分 high / medium）
            const mockLoginCount30d = inactiveDays >= 30 ? 0 : this.mockHash(u._id || '') % 8;

            let activityLevel;
            if (inactiveDays >= 60) activityLevel = 'dormant';
            else if (inactiveDays >= 30) activityLevel = 'low';
            else if (mockLoginCount30d >= 5) activityLevel = 'high';
            else activityLevel = 'medium';

            // User schema 僅有 admin / user；不在此處派生「企業會員」
            // 企業會員另由 /admin → 企業會員管理 (CorporateMember collection) 維護
            const memberType = isAdmin ? 'admin' : 'individual';

            const reviewStatus = u.membershipStatus || 'none';
            const accountStatus = u.isActive === false ? 'disabled' : 'active';

            const pendingDays = u.membershipAppliedAt
                ? Math.floor((now - new Date(u.membershipAppliedAt).getTime()) / 86400000)
                : 0;

            const autoNeedsAttention =
                inactiveDays >= 60 ||
                (reviewStatus === 'pending' && pendingDays >= 3) ||
                u.emailVerified === false ||
                false; // hasUnpaidRegistration: TODO: API 由後端提供

            const overrideId = String(u._id || '');
            const starredOverride =
                Object.prototype.hasOwnProperty.call(this.starredOverrides, overrideId)
                    ? this.starredOverrides[overrideId]
                    : null;

            const needsAttention =
                starredOverride !== null ? starredOverride : autoNeedsAttention;

            const displayName = u.fullName || u.username || '—';
            const nickname = ''; // TODO: model field

            // 次名稱：僅當 username 與顯示名不同時才顯示，避免重複
            const subline = nickname || (displayName !== u.username ? u.username : '');

            return {
                id: u._id,
                _id: u._id,
                raw: u,
                username: u.username,
                name: displayName,
                displayName,
                nickname,
                subline,
                email: u.email || '',
                phone: u.phone || '',
                role: u.role,
                memberType,
                company,
                tags,
                avatarUrl: '', // TODO: model field
                reviewStatus,
                accountStatus,
                isActive: u.isActive !== false,
                emailVerified: u.emailVerified === true,
                activityLevel,
                inactiveDays,
                lastLoginAt,
                joinedAt,
                membershipAppliedAt: u.membershipAppliedAt
                    ? new Date(u.membershipAppliedAt)
                    : null,
                pendingDays,
                needsAttention,
                autoNeedsAttention
            };
        },

        mockHash(s) {
            const str = String(s || '');
            let h = 0;
            for (let i = 0; i < str.length; i += 1) {
                h = (h * 31 + str.charCodeAt(i)) >>> 0;
            }
            return h;
        },

        mockTags(seed) {
            const pool = ['VIP', 'AI 組', '永續組', '新會員', '講師', '志工'];
            const h = this.mockHash(seed);
            const count = h % 3; // 0~2
            const tags = [];
            for (let i = 0; i < count; i += 1) {
                const idx = (h + i * 7) % pool.length;
                if (!tags.includes(pool[idx])) tags.push(pool[idx]);
            }
            return tags;
        },

        // ---------- 衍生統計 (MemberSummaryCards) ----------
        get totalCount() {
            return this.members.length;
        },

        get pendingCount() {
            return this.members.filter((m) => m.reviewStatus === 'pending').length;
        },

        get activeRecentCount() {
            return this.members.filter((m) => m.inactiveDays <= 30 && m.lastLoginAt).length;
        },

        get attentionCount() {
            return this.members.filter((m) => m.needsAttention).length;
        },

        get monthOverMonthGrowth() {
            // mock：近 30 天加入 / 前 30 天加入
            const now = Date.now();
            const day30 = 30 * 86400000;
            const recent = this.members.filter(
                (m) => m.joinedAt && now - m.joinedAt.getTime() <= day30
            ).length;
            const previous = this.members.filter(
                (m) =>
                    m.joinedAt &&
                    now - m.joinedAt.getTime() > day30 &&
                    now - m.joinedAt.getTime() <= 2 * day30
            ).length;
            if (previous === 0) return recent > 0 ? 100 : 0;
            return Math.round(((recent - previous) / previous) * 1000) / 10;
        },

        get pendingDelta() {
            // mock：相對於 7 天前的差異（以 createdAt 簡化）
            return this.pendingCount; // Phase1 直接顯示等待數量
        },

        // ---------- 篩選與排序 ----------
        memberMatchesFilter(m, filter) {
            switch (filter) {
                case 'all':
                    return true;
                case 'pending':
                    return m.reviewStatus === 'pending';
                case 'new7d':
                    return m.joinedAt && (Date.now() - m.joinedAt.getTime()) <= 7 * 86400000;
                case 'active':
                    return m.activityLevel === 'high' || m.activityLevel === 'medium';
                case 'attention':
                    return m.needsAttention;
                case 'admin':
                    return m.memberType === 'admin';
                case 'disabled':
                    return m.accountStatus === 'disabled';
                default:
                    return true;
            }
        },

        filterCount(filter) {
            return this.members.filter((m) => this.memberMatchesFilter(m, filter)).length;
        },

        memberMatchesSearch(m, term) {
            if (!term) return true;
            const t = term.toLowerCase();
            const fields = [
                m.name,
                m.displayName,
                m.nickname,
                m.username,
                m.email,
                ...(m.tags || [])
            ];
            return fields.some((v) => v && String(v).toLowerCase().includes(t));
        },

        memberMatchesDate(m) {
            if (this.dateRange === 'all') return true;
            if (!m.joinedAt) return this.dateRange === 'all';
            const now = new Date();
            let start = null;
            let end = null;
            switch (this.dateRange) {
                case '7d':
                    start = new Date(now);
                    start.setDate(now.getDate() - 7);
                    break;
                case '30d':
                    start = new Date(now);
                    start.setDate(now.getDate() - 30);
                    break;
                case '90d':
                    start = new Date(now);
                    start.setDate(now.getDate() - 90);
                    break;
                case 'thisMonth':
                    start = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                case 'lastMonth':
                    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    end = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                case 'custom':
                    start = this.customStart ? new Date(this.customStart) : null;
                    end = this.customEnd ? new Date(this.customEnd) : null;
                    if (end) end.setDate(end.getDate() + 1); // 包含當日
                    break;
                default:
                    return true;
            }
            if (start && m.joinedAt < start) return false;
            if (end && m.joinedAt >= end) return false;
            return true;
        },

        get filteredMembers() {
            const term = this.searchTerm.trim();
            return this.members.filter(
                (m) =>
                    this.memberMatchesFilter(m, this.activeFilter) &&
                    this.memberMatchesSearch(m, term) &&
                    this.memberMatchesDate(m)
            );
        },

        get sortedMembers() {
            const arr = [...this.filteredMembers];
            const dir = this.sortDir === 'asc' ? 1 : -1;
            const valueOf = (m) => {
                switch (this.sortKey) {
                    case 'lastLogin':
                        return m.lastLoginAt ? m.lastLoginAt.getTime() : 0;
                    case 'joined':
                        return m.joinedAt ? m.joinedAt.getTime() : 0;
                    case 'activity':
                        return { high: 4, medium: 3, low: 2, dormant: 1 }[m.activityLevel] || 0;
                    case 'pendingFirst':
                        return (m.reviewStatus === 'pending' ? 1 : 0) * 1e15 + (m.pendingDays || 0);
                    case 'dormantFirst':
                        return m.inactiveDays;
                    default:
                        return 0;
                }
            };
            arr.sort((a, b) => {
                const va = valueOf(a);
                const vb = valueOf(b);
                if (va < vb) return -1 * dir;
                if (va > vb) return 1 * dir;
                return 0;
            });
            return arr;
        },

        get totalPages() {
            return Math.max(1, Math.ceil(this.sortedMembers.length / this.pageSize));
        },

        get paginatedMembers() {
            if (this.page > this.totalPages) this.page = this.totalPages;
            const start = (this.page - 1) * this.pageSize;
            return this.sortedMembers.slice(start, start + this.pageSize);
        },

        goToPage(p) {
            if (p < 1 || p > this.totalPages) return;
            this.page = p;
        },

        get pageNumbers() {
            const total = this.totalPages;
            const cur = this.page;
            const pages = [];
            const push = (n) => {
                if (!pages.includes(n)) pages.push(n);
            };
            push(1);
            for (let i = cur - 1; i <= cur + 1; i += 1) {
                if (i > 1 && i < total) push(i);
            }
            if (total > 1) push(total);
            return pages.sort((a, b) => a - b);
        },

        setSort(key) {
            if (this.sortKey === key) {
                this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortKey = key;
                this.sortDir = 'desc';
            }
            this.page = 1;
        },

        setFilter(key) {
            this.activeFilter = key;
            this.page = 1;
            this.selectedMemberIds = [];
        },

        setDateRange(key) {
            this.dateRange = key;
            this.page = 1;
        },

        clearFilters() {
            this.searchTerm = '';
            this.activeFilter = 'all';
            this.dateRange = 'all';
            this.customStart = '';
            this.customEnd = '';
            this.sortKey = 'lastLogin';
            this.sortDir = 'desc';
            this.page = 1;
        },

        // ---------- MemberInsightPanel ----------
        get insightLatestJoined() {
            return [...this.members]
                .filter((m) => m.joinedAt)
                .sort((a, b) => b.joinedAt - a.joinedAt)
                .slice(0, 5);
        },

        get insightDormant() {
            return [...this.members]
                .filter((m) => m.inactiveDays >= 30)
                .sort((a, b) => b.inactiveDays - a.inactiveDays)
                .slice(0, 5);
        },

        get insightPendingPriority() {
            return [...this.members]
                .filter((m) => m.reviewStatus === 'pending')
                .sort((a, b) => b.pendingDays - a.pendingDays)
                .slice(0, 5);
        },

        focusInsight(kind) {
            // 從 Insight Panel 點擊「查看全部」的跳轉
            switch (kind) {
                case 'latest':
                    this.activeFilter = 'all';
                    this.sortKey = 'joined';
                    this.sortDir = 'desc';
                    break;
                case 'dormant':
                    this.activeFilter = 'attention';
                    this.sortKey = 'dormantFirst';
                    this.sortDir = 'desc';
                    break;
                case 'pending':
                    this.activeFilter = 'pending';
                    this.sortKey = 'pendingFirst';
                    this.sortDir = 'desc';
                    break;
                default:
                    break;
            }
            this.page = 1;
            this.$nextTick(() => {
                const el = document.getElementById('memberTableSection');
                if (el && typeof el.scrollIntoView === 'function') {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        },

        // ---------- 批次選取 (MemberBatchActionBar) ----------
        get currentPageIds() {
            return this.paginatedMembers.map((m) => m.id);
        },

        get isAllOnPageSelected() {
            const ids = this.currentPageIds;
            if (ids.length === 0) return false;
            return ids.every((id) => this.selectedMemberIds.includes(id));
        },

        toggleSelectAllOnPage() {
            const ids = this.currentPageIds;
            if (this.isAllOnPageSelected) {
                this.selectedMemberIds = this.selectedMemberIds.filter(
                    (id) => !ids.includes(id)
                );
            } else {
                const set = new Set([...this.selectedMemberIds, ...ids]);
                this.selectedMemberIds = Array.from(set);
            }
        },

        toggleSelect(id) {
            if (this.selectedMemberIds.includes(id)) {
                this.selectedMemberIds = this.selectedMemberIds.filter((x) => x !== id);
            } else {
                this.selectedMemberIds = [...this.selectedMemberIds, id];
            }
        },

        clearSelection() {
            this.selectedMemberIds = [];
        },

        async batchAction(kind) {
            if (this.selectedMemberIds.length === 0) return;
            const count = this.selectedMemberIds.length;
            switch (kind) {
                case 'approve': {
                    // TODO: API POST /api/admin/members/batch/approve
                    // Phase1 暫時逐筆呼叫既有 /api/membership/admin/:id 通過審核
                    let ok = 0;
                    let fail = 0;
                    for (const id of this.selectedMemberIds) {
                        const member = this.members.find((m) => m.id === id);
                        if (!member || member.reviewStatus !== 'pending') continue;
                        try {
                            const r = await fetch(`/api/membership/admin/${id}`, {
                                method: 'PATCH',
                                headers: {
                                    Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ action: 'approve', note: '' })
                            });
                            if (r.ok) ok += 1;
                            else fail += 1;
                        } catch (e) {
                            fail += 1;
                        }
                    }
                    await this.loadUsers();
                    this.showToast(`批次通過：成功 ${ok} 筆，失敗 ${fail} 筆`, fail ? 'error' : 'success');
                    break;
                }
                case 'deactivate': {
                    // TODO: API POST /api/admin/members/batch/deactivate
                    let ok = 0;
                    let fail = 0;
                    for (const id of this.selectedMemberIds) {
                        const member = this.members.find((m) => m.id === id);
                        if (!member || member.accountStatus === 'disabled') continue;
                        try {
                            const r = await fetch(`/api/users/${id}/toggle-status`, {
                                method: 'PATCH',
                                headers: {
                                    Authorization: `Bearer ${localStorage.getItem('adminToken')}`
                                }
                            });
                            if (r.ok) ok += 1;
                            else fail += 1;
                        } catch (e) {
                            fail += 1;
                        }
                    }
                    await this.loadUsers();
                    this.showToast(`批次停用：成功 ${ok} 筆，失敗 ${fail} 筆`, fail ? 'error' : 'success');
                    break;
                }
                case 'notify':
                    // TODO: API POST /api/admin/members/batch/notify
                    this.showToast(`Mock：將寄送通知信給 ${count} 位會員`, 'info');
                    break;
                case 'tag':
                    // TODO: API POST /api/admin/members/batch/tag
                    this.showToast(`Mock：將為 ${count} 位會員加標籤`, 'info');
                    break;
                case 'export':
                    this.exportSelectedAsCsv();
                    break;
                default:
                    break;
            }
            this.selectedMemberIds = [];
        },

        // ---------- 關注星號 ----------
        toggleStar(member) {
            // TODO: API PATCH /api/admin/members/:id { starred }
            const id = String(member.id);
            const next = !member.needsAttention;
            this.starredOverrides = { ...this.starredOverrides, [id]: next };
        },

        // ---------- 列操作 ----------
        toggleActionMenu(id) {
            this.actionMenuOpenId = this.actionMenuOpenId === id ? null : id;
        },

        closeActionMenu() {
            this.actionMenuOpenId = null;
        },

        viewMember(member) {
            // Phase1：以 alert 顯示資訊；後續可改打 Modal
            const lines = [
                `帳號：${member.username}`,
                `Email：${member.email || '-'}`,
                `會員類型：${this.memberTypeLabel(member.memberType)}`,
                `審核狀態：${this.reviewStatusLabel(member.reviewStatus)}`,
                `帳號狀態：${member.accountStatus === 'active' ? '啟用' : '停用'}`,
                `活躍度：${this.activityLabel(member.activityLevel)}`,
                `最後登入：${this.formatDateTime(member.lastLoginAt)}`,
                `加入時間：${this.formatDateTime(member.joinedAt)}`
            ];
            alert(lines.join('\n'));
            this.closeActionMenu();
        },

        editMember(member) {
            this.editingUser = member.raw;
            this.userForm = {
                username: member.username,
                email: member.email,
                fullName: member.raw.fullName || '',
                role: member.role,
                membershipStatus: member.reviewStatus
            };
            this.userFormSnapshot = JSON.stringify(this.userForm);
            this.showEditModal = true;
            this.closeActionMenu();
        },

        async createUser() {
            try {
                const response = await fetch('/api/users', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: JSON.stringify(this.userForm)
                });
                const data = await response.json();
                if (response.ok) {
                    await this.loadUsers();
                    this.closeModal();
                    this.showToast('會員已建立，預設密碼：user', 'success');
                } else {
                    this.showToast('建立失敗：' + (data.message || ''), 'error');
                }
            } catch (error) {
                this.showToast('建立錯誤：' + error.message, 'error');
            }
        },

        async updateUser() {
            try {
                const payload = {
                    username: this.userForm.username,
                    email: this.userForm.email,
                    fullName: this.userForm.fullName,
                    role: this.userForm.role
                };
                if (this.editingUser && this.editingUser.role === 'user') {
                    payload.membershipStatus = this.userForm.membershipStatus;
                }
                const response = await fetch(`/api/users/${this.editingUser._id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${localStorage.getItem('adminToken')}`
                    },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (response.ok) {
                    await this.loadUsers();
                    this.closeModal();
                    this.showToast('會員資料已更新', 'success');
                } else {
                    this.showToast('更新失敗：' + (data.message || ''), 'error');
                }
            } catch (error) {
                this.showToast('更新錯誤：' + error.message, 'error');
            }
        },

        async resetPassword(member) {
            if (!confirm(`確定重設「${member.name}」的密碼為 "user" 嗎？`)) return;
            try {
                const r = await fetch(`/api/users/${member.id}/reset-password`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
                });
                if (r.ok) this.showToast('密碼已重設為 "user"', 'success');
                else this.showToast('重設失敗', 'error');
            } catch (e) {
                this.showToast('重設失敗：' + e.message, 'error');
            }
            this.closeActionMenu();
        },

        async toggleMemberStatus(member) {
            const action = member.accountStatus === 'active' ? '停用' : '啟用';
            if (!confirm(`確定要${action}「${member.name}」嗎？`)) return;
            try {
                const r = await fetch(`/api/users/${member.id}/toggle-status`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
                });
                if (r.ok) {
                    await this.loadUsers();
                    this.showToast(`已${action}會員`, 'success');
                } else {
                    this.showToast(`${action}失敗`, 'error');
                }
            } catch (e) {
                this.showToast(`${action}失敗：${e.message}`, 'error');
            }
            this.closeActionMenu();
        },

        async deleteMember(member) {
            if (!confirm(`確定要刪除會員「${member.name}」？此操作無法復原！`)) return;
            try {
                const r = await fetch(`/api/users/${member.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
                });
                if (r.ok) {
                    await this.loadUsers();
                    this.showToast('會員已刪除', 'success');
                } else {
                    this.showToast('刪除失敗', 'error');
                }
            } catch (e) {
                this.showToast('刪除失敗：' + e.message, 'error');
            }
            this.closeActionMenu();
        },

        async approveMember(member) {
            // 透過會員審核 API 通過
            try {
                const r = await fetch(`/api/membership/admin/${member.id}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ action: 'approve', note: '' })
                });
                if (r.ok) {
                    await this.loadUsers();
                    this.showToast('已通過審核', 'success');
                } else {
                    this.showToast('通過失敗', 'error');
                }
            } catch (e) {
                this.showToast('通過失敗：' + e.message, 'error');
            }
            this.closeActionMenu();
        },

        sendReminder(member) {
            // TODO: API POST /api/admin/members/:id/reminder
            this.showToast(`Mock：已寄送提醒信給 ${member.email || member.name}`, 'info');
            this.closeActionMenu();
        },

        // ---------- 新增 / 匯出 ----------
        openCreateModal() {
            this.editingUser = null;
            this.userForm = {
                username: '',
                email: '',
                fullName: '',
                role: 'user',
                membershipStatus: 'none'
            };
            this.userFormSnapshot = JSON.stringify(this.userForm);
            this.showCreateModal = true;
        },

        closeModal() {
            this.showCreateModal = false;
            this.showEditModal = false;
            this.editingUser = null;
            this.userForm = {
                username: '',
                email: '',
                fullName: '',
                role: 'user',
                membershipStatus: 'none'
            };
            this.userFormSnapshot = '';
        },

        exportFilteredAsCsv() {
            this.downloadCsv(this.sortedMembers, 'members-filtered');
        },

        exportSelectedAsCsv() {
            const selected = this.members.filter((m) =>
                this.selectedMemberIds.includes(m.id)
            );
            this.downloadCsv(selected, 'members-selected');
        },

        downloadCsv(rows, fileNameBase) {
            // TODO: API POST /api/admin/members/export（後端非同步匯出 + 寄送下載連結）
            const headers = [
                '帳號',
                '姓名',
                'Email',
                '會員類型',
                '審核狀態',
                '帳號狀態',
                '活躍度',
                '最後登入',
                '加入時間',
                '標籤'
            ];
            const escape = (v) => {
                const s = v == null ? '' : String(v);
                if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
                return s;
            };
            const lines = [headers.join(',')];
            rows.forEach((m) => {
                lines.push(
                    [
                        m.username,
                        m.name,
                        m.email,
                        this.memberTypeLabel(m.memberType),
                        this.reviewStatusLabel(m.reviewStatus),
                        m.accountStatus === 'active' ? '啟用' : '停用',
                        this.activityLabel(m.activityLevel),
                        this.formatDateTime(m.lastLoginAt),
                        this.formatDateTime(m.joinedAt),
                        (m.tags || []).join('|')
                    ]
                        .map(escape)
                        .join(',')
                );
            });
            const csv = '\ufeff' + lines.join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ts = new Date().toISOString().slice(0, 10);
            a.download = `${fileNameBase}-${ts}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast(`已匯出 ${rows.length} 筆會員資料`, 'success');
        },

        // ---------- Toast ----------
        showToast(msg, type = 'info') {
            this.toastMsg = msg;
            this.toastType = type;
            if (this.toastTimer) clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => {
                this.toastMsg = '';
            }, 3500);
        },

        // ---------- Helpers / Labels (MemberStatusBadge) ----------
        avatarText(member) {
            const src = member.name || member.username || '?';
            return src.trim().charAt(0).toUpperCase();
        },

        avatarColor(member) {
            const palette = [
                'bg-blue-100 text-blue-700',
                'bg-emerald-100 text-emerald-700',
                'bg-amber-100 text-amber-700',
                'bg-purple-100 text-purple-700',
                'bg-rose-100 text-rose-700',
                'bg-cyan-100 text-cyan-700',
                'bg-indigo-100 text-indigo-700'
            ];
            return palette[this.mockHash(member.id || member.username || '') % palette.length];
        },

        memberTypeLabel(t) {
            return { admin: '管理員', individual: '一般會員' }[t] || '一般會員';
        },

        memberTypeBadgeClass(t) {
            const map = {
                admin: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
                individual: 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
            };
            return (map[t] || map.individual) + ' rounded-full px-2 py-0.5 text-xs font-medium';
        },

        reviewStatusLabel(s) {
            return {
                none: '一般',
                pending: '審核中',
                approved: '已通過',
                rejected: '已拒絕',
                supplement: '需補件'
            }[s] || '一般';
        },

        reviewStatusBadgeClass(s) {
            const map = {
                none: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200',
                pending: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
                approved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
                rejected: 'bg-red-50 text-red-700 ring-1 ring-red-200',
                supplement: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
            };
            return (map[s] || map.none) + ' rounded-full px-2 py-0.5 text-xs font-medium';
        },

        accountStatusBadgeClass(s) {
            return s === 'active'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 rounded-full px-2 py-0.5 text-xs font-medium'
                : 'bg-red-50 text-red-700 ring-1 ring-red-200 rounded-full px-2 py-0.5 text-xs font-medium';
        },

        activityLabel(a) {
            return { high: '高活躍', medium: '中等', low: '低活躍', dormant: '久未登入' }[a] || '—';
        },

        activityBadgeClass(a) {
            const map = {
                high: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
                medium: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
                low: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
                dormant: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
            };
            return (map[a] || map.dormant) + ' rounded-full px-2 py-0.5 text-xs font-medium';
        },

        formatDateTime(d) {
            if (!d) return '—';
            const dt = d instanceof Date ? d : new Date(d);
            if (isNaN(dt.getTime())) return '—';
            const pad = (n) => String(n).padStart(2, '0');
            return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        },

        formatDate(d) {
            if (!d) return '—';
            const dt = d instanceof Date ? d : new Date(d);
            if (isNaN(dt.getTime())) return '—';
            const pad = (n) => String(n).padStart(2, '0');
            return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        },

        sortIcon(key) {
            if (this.sortKey !== key) return '';
            return this.sortDir === 'asc' ? '▲' : '▼';
        }
    };
}
