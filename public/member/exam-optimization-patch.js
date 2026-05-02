/**
 * 考试优化补丁 - 计时器警告和作弊检测
 * 将此脚本包含在 member/index.html 中，或者在 examTab() 中手动应用
 */

// 需要手动应用的修改：

/*
1. 在 startTimeRemainingTimer() 函数中添加（约1574行）：

原代码：
startTimeRemainingTimer() {
    if (this.timeRemainingInterval) clearInterval(this.timeRemainingInterval);
    this.timeRemainingInterval = setInterval(() => {
        if (!this.currentAttempt?.expiresAt) return;
        const remaining = Math.max(0, Math.floor((new Date(this.currentAttempt.expiresAt) - new Date()) / 1000));
        if (remaining <= 0) {
            clearInterval(this.timeRemainingInterval);
            alert('考試時間到！即將自動提交。');
            this.submitExam();
        }
    }, 1000);
},

修改为：
startTimeRemainingTimer() {
    if (this.timeRemainingInterval) clearInterval(this.timeRemainingInterval);
    
    // 添加可见性变化检测
    this._visibilityChangeHandler = () => {
        if (document.hidden) {
            this.visibilityChangeCount++;
            if (this.visibilityChangeCount <= 3) {
                alert(`警告：檢測到視窗切換（第 ${this.visibilityChangeCount} 次）\n請勿切換視窗。`);
            } else if (this.visibilityChangeCount > 10) {
                alert('檢測到異常頻繁的視窗切換，系統將標記作弊行為。');
            }
        }
    };
    document.addEventListener('visibilitychange', this._visibilityChangeHandler);
    
    this.timeRemainingInterval = setInterval(() => {
        if (!this.currentAttempt?.expiresAt) return;
        const remaining = Math.max(0, Math.floor((new Date(this.currentAttempt.expiresAt) - new Date()) / 1000));
        
        // 少于5分钟时显示警告
        if (remaining <= 300 && remaining > 0) {
            this.showTimeWarning = true;
        }
        
        if (remaining <= 0) {
            clearInterval(this.timeRemainingInterval);
            document.removeEventListener('visibilitychange', this._visibilityChangeHandler);
            alert('考試時間到！即將自動提交。');
            this.submitExam();
        }
    }, 1000);
},

---
2. 在 submitExam() 函数中修改（约1598行）：

原代码：
body: JSON.stringify({
    attemptId: this.currentAttempt.attemptId,
    answers: answersArray,
    timeSpent: this.currentAttempt.timeLimit ? 
        Math.floor((new Date() - new Date(this.currentAttempt.startedAt)) / 1000) : 0
})

修改为：
body: JSON.stringify({
    attemptId: this.currentAttempt.attemptId,
    answers: answersArray,
    timeSpent: this.currentAttempt.timeLimit ? 
        Math.floor((new Date() - new Date(this.currentAttempt.startedAt)) / 1000) : 0,
    visibilityChangeCount: this.visibilityChangeCount || 0
})

---
3. 在 submitExam() 的 finally 块中添加（约1624行）：

原代码：
} finally {
    this.submitting = false;
}

修改为：
} finally {
    this.submitting = false;
    // 移除可见性变化监听
    if (this._visibilityChangeHandler) {
        document.removeEventListener('visibilitychange', this._visibilityChangeHandler);
    }
}

---
4. 在 HTML 中显示计时器警告（已添加，约439行）：

<div x-show="showTimeWarning" class="px-3 py-1 bg-red-100 text-red-800 rounded text-sm">
    ⚠️ 剩餘時間不足5分鐘！
</div>

---
应用方式：
1. 手动在 member/index.html 中查找对应函数并修改
2. 或者使用脚本自动替换（需要精确匹配）
