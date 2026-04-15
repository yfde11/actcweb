/**
 * 全站會員導覽：桌面下拉、手機摺疊，依 localStorage.memberToken 切換訪客／已登入。
 * 登出時會觸發 window「actc-member-logout」（供會員專區等頁同步狀態）。
 */
(function () {
    function memberTokenPresent() {
        return !!localStorage.getItem('memberToken');
    }

    function setDesktopMemberMenuOpen(open) {
        const dd = document.getElementById('desktopMemberDropdown');
        const btn = document.getElementById('desktopMemberMenuBtn');
        if (!dd || !btn) return;
        dd.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function updateMemberNav() {
        const authed = memberTokenPresent();
        const desktopHint = document.getElementById('desktopMemberHint');
        const mobileHint = document.getElementById('mobileMemberHint');
        if (desktopHint) {
            desktopHint.textContent = authed ? '會員管理' : '請先登入或註冊';
        }
        if (mobileHint) {
            mobileHint.textContent = authed ? '會員管理' : '請先登入或註冊';
        }
        const dg = document.getElementById('desktopMemberLinksGuest');
        const da = document.getElementById('desktopMemberLinksAuthed');
        const mg = document.getElementById('mobileMemberGuest');
        const ma = document.getElementById('mobileMemberAuthed');
        if (dg && da) {
            dg.classList.toggle('hidden', authed);
            da.classList.toggle('hidden', !authed);
        }
        if (mg && ma) {
            mg.classList.toggle('hidden', authed);
            ma.classList.toggle('hidden', !authed);
        }
        setDesktopMemberMenuOpen(false);
    }

    /** 供會員專區等內嵌腳本在登入／登出後同步更新導覽 */
    window.updateMemberNav = updateMemberNav;

    function initMemberNavControls() {
        const nav = document.getElementById('desktopMemberNav');
        const btn = document.getElementById('desktopMemberMenuBtn');
        const dd = document.getElementById('desktopMemberDropdown');
        if (btn && dd) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = dd.classList.contains('hidden');
                setDesktopMemberMenuOpen(willOpen);
            });
        }
        document.addEventListener('click', (e) => {
            if (!nav || !dd || dd.classList.contains('hidden')) return;
            if (!nav.contains(e.target)) {
                setDesktopMemberMenuOpen(false);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                setDesktopMemberMenuOpen(false);
            }
        });
        const doLogout = () => {
            localStorage.removeItem('memberToken');
            updateMemberNav();
            window.dispatchEvent(new CustomEvent('actc-member-logout'));
        };
        document.getElementById('desktopMemberLogoutBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            doLogout();
        });
        document.getElementById('mobileMemberLogoutBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            doLogout();
            const sub = document.getElementById('mobileMemberSub');
            const chev = document.getElementById('mobileMemberChevron');
            const mobToggle = document.getElementById('mobileMemberToggle');
            if (sub) sub.classList.add('hidden');
            chev?.classList.remove('rotate-180');
            mobToggle?.setAttribute('aria-expanded', 'false');
        });
        dd?.querySelectorAll('a').forEach((a) => {
            a.addEventListener('click', () => setDesktopMemberMenuOpen(false));
        });
        const mobToggle = document.getElementById('mobileMemberToggle');
        const mobSub = document.getElementById('mobileMemberSub');
        const chev = document.getElementById('mobileMemberChevron');
        if (mobToggle && mobSub) {
            mobToggle.addEventListener('click', () => {
                const open = mobSub.classList.toggle('hidden') === false;
                mobToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                chev?.classList.toggle('rotate-180', open);
            });
        }
        mobSub?.querySelectorAll('a')?.forEach((a) => {
            a.addEventListener('click', () => {
                mobSub.classList.add('hidden');
                chev?.classList.remove('rotate-180');
                mobToggle?.setAttribute('aria-expanded', 'false');
            });
        });
        window.addEventListener('storage', (e) => {
            if (e.key === 'memberToken') {
                updateMemberNav();
            }
        });
        window.addEventListener('pageshow', () => {
            updateMemberNav();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('desktopMemberNav')) return;
        updateMemberNav();
        initMemberNavControls();
    });
})();
