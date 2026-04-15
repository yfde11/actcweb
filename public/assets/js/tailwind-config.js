// ACTC 網站統一的 Tailwind CSS 配置
// 確保在 Tailwind CSS 載入後立即配置
if (typeof tailwind !== 'undefined') {
    tailwind.config = {
        theme: {
            extend: {
                colors: {
                    'actc-orange': '#F97316',
                    'actc-orange-light': '#FB923C',
                    'actc-orange-dark': '#EA580C',
                    'actc-sand': '#F4A460'
                }
            }
        }
    };
} else {
    // 如果 Tailwind 還沒載入，等待它載入完成
    window.addEventListener('load', function() {
        if (typeof tailwind !== 'undefined') {
            tailwind.config = {
                theme: {
                    extend: {
                        colors: {
                            'actc-orange': '#F97316',
                            'actc-orange-light': '#FB923C',
                            'actc-orange-dark': '#EA580C',
                            'actc-sand': '#F4A460'
                        }
                    }
                }
            };
        }
    });
}
